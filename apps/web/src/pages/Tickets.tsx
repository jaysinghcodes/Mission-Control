import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { PageHeader, Segmented, SoftCard, StatusChip, Btn, Face, AgentName, Banner, SearchInput, FieldError, EmptyState } from '../components/shell'
import type { Agent, AgentsResp, ProjectsResp } from '../types'
import { rosterDisplayName } from '../data/roster'
import { ticketCreateQueue } from '../lib/serialQueue'
import { BOARD_COLUMNS, inColumn, ticketNeedsYou, type ApprovalLike } from '../lib/board'

/**
 * Tickets — full-page kanban, fully functional (review fix #9) + Option B (MC-214).
 *  - "+ New ticket" here sends status `todo` EXPLICITLY: since PR #20 the API
 *    default for an omitted status is `backlog` (Atlas decision, see
 *    apps/api/src/tickets/ticket-status.ts DEFAULT_CREATE_STATUS)
 *  - 5 office-aligned columns: To-Do → Build → QA → Review → Done
 *  - Cards move through all 5 via PATCH buttons (drag-and-drop is a separate
 *    follow-up ticket); legacy `inprogress` rows render in Build
 *  - After every write the board applies the server's answer, then refetches,
 *    so what you see always matches what a browser refresh would show
 *  - API errors (400/404/network) show a gentle inline notice, never a crash
 *  - Socket events trigger instant refetch; status changes persist + broadcast
 *  - Filter by project via ?project= on the hash URL (/#/tickets?project=<id>).
 *    The API does the filtering (`GET /tickets?projectId=`). A new ticket
 *    created while a project is selected is attached to that project.
 *    Each card can also move to a different project (at most one).
 */

interface Ticket { id: string; key: string | null; title: string; status: string; priority: string; assignee: string | null; tags: string[] | null; projectId: string | null; createdAt: string }
interface TicketsResp { tickets: Ticket[] }

/** Columns live in board.ts so the board, Pipeline, and Office share one status map. */

/**
 * Assignee sticker. The card used to draw the generic Bot glyph. Match the
 * name (or the roster display name) to a real agent so the ticket wears the
 * same robot as Team / Office. Unknown and empty assignees still get a
 * sticker — hashed from the label — without being folded into the live
 * roster (that would burn a seat and renumber a child).
 */
function assigneeFace(assignee: string | null, roster: readonly Agent[]): { agent: Agent | { id: string; name: string; status: string }; agents?: readonly Agent[] } {
  const label = assignee?.trim() || ''
  if (!label) return { agent: { id: 'unassigned', name: 'unassigned', status: 'offline' } }
  const key = label.toLowerCase()
  const hit = roster.find((a) =>
    a.name.toLowerCase() === key ||
    a.id.toLowerCase() === key ||
    rosterDisplayName(a.name, a.role).toLowerCase() === key,
  )
  if (hit) return { agent: hit, agents: roster }
  return { agent: { id: label, name: label, status: 'idle' } }
}

/** How long an inline notice stays up before fading on its own. */
const NOTICE_MS = 6000

/** Board columns → readable names for notices (`inprogress` = legacy Build). */
const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To-Do', build: 'Build', inprogress: 'Build', qa: 'QA', review: 'Review', done: 'Done',
}

