import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { Card, Chip } from '../components/ui'
import { Btn, PageHeader, Segmented, Banner } from '../components/shell'
import { ticketCreateQueue } from '../lib/serialQueue'

/**
 * Backlog — real backlog tickets from the API, ranked table with create CTA.
 * - Create sends status: "backlog" so items land here. (Since PR #20 that is
 *   also the API default — DEFAULT_CREATE_STATUS — but we send it explicitly
 *   so this page keeps working if product flips the default again.)
 * - Each row has a "→ To-Do" button that PATCHes the ticket onto the kanban
 *   board — the Backlog → To-Do move had no control before PR #20 (Atlas:
 *   every move must be a button; drag-and-drop is a separate follow-up).
 * - Write failures show a gentle inline notice; the list always re-syncs
 *   with the server afterwards.
 * - Creates are QUEUED, never dropped (QA-1 #1): see create().
 */

interface Ticket { id: string; key: string | null; title: string; status: string; priority: string; assignee: string | null; tags: string[] | null; createdAt: string }
interface TicketsResp { tickets: Ticket[] }

const PRIO: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'var(--mc-redbg)', fg: 'var(--mc-redtext)' },
  med: { bg: 'var(--mc-orangebg)', fg: 'var(--mc-orangetext)' },
  low: { bg: 'var(--mc-inner)', fg: 'var(--mc-sub)' },
}

/** How long an inline notice stays up before fading on its own. */
const NOTICE_MS = 6000

