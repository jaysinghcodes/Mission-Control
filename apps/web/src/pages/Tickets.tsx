import { useEffect, useRef, useState } from 'react'
import { useApi, apiSend } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { Bot, Card, Chip, Inner, PillButton, SectionLabel } from '../components/ui'
import { ticketCreateQueue } from '../lib/serialQueue'

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
 */

interface Ticket { id: string; key: string | null; title: string; status: string; priority: string; assignee: string | null; tags: string[] | null; createdAt: string }
interface TicketsResp { tickets: Ticket[] }

const PRIO: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'var(--mc-redbg)', fg: 'var(--mc-redtext)' },
  med: { bg: 'var(--mc-orangebg)', fg: 'var(--mc-orangetext)' },
  low: { bg: 'var(--mc-inner)', fg: 'var(--mc-sub)' },
}

/** Option B columns (MC-214, locked): `inprogress` is a legacy alias for Build. */
const COLUMNS = [
  { title: 'To-Do', status: 'todo', aliases: [] as string[] },
  { title: 'Build', status: 'build', aliases: ['inprogress'] },
  { title: 'QA', status: 'qa', aliases: [] as string[] },
  { title: 'Review', status: 'review', aliases: [] as string[] },
  { title: 'Done', status: 'done', aliases: [] as string[] },
]

/** Column membership — canonical status plus legacy aliases (no data loss). */
function inColumn(t: Ticket, col: { status: string; aliases: string[] }): boolean {
  return t.status === col.status || col.aliases.includes(t.status)
}

/** How long an inline notice stays up before fading on its own. */
const NOTICE_MS = 6000

/** Board columns → readable names for notices (`inprogress` = legacy Build). */
const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To-Do', build: 'Build', inprogress: 'Build', qa: 'QA', review: 'Review', done: 'Done',
}