export default function Tickets() {
  // The filter lives in the hash URL (`/#/tickets?project=<id>`) so a refresh
  // keeps it. useApi refetches when this path changes (see useApi).
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('project') ?? ''
  const ticketPath = projectFilter
    ? `/tickets?projectId=${encodeURIComponent(projectFilter)}`
    : '/tickets'
  // `loading`/`errorMessage` (QA-1 polish item 1): distinguish "not loaded yet"
  // and "load failed" from a genuinely empty board.
  const { data, loading, errorMessage: loadError, refetch, mutate } = useApi<TicketsResp>(ticketPath, { pollMs: 10000 })
  // archived=all so a ticket that still points at an archived project can
  // show that name. The filter dropdown itself only offers active projects
  // (plus the one currently selected, if it has since been archived).
  const projectsQ = useApi<ProjectsResp>('/projects?archived=all', { pollMs: 30000 })
  const allProjects = projectsQ.data?.projects ?? []
  const activeProjects = allProjects.filter((p) => !p.archivedAt)
  // Same roster Team uses, so an assignee's sticker matches their card.
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const roster = rosterQ.data?.agents ?? []
  const { events } = useLiveActivity()
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  // How many of THIS page's creates are queued or in flight. Display-only
  // (drives the "Saving…" button label) — it NEVER gates a submit. The old
  // `busy` flag did gate submits (`if (!title || busy) return`), and that is
  // exactly how QA's second create (~1 s after the first) was silently
  // dropped (QA-1 #1). Submits are now queued instead, see create().
  const [saving, setSaving] = useState(0)
  // Gentle inline notice for failed writes (400 invalid status, 404 deleted
  // ticket, API offline…). Auto-clears; never blocks the board.
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Titles whose create failed and that the current notice is reporting.
  // Accumulated (not replaced) so a burst of failures — e.g. API went down
  // with three creates queued — names EVERY lost title, instead of each
  // failure overwriting the previous one's notice a few ms later. Reset
  // whenever the notice goes away (timer or Dismiss).
  const failedCreates = useRef<string[]>([])
  // Per-ticket move counter: if the user clicks two moves on one card quickly,
  // only the response to the LATEST click is applied locally. The server
  // already persists the last-received move (per-ticket write queue); this
  // stops an earlier response that arrives late from repainting the card.
  const moveSeq = useRef(new Map<string, number>())
  // QA-1 polish item 2: ticket ids with a move PATCH in flight. While a card
  // is moving, ALL of its move buttons are disabled, so a double-clicked
  // "▶ Start" sends ONE PATCH instead of two. Two copies on purpose:
  //  - the ref is the real guard, read synchronously inside move(), so even
  //    two clicks handled before React re-renders cannot both get through;
  //  - the state mirrors it purely to re-render the disabled buttons.
  // (Server side, a repeated same-status PATCH is also a no-op that writes no
  // activity event — belt and braces.)
  const movingRef = useRef(new Set<string>())
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set())
  const [showDone, setShowDone] = useState(false)
  const [query, setQuery] = useState('')
  const tickets = data?.tickets ?? []
  const approvalsQ = useApi<{ approvals: ApprovalLike[] }>('/approvals', { pollMs: 15000 })
  const refetchApprovals = approvalsQ.refetch
  const pending = approvalsQ.data?.approvals ?? []

  useEffect(() => {
    if (events.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [events, refetchApprovals])

  function needsYou(t: Ticket): boolean {
    return ticketNeedsYou(t, pending)
  }

  function openBacklog() {
    const next = new URLSearchParams(params)
    next.set('view', 'backlog')
    setParams(next, { replace: true })
  }

  /** Hide the notice and forget the failed-create titles it was listing. */
  function clearNotice() {
    setNotice(null)
    failedCreates.current = []
  }

  function showNotice(msg: string) {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(clearNotice, NOTICE_MS)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  // Instant refresh on any ticket/run activity event.
  useEffect(() => {
    if (events.some((e) => e.type.startsWith('run.') || e.type.includes('ticket'))) void refetch()
  }, [events, refetch])

  /**
   * "+ New ticket" (button or Enter). QA-1 #1 fix — every submit is either
   * SAVED or shows a VISIBLE error; nothing is dropped silently.
   *
   * What was wrong (the old handler):
   *   1. `if (!t || busy) return` — a second submit while the first POST was
   *      still in flight returned silently: no request, no notice.
   *   2. When that first POST finished it ran `setTitle('')`, wiping whatever
   *      the user had typed for the NEXT ticket in the meantime.
   *
   * What it does now:
   *   - Snapshot the trimmed title into `t` and clear the input RIGHT AWAY.
   *     That clears exactly the title being submitted — never a later one —
   *     and the input is free for the next ticket immediately. It also makes
   *     an accidental double-Enter harmless: React flushes the clear before
   *     the next keydown is handled, so the 2nd press sees an empty input and
   *     the `!t` check stops it (no duplicate ticket, which is what `busy`
   *     used to protect against).
   *   - Queue the POST on the shared ticketCreateQueue instead of ignoring it.
   *     Creates still go out one at a time, in submit order, so MC-N keys
   *     follow typing order; key uniqueness itself is enforced server-side
   *     by an advisory lock (QA-1 polish item 4, see serialQueue.ts).
   *   - On failure: say which title failed and why (inline notice, same
   *     component as move errors), and put the title back in the input if
   *     the user hasn't started typing something else, so it's one Enter to
   *     retry. If they have, the notice still names it — nothing is lost.
   *
   * Sync (not async) on purpose: the handler returns as soon as the job is
   * queued, so nothing here ever waits on — or is blocked by — another create.
   */
  function create() {
    const t = title.trim()
    if (!t) {
      setTitleError('Title is required')
      return
    }
    setTitleError(null)
    setTitle('') // clear ONLY what we're submitting (see above)
    setSaving((n) => n + 1)
    // status: 'todo' is REQUIRED here — the API default is now `backlog`
    // (Atlas, PR #20). Omitting it would send kanban creates to /backlog.
    // apiSend never throws (it returns ok:false + a readable error for HTTP
    // errors, legacy `{ error }` bodies and network failures alike), so the
    // queued job always resolves and we only need to branch on `r.ok`.
    // A selected project is sent with the create. The API rejects an
    // archived one with 400; the notice below shows that message.
    const body: { title: string; priority: string; status: string; projectId?: string } = {
      title: t, priority: 'med', status: 'todo',
    }
    if (projectFilter) body.projectId = projectFilter
    void ticketCreateQueue
      .run(() => apiSend<{ ticket: Ticket }>('POST', '/tickets', body))
      .then((r) => {
        if (r.ok) return
        failedCreates.current.push(t)
        const names = failedCreates.current.map((x) => `"${x}"`).join(', ')
        showNotice(`Couldn't create ${names} — ${r.error}`)
        // Restore the failed title only into an EMPTY input — never clobber
        // a title the user typed while this request was queued/in flight.
        setTitle((cur) => (cur.trim() ? cur : t))
      })
      .finally(() => {
        setSaving((n) => n - 1)
        // Re-sync after every create (success or failure) so the board shows
        // exactly what the server committed, including the new MC-N key.
        void refetch()
      })
  }

  /**
   * Move a ticket between columns via PATCH /tickets/:id.
   *
   * MUST be PATCH: the API only registers `@Patch(':id')`; a POST to the same
   * path 404s (that was the original Step 8 bug fixed earlier in PR #20).
   *
   * On success we splice the server's returned row into local state (instant,
   * and authoritative — it is what was committed), then refetch to pick up
   * anything else that changed. On failure we show why and refetch, so the
   * board snaps back to the server's truth instead of guessing.
   */
  async function move(id: string, status: string) {
    // Item 2: one move per card at a time. A second click while the first
    // PATCH is pending is ignored on purpose — unlike "+ New ticket" (which
    // must never drop a submit), a repeated move is the SAME intent, already
    // being carried out, and the buttons are visibly disabled meanwhile.
    if (movingRef.current.has(id)) return
    movingRef.current.add(id)
    setMoving(new Set(movingRef.current))
    const seq = (moveSeq.current.get(id) ?? 0) + 1
    moveSeq.current.set(id, seq)
    const r = await apiSend<{ ticket: Ticket }>('PATCH', `/tickets/${id}`, { status })
    // Re-enable this card's buttons whatever the outcome (apiSend never throws).
    movingRef.current.delete(id)
    setMoving(new Set(movingRef.current))
    const isLatest = moveSeq.current.get(id) === seq
    if (r.ok && isLatest && r.data?.ticket) {
      const updated = r.data.ticket
      mutate((prev) => (prev ? { ...prev, tickets: prev.tickets.map((t) => (t.id === id ? updated : t)) } : prev))
    } else if (!r.ok) {
      const what = STATUS_LABEL[status] ?? status
      showNotice(
        r.status === 404
          ? 'That ticket no longer exists — the board has been refreshed.'
          : `Couldn't move ticket to ${what} — ${r.error}`,
      )
    }
    void refetch()
  }

  /**
   * Move a ticket onto a project, or off every project (`null`).
   * Same one-write-at-a-time guard as column moves: the select and the
   * move buttons share it, so two clicks cannot interleave on one card.
   * The server rejects an archived target with 400; we show that message
   * and refetch so the card snaps back to the project it still has.
   */
  async function assignProject(id: string, projectId: string | null) {
    if (movingRef.current.has(id)) return
    movingRef.current.add(id)
    setMoving(new Set(movingRef.current))
    const r = await apiSend<{ ticket: Ticket }>('PATCH', `/tickets/${id}`, { projectId })
    movingRef.current.delete(id)
    setMoving(new Set(movingRef.current))
    if (r.ok && r.data?.ticket) {
      const updated = r.data.ticket
      mutate((prev) => {
        if (!prev) return prev
        // Drop the card from a filtered board when it no longer belongs
        // to the project on screen. The unfiltered board keeps it.
        const next = prev.tickets.map((t) => (t.id === id ? updated : t))
        const visible = projectFilter ? next.filter((t) => t.projectId === projectFilter) : next
        return { ...prev, tickets: visible }
      })
    } else if (!r.ok) {
      showNotice(
        r.status === 404
          ? (r.error ?? 'That ticket or project no longer exists — the board has been refreshed.')
          : `Couldn't update the project — ${r.error}`,
      )
    }
    void refetch()
  }

  function setProjectFilter(id: string) {
    const next = new URLSearchParams(params)
    if (id) next.set('project', id)
    else next.delete('project')
    setParams(next, { replace: true })
  }

  const selectedProject = allProjects.find((p) => p.id === projectFilter) ?? null

  /** Options for one card. Active projects, plus the card's current
   *  project when that one is archived — so the select still shows the
   *  truth instead of snapping to "No project". Archived projects are
   *  not offered as new targets; the API would 400 them anyway. */
  function optionsFor(ticketProjectId: string | null): { id: string; label: string }[] {
    const opts = activeProjects.map((p) => ({ id: p.id, label: p.name }))
    if (ticketProjectId && !opts.some((o) => o.id === ticketProjectId)) {
      const found = allProjects.find((p) => p.id === ticketProjectId)
      opts.push({
        id: ticketProjectId,
        label: found ? `${found.name} (archived)` : 'Archived project',
      })
    }
    return opts
  }

  const shown = tickets.filter((t) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return t.title.toLowerCase().includes(q) || (t.key ?? '').toLowerCase().includes(q) || (t.assignee ?? '').toLowerCase().includes(q)
  })
  const openCols = BOARD_COLUMNS.filter((c) => c.status !== 'done')
  const doneRows = shown.filter((t) => inColumn(t.status, BOARD_COLUMNS[4]))
  const openCount = shown.filter((t) => !inColumn(t.status, BOARD_COLUMNS[4]) && t.status !== 'backlog').length
  const needs = shown.filter((t) => needsYou(t)).length
  const summary = !data
    ? (loading && !loadError ? 'Loading the board…' : 'Board not loaded')
    : `${openCount} open${needs ? ` · ${needs} needs you` : ''} · ${doneRows.length} done`

  const DOT: Record<string, string> = { todo: 'var(--mc-gray)', build: 'var(--mc-blue)', qa: 'var(--mc-orange)', review: 'var(--mc-teal)', done: 'var(--mc-green)' }
  const detail = tickets.find((t) => t.id === detailId) ?? null

  function projectLabel(t: Ticket): string {
    const current = allProjects.find((p) => p.id === t.projectId) ?? null
    if (!t.projectId) return 'No project'
    if (!current) return 'Archived project'
    return current.archivedAt ? `${current.name} (archived)` : current.name
  }

  function projectControl(t: Ticket) {
    const current = allProjects.find((p) => p.id === t.projectId) ?? null
    if (t.projectId && !projectsQ.data) {
      return <div className="text-[12px] text-mc-sub">Loading project…</div>
    }
    if (t.projectId && (current?.archivedAt || !current)) {
      const label = current ? `${current.name} (archived)` : 'Archived project'
      return (
        <div className="text-[12px] text-mc-sub" aria-readonly="true" title="This project is archived. Unarchive it on Projects before reassigning.">
          {label}
        </div>
      )
    }
    return (
      <select
        aria-label={`Project for ${t.key ?? t.title}`}
        value={t.projectId ?? ''}
        disabled={moving.has(t.id)}
        onChange={(e) => void assignProject(t.id, e.target.value || null)}
        className="h-7 max-w-full rounded-lg bg-mc-ctl px-2 text-[11px] text-mc-text outline-none disabled:opacity-50"
      >
        <option value="">No project</option>
        {optionsFor(t.projectId).filter((p) => !p.label.endsWith('(archived)')).map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    )
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        summary={summary}
        tools={
          <>
            <Segmented labels={['Board', 'Backlog']} active={0} onChange={(i) => { if (i === 1) openBacklog() }} ariaLabel="Tasks view" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search" label="Search tasks" />
            <Btn kind="primary" onClick={create}>{saving > 0 ? 'Saving…' : 'New task'}</Btn>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
          <div>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="New task title…"
            aria-label="New task title"
            aria-invalid={!!titleError}
            className="h-8 w-64 max-w-full rounded-lg bg-mc-ctl px-3 text-[13px] outline-none"
          />
          {titleError && <FieldError>{titleError}</FieldError>}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-mc-sub">
          Project
          <select
            aria-label="Filter by project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-8 max-w-full rounded-lg bg-mc-ctl px-3 text-[13px] text-mc-text outline-none"
          >
            <option value="">All projects</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {selectedProject?.archivedAt && (
              <option value={selectedProject.id}>{selectedProject.name} (archived)</option>
            )}
          </select>
        </label>
        {selectedProject && (
          <Link to={`/projects/${selectedProject.id}`} className="text-[12px] font-semibold text-mc-accent-text">
            {selectedProject.doneCount} of {selectedProject.ticketCount} done
          </Link>
        )}
      </div>

      {loadError && (
        <Banner>
          Couldn't load tickets ({loadError}). {data ? 'Showing the last loaded board; retrying automatically.' : 'Retrying automatically.'}
        </Banner>
      )}
      {notice && <Banner onDismiss={clearNotice}>{notice}</Banner>}

      {data && tickets.length === 0 && !projectFilter && !query.trim() && (
        <div className="mb-4">
          <EmptyState
            title="No tasks yet"
            body="A fresh install starts empty. Run npm run seed:demo for the sample board, or open setup to connect your OpenClaw."
          >
            <Link to="/connect" className="mt-3 inline-block text-[13px] font-semibold text-mc-accent-text">Open setup</Link>
          </EmptyState>
        </div>
      )}

      {detail && (
        <SoftCard className="mb-4 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-mc-sub">{detail.key ?? 'Task'}</div>
              <div className="text-[16px] font-semibold">{detail.title}</div>
            </div>
            <button type="button" onClick={() => setDetailId(null)} className="text-[13px] font-semibold text-mc-sub">Close</button>
          </div>
          <div className="mt-3 max-w-xs">
            <div className="mb-1 text-[12px] font-semibold text-mc-sub">Project</div>
            {projectControl(detail)}
          </div>
        </SoftCard>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="flex w-max gap-4">
          {openCols.map((col) => {
            const rows = shown.filter((t) => inColumn(t.status, col))
            return (
              <div key={col.title} className="w-[260px] shrink-0">
                <div className="mb-3 flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: DOT[col.status] }} />
                  <span className="whitespace-nowrap text-[15px] font-semibold">{col.title}</span>
                  <span className="text-[13px] text-mc-sub">{rows.length}</span>
                </div>
                <div className="space-y-3">
                  {rows.length === 0 && (
                    <div className="px-1 py-4 text-[12px] text-mc-sub">
                      {!data ? (loading && !loadError ? 'Loading…' : 'Not loaded — see the notice above.') : `Nothing in ${col.title} yet.`}
                    </div>
                  )}
                  {rows.map((t) => {
                    const face = assigneeFace(t.assignee, roster)
                    const flagged = needsYou(t)
                    return (
                      <SoftCard key={t.id} className="px-3.5 py-3">
                        {flagged && <StatusChip label="Needs you" tone="red" className="mb-2" />}
                        <button type="button" onClick={() => setDetailId(t.id)} className="text-left text-[14px] font-semibold leading-snug break-words">{t.title}</button>
                        <div className="mt-1 text-[11px] leading-snug break-words text-mc-sub">{projectLabel(t)}</div>
                        <div className="mt-3 flex items-center gap-2">
                          <Face agent={face.agent} agents={face.agents} px={28} />
                          <span className="min-w-0 flex-1">
                            <AgentName name={face.agent.name} role={'role' in face.agent ? face.agent.role : null} />
                          </span>
                          <span className="whitespace-nowrap text-[11px] text-mc-sub">{t.key ?? t.id.slice(0, 8)}</span>
                        </div>
                        <div className="mt-2.5 flex max-w-full flex-wrap items-center gap-2">
                          {t.status === 'todo' && (
                            <>
                              <button type="button" onClick={() => void move(t.id, 'build')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-bluebg px-3 text-[10.5px] font-semibold text-mc-bluetext disabled:opacity-50">Start</button>
                              <button type="button" onClick={() => void move(t.id, 'backlog')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-fill px-3 text-[10.5px] font-semibold text-mc-graytext disabled:opacity-50">Backlog</button>
                            </>
                          )}
                          {(t.status === 'build' || t.status === 'inprogress') && (
                            <>
                              <button type="button" onClick={() => void move(t.id, 'qa')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-bluebg px-3 text-[10.5px] font-semibold text-mc-bluetext disabled:opacity-50">QA</button>
                              <button type="button" onClick={() => void move(t.id, 'todo')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-fill px-3 text-[10.5px] font-semibold text-mc-graytext disabled:opacity-50">To-Do</button>
                            </>
                          )}
                          {t.status === 'qa' && (
                            <>
                              <button type="button" onClick={() => void move(t.id, 'review')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-orangebg px-3 text-[10.5px] font-semibold text-mc-orangetext disabled:opacity-50">Review</button>
                              <button type="button" onClick={() => void move(t.id, 'build')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-fill px-3 text-[10.5px] font-semibold text-mc-graytext disabled:opacity-50">Build</button>
                            </>
                          )}
                          {t.status === 'review' && (
                            <>
                              <button type="button" onClick={() => void move(t.id, 'done')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-greenbg px-3 text-[10.5px] font-semibold text-mc-greentext disabled:opacity-50">Done</button>
                              <button type="button" onClick={() => void move(t.id, 'qa')} disabled={moving.has(t.id)} className="h-6 shrink-0 whitespace-nowrap rounded-full bg-mc-fill px-3 text-[10.5px] font-semibold text-mc-graytext disabled:opacity-50">QA</button>
                            </>
                          )}
                        </div>
                      </SoftCard>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="w-[168px] shrink-0">
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-full bg-mc-green" />
              <span className="text-[15px] font-semibold">Done</span>
              <span className="text-[13px] text-mc-sub">{doneRows.length}</span>
            </div>
            <SoftCard className="px-3 py-4 text-center">
              <div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-mc-greenbg text-mc-greentext">✓</div>
              <div className="mt-2 text-[12px] text-mc-sub2">{doneRows.length} done</div>
              <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-2 text-[13px] font-semibold text-mc-accent-text">
                {showDone ? 'Hide' : 'Show all'}
              </button>
            </SoftCard>
            {showDone && (
              <div className="mt-3 space-y-2">
                {doneRows.map((t) => (
                  <SoftCard key={t.id} className="px-3 py-2">
                    <button type="button" onClick={() => setDetailId(t.id)} className="text-left text-[13px] font-semibold break-words">{t.title}</button>
                    <div className="mt-1 whitespace-nowrap text-[11px] text-mc-sub">{t.key ?? ''}</div>
                  </SoftCard>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