export default function Backlog() {
  const [params, setParams] = useSearchParams()
  // `loading`/`errorMessage` (QA-1 polish item 1): distinguish "not loaded yet"
  // and "load failed" from a genuinely empty backlog.
  const { data, loading, errorMessage: loadError, refetch, mutate } = useApi<TicketsResp>('/tickets?status=backlog', { pollMs: 15000 })
  const [title, setTitle] = useState('')
  // How many of THIS page's creates are queued or in flight. Display-only
  // (drives the "Saving…" button label) — it NEVER gates a submit. The old
  // `busy` flag did (`if (!title || busy) return`), which is how a second
  // create ~1 s after the first was silently dropped (QA-1 #1).
  const [saving, setSaving] = useState(0)
  // Row ids with a "→ To-Do" move in flight (disables that row's button so a
  // double-click doesn't fire two identical PATCHes).
  const [moving, setMoving] = useState<Set<string>>(new Set())
  // Inline notice: success ("MC-151 moved to To-Do") or a gentle error.
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Titles whose create failed and that the current notice is reporting.
  // Accumulated so a burst of failures (API down with several creates
  // queued) names EVERY lost title instead of each failure overwriting the
  // last one's notice a few ms later. Reset when the notice goes away.
  const failedCreates = useRef<string[]>([])
  const rows = data?.tickets ?? []

  /** Hide the notice and forget the failed-create titles it was listing. */
  function clearNotice() {
    setNotice(null)
    failedCreates.current = []
  }

  function showNotice(text: string, tone: 'ok' | 'warn') {
    setNotice({ text, tone })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(clearNotice, NOTICE_MS)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  /**
   * "+ New ticket" (button or Enter). QA-1 #1 fix — every submit is either
   * SAVED or shows a VISIBLE error; nothing is dropped silently.
   * (Same logic as Tickets.tsx create(); the full rationale lives there.)
   *
   * Old bug: `if (!t || busy) return` silently ignored a submit made while
   * the previous POST was in flight, and that POST's `setTitle('')` then
   * wiped the title typed for the next ticket.
   *
   * Now:
   *   - Snapshot + clear the input at submit time → clears exactly the title
   *     being submitted, frees the input for the next one, and makes a
   *     double-Enter harmless (2nd press sees an empty input → `!t`).
   *   - POST goes through the shared ticketCreateQueue: one create at a
   *     time, in submit order (keys follow typing order; uniqueness is the
   *     API's advisory lock, see serialQueue.ts) — queued, never ignored.
   *   - Failure → warn notice naming the title + server reason, and the title
   *     goes back into the input only if the input is still empty.
   */
  function create() {
    const t = title.trim()
    if (!t) return
    setTitle('') // clear ONLY what we're submitting
    setSaving((n) => n + 1)
    // Explicit status: 'backlog' — matches today's API default, but stays
    // correct even if DEFAULT_CREATE_STATUS changes (see header comment).
    // apiSend never throws, so the queued job always resolves; branch on r.ok.
    void ticketCreateQueue
      .run(() => apiSend<{ ticket: Ticket }>('POST', '/tickets', { title: t, priority: 'med', status: 'backlog' }))
      .then((r) => {
        if (r.ok) return
        failedCreates.current.push(t)
        const names = failedCreates.current.map((x) => `"${x}"`).join(', ')
        showNotice(`Couldn't create ${names} — ${r.error}`, 'warn')
        // Never clobber a title typed while this create was queued/in flight.
        setTitle((cur) => (cur.trim() ? cur : t))
      })
      .finally(() => {
        setSaving((n) => n - 1)
        void refetch() // re-sync with what the server committed
      })
  }

  /**
   * Backlog → To-Do via PATCH /tickets/:id { status: 'todo' }.
   * On success the row is removed locally right away (the server confirmed it
   * is no longer `backlog`), then we refetch so the list matches the server.
   * On failure (404 = already deleted/moved elsewhere, 400, offline) we show
   * why and refetch — no optimistic guessing.
   */
  async function moveToTodo(row: Ticket) {
    if (moving.has(row.id)) return
    setMoving((s) => new Set(s).add(row.id))
    const r = await apiSend<{ ticket: Ticket }>('PATCH', `/tickets/${row.id}`, { status: 'todo' })
    const label = row.key ?? row.id.slice(0, 8)
    if (r.ok) {
      mutate((prev) => (prev ? { ...prev, tickets: prev.tickets.filter((t) => t.id !== row.id) } : prev))
      showNotice(`${label} moved to To-Do — find it on the board.`, 'ok')
    } else {
      showNotice(
        r.status === 404 ? `${label} no longer exists — the list has been refreshed.` : `Couldn't move ${label} to To-Do — ${r.error}`,
        'warn',
      )
    }
    setMoving((s) => {
      const next = new Set(s)
      next.delete(row.id)
      return next
    })
    void refetch()
  }

  function openBoard() {
    const next = new URLSearchParams(params)
    next.delete('view')
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Tasks"
        summary={data ? `${rows.length} not started` : 'Loading the backlog…'}
        tools={
          <>
            <Segmented labels={['Board', 'Backlog']} active={1} onChange={(i) => { if (i === 0) openBoard() }} ariaLabel="Tasks view" />
            <Btn kind="primary" onClick={create} className="shrink-0">{saving > 0 ? 'Saving…' : 'New task'}</Btn>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="New backlog item…"
          aria-label="New backlog item"
          className="h-8 w-64 max-w-full rounded-lg bg-mc-ctl px-3 text-[13px] outline-none"
        />
      </div>

      {/* Load failure (QA-1 polish item 1). useApi keeps the last good board
          on a failed refresh, so we must SAY it is not current — otherwise a
          dead API looks like a quiet board. Same notice styling as the write
          notice below; no new design. Clears itself on the next good load. */}
      {loadError && (
        <Banner>
          Couldn't load the backlog ({loadError}).{' '}
          {data ? 'Showing the last loaded list; retrying automatically.' : 'Retrying automatically.'}
        </Banner>
      )}

      {notice && (
        <Banner tone={notice.tone === 'ok' ? 'ok' : 'warn'} onDismiss={clearNotice}>{notice.text}</Banner>
      )}

      {/* The row is ~1020px (fixed columns). A clipping card used to cut off
          the "→ To-Do" button and crop long titles at tablet width. Scroll the
          whole table sideways instead; the title cell wraps inside its 320px
          and the row grows (min-h, not a fixed height) so nothing is ellipsized.
          Layout only. */}
      <Card className="mt-8 rounded-2xl px-0 pb-2 overflow-x-auto">
        <div className="min-w-[1020px]">
        <div className="flex px-[18px] pt-4 pb-2">
          {['TICKET', 'TITLE', 'PRIORITY', 'STATUS', 'CREATED', 'ACTIONS'].map((h) => (
            <div key={h} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint" style={{ width: h === 'TITLE' ? 320 : 140 }}>
              {h}
            </div>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">
{/* Only claim "empty" after a successful load (QA-1 polish item 1). */}
            {!data
              ? loading && !loadError
                ? 'Loading…'
                : 'Not loaded — see the notice above.'
              : 'Backlog is empty. Use the field above to add a ticket, then move it to To-Do when it is ready.'}
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center px-[18px] min-h-16 py-2 border-t border-mc-border2">
            <div className="font-mono text-[11.5px] font-semibold text-mc-faint shrink-0" style={{ width: 140 }}>{row.key ?? row.id.slice(0, 8)}</div>
            {/* Full title, wrapped inside the column. The row grows with it. */}
            <div className="text-[13px] font-medium break-words" style={{ width: 320 }}>{row.title}</div>
            <div style={{ width: 140 }}>
              <Chip label={row.priority.toUpperCase()} bg={PRIO[row.priority]?.bg ?? PRIO.med.bg} fg={PRIO[row.priority]?.fg ?? PRIO.med.fg} h={19} fs="text-[10px]" />
            </div>
            <div className="text-[12px] text-mc-sub" style={{ width: 140 }}>{row.status}</div>
            <div className="text-[12px] text-mc-faint" style={{ width: 140 }}>{new Date(row.createdAt).toLocaleDateString()}</div>
            {/* Backlog → To-Do: the only way onto the kanban board from here. */}
            <div className="shrink-0" style={{ width: 140 }}>
              <button
                type="button"
                onClick={() => void moveToTodo(row)}
                disabled={moving.has(row.id)}
                className="h-6 shrink-0 whitespace-nowrap px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                {moving.has(row.id) ? 'Moving…' : '→ To-Do'}
              </button>
            </div>
          </div>
        ))}
        </div>
      </Card>
    </div>
  )
}