export default function Tickets() {
  // `loading`/`errorMessage` (QA-1 polish item 1): distinguish "not loaded yet"
  // and "load failed" from a genuinely empty board.
  const { data, loading, errorMessage: loadError, refetch, mutate } = useApi<TicketsResp>('/tickets', { pollMs: 10000 })
  const { events } = useLiveActivity()
  const [title, setTitle] = useState('')
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
  const tickets = data?.tickets ?? []

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
    if (!t) return
    setTitle('') // clear ONLY what we're submitting (see above)
    setSaving((n) => n + 1)
    // status: 'todo' is REQUIRED here — the API default is now `backlog`
    // (Atlas, PR #20). Omitting it would send kanban creates to /backlog.
    // apiSend never throws (it returns ok:false + a readable error for HTTP
    // errors, legacy `{ error }` bodies and network failures alike), so the
    // queued job always resolves and we only need to branch on `r.ok`.
    void ticketCreateQueue
      .run(() => apiSend<{ ticket: Ticket }>('POST', '/tickets', { title: t, priority: 'med', status: 'todo' }))
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

  const metrics = [
    { label: 'To-Do', value: String(tickets.filter((t) => inColumn(t, COLUMNS[0])).length) },
    { label: 'Build', value: String(tickets.filter((t) => inColumn(t, COLUMNS[1])).length) },
    { label: 'QA', value: String(tickets.filter((t) => inColumn(t, COLUMNS[2])).length) },
    { label: 'Review', value: String(tickets.filter((t) => inColumn(t, COLUMNS[3])).length) },
    { label: 'Done', value: String(tickets.filter((t) => inColumn(t, COLUMNS[4])).length) },
  ]

  return (
    <div className="p-6">
      {/* Header wraps at ~768px (sidebar 220px leaves ~548px). The create
          controls drop to the next line instead of being clipped off the right. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-xl">
          <div className="text-[22px] font-semibold">Tickets</div>
          <div className="mt-1 text-[13px] text-mc-sub">Kanban — create a ticket, then move it To-Do → Build → QA → Review → Done.</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="New ticket title…"
            className="h-9 w-64 max-w-full rounded-full border border-mc-border bg-mc-card px-4 text-[13px] text-mc-text placeholder:text-mc-faint outline-none focus:border-mc-primary"
          />
          {/* Label-only progress hint (same pattern as Backlog's "Moving…"); the
              button stays clickable — extra submits queue, they're never dropped.
              shrink-0: a narrow row must not squash the label. */}
          <PillButton label={saving > 0 ? 'Saving…' : '+ New ticket'} on onClick={create} className="shrink-0" />
        </div>
      </div>

      {/* Load failure (QA-1 polish item 1). useApi keeps the last good board
          on a failed refresh, so we must SAY it is not current — otherwise a
          dead API looks like a quiet board. Same notice styling as the write
          errors below; no new design. Clears itself on the next good load. */}
      {loadError && (
        <div role="alert" className="mt-4 rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
          {/* Reason in parentheses: server messages may carry their own "?"/"." */}
          Couldn't load tickets ({loadError}).{' '}
          {data ? 'Showing the last loaded board; retrying automatically.' : 'Retrying automatically.'}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext"
        >
          <span>{notice}</span>
          <button type="button" onClick={clearNotice} className="ml-4 text-[11px] font-semibold hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {/* Five columns need ~1240px. Below that (a 768–1024px window minus the
          220px sidebar) the board scrolls sideways. Each column stays at least
          ~240px so titles wrap in full and the move buttons are not clipped.
          Layout only — no change to create/move behaviour. */}
      <div className="mt-6 overflow-x-auto pb-1">
        <div className="grid min-w-[1240px] grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const rows = tickets.filter((t) => inColumn(t, col))
          return (
            <Card key={col.title} className="px-3.5 py-3 min-h-[380px] min-w-0">
              <div className="flex items-center justify-between px-1">
                <SectionLabel>{col.title}</SectionLabel>
                <span className="text-[11px] font-semibold text-mc-sub">{rows.length}</span>
              </div>
              <div className="mt-3 space-y-3">
                {rows.length === 0 && (
                  <div className="text-[12px] text-mc-faint px-1 py-4">
                    {/* Before the first good load there is NO board to describe:
                        say "Loading…" (or point at the error) rather than claim
                        the column is empty (QA-1 polish item 1). */}
                    {!data ? (loading && !loadError ? 'Loading…' : 'Not loaded — see the notice above.') : col.title === 'Done' ? 'Nothing shipped yet.' : col.title === 'To-Do' ? 'Empty — create a ticket above.' : `Nothing in ${col.title} yet.`}
                  </div>
                )}
                {rows.map((t) => (
                  <Inner key={t.id} className="rounded-[10px] px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-mc-faint">{t.key ?? t.id.slice(0, 8)}</span>
                      <Chip label={t.priority.toUpperCase()} bg={PRIO[t.priority]?.bg ?? PRIO.med.bg} fg={PRIO[t.priority]?.fg ?? PRIO.med.fg} h={18} fs="text-[10px]" />
                    </div>
                    {/* Full title, wrapped — never ellipsized. break-words keeps a
                        long unbroken token inside the column. */}
                    <div className="mt-1.5 text-[13px] font-semibold leading-snug break-words">{t.title}</div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Bot color={t.assignee ? 'var(--mc-primary)' : 'var(--mc-faint)'} scale={0.8} />
                      <span className="text-[11px] text-mc-sub break-words">{t.assignee ?? 'unassigned'}</span>
                    </div>
                    {/* Pipeline actions — full movement through all 5 columns (MC-214).
                        Every move button is disabled while this card has a PATCH
                        in flight (item 2; same disabled:opacity-50 look as
                        Backlog's "Moving…" button — no new styles).
                        flex-wrap + shrink-0: at a narrow column the second button
                        drops to the next line whole, it is not cut in half. */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {t.status === 'todo' && (
                        <>
                          {/* Start sends the canonical `build` (MC-214); the API
                              still accepts legacy `inprogress` from older clients. */}
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'build')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ▶ Start
                          </button>
                          {/* Symmetric with Backlog's "→ To-Do": every move has a button. */}
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'backlog')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ↺ Backlog
                          </button>
                        </>
                      )}
                      {(t.status === 'build' || t.status === 'inprogress') && (
                        <>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'qa')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ✓ QA
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'todo')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ↺ To-Do
                          </button>
                        </>
                      )}
                      {t.status === 'qa' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'review')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-orangebg text-mc-orangetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ✓ Review
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'build')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ↺ Build
                          </button>
                        </>
                      )}
                      {t.status === 'review' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'done')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-greenbg text-mc-greentext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ✓ Done
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'qa')}
                            disabled={moving.has(t.id)}
                            className="h-6 shrink-0 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
                          >
                            ↺ QA
                          </button>
                        </>
                      )}
                      {t.status === 'done' && (
                        <span className="text-[10.5px] text-mc-greentext font-semibold">✓ shipped</span>
                      )}
                    </div>
                  </Inner>
                ))}
              </div>
            </Card>
          )
        })}
        </div>
      </div>

      {/* Same idea as the board: five tiles scroll instead of squashing labels. */}
      <div className="mt-6 overflow-x-auto pb-1">
      <div className="grid min-w-[640px] grid-cols-5 gap-4">
        {metrics.map((m) => (
          <Card key={m.label} className="px-3 py-2">
            <div className="text-[18px] font-semibold">{m.value}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-mc-faint">{m.label}</div>
          </Card>
        ))}
      </div>
      </div>
    </div>
  )
}
