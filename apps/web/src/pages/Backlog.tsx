import { useEffect, useRef, useState } from 'react'
import { useApi, apiSend } from '../hooks/useApi'
import { Card, Chip, PillButton } from '../components/ui'

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
  const { data, refetch, mutate } = useApi<TicketsResp>('/tickets?status=backlog', { pollMs: 15000 })
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Row ids with a "→ To-Do" move in flight (disables that row's button so a
  // double-click doesn't fire two identical PATCHes).
  const [moving, setMoving] = useState<Set<string>>(new Set())
  // Inline notice: success ("MC-151 moved to To-Do") or a gentle error.
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rows = data?.tickets ?? []

  function showNotice(text: string, tone: 'ok' | 'warn') {
    setNotice({ text, tone })
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  async function create() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    // Explicit status: 'backlog' — matches today's API default, but stays
    // correct even if DEFAULT_CREATE_STATUS changes (see header comment).
    const r = await apiSend<{ ticket: Ticket }>('POST', '/tickets', { title: t, priority: 'med', status: 'backlog' })
    if (r.ok) {
      setTitle('') // keep the typed title on failure so nothing is lost
    } else {
      showNotice(`Couldn't create ticket — ${r.error}`, 'warn')
    }
    setBusy(false)
    void refetch()
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
      showNotice(`${label} moved to To-Do — find it on the Tickets board.`, 'ok')
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

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[22px] font-semibold">Backlog</div>
          <div className="mt-1 text-[13px] text-mc-sub">Every ticket not yet started — ranked, tagged, ready to pull.</div>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="New backlog item…"
            className="h-9 w-64 rounded-full border border-mc-border bg-mc-card px-4 text-[13px] text-mc-text placeholder:text-mc-faint outline-none focus:border-mc-primary"
          />
          <PillButton label="+  New ticket" on onClick={() => void create()} />
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={`mt-4 flex items-center justify-between rounded-[10px] px-4 py-2 text-[12.5px] ${
            notice.tone === 'ok' ? 'bg-mc-greenbg text-mc-greentext' : 'bg-mc-orangebg text-mc-orangetext'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-4 text-[11px] font-semibold hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      <Card className="mt-8 rounded-2xl px-0 pb-2 overflow-hidden">
        <div className="flex px-[18px] pt-4 pb-2">
          {['TICKET', 'TITLE', 'PRIORITY', 'STATUS', 'CREATED', 'ACTIONS'].map((h) => (
            <div key={h} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint" style={{ width: h === 'TITLE' ? 320 : 140 }}>
              {h}
            </div>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">
            Backlog is empty. Use the field above to add a ticket — Jarvis will pick it up.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center px-[18px] h-16 border-t border-mc-border2">
            <div className="font-mono text-[11.5px] font-semibold text-mc-faint" style={{ width: 140 }}>{row.key ?? row.id.slice(0, 8)}</div>
            <div className="text-[13px] font-medium" style={{ width: 320 }}>{row.title}</div>
            <div style={{ width: 140 }}>
              <Chip label={row.priority.toUpperCase()} bg={PRIO[row.priority]?.bg ?? PRIO.med.bg} fg={PRIO[row.priority]?.fg ?? PRIO.med.fg} h={19} fs="text-[10px]" />
            </div>
            <div className="text-[12px] text-mc-sub" style={{ width: 140 }}>{row.status}</div>
            <div className="text-[12px] text-mc-faint" style={{ width: 140 }}>{new Date(row.createdAt).toLocaleDateString()}</div>
            {/* Backlog → To-Do: the only way onto the kanban board from here. */}
            <div style={{ width: 140 }}>
              <button
                type="button"
                onClick={() => void moveToTodo(row)}
                disabled={moving.has(row.id)}
                className="h-6 px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                {moving.has(row.id) ? 'Moving…' : '→ To-Do'}
              </button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
