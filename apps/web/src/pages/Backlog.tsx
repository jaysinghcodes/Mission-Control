import { useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { Card, Chip, PillButton } from '../components/ui'

/**
 * Backlog — real backlog tickets from the API, ranked table with create CTA.
 * Create sends status: "backlog" so items land here (not kanban To-Do).
 */

interface Ticket { id: string; key: string | null; title: string; status: string; priority: string; assignee: string | null; tags: string[] | null; createdAt: string }
interface TicketsResp { tickets: Ticket[] }

const PRIO: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'var(--mc-redbg)', fg: 'var(--mc-redtext)' },
  med: { bg: 'var(--mc-orangebg)', fg: 'var(--mc-orangetext)' },
  low: { bg: 'var(--mc-inner)', fg: 'var(--mc-sub)' },
}

export default function Backlog() {
  const { data, refetch } = useApi<TicketsResp>('/tickets?status=backlog', { pollMs: 15000 })
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = data?.tickets ?? []

  async function create() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    // Explicit status: 'backlog' — POST /tickets defaults to 'todo' for the
    // kanban empty-state CTA; without this, Backlog creates never appear on
    // GET /tickets?status=backlog (they land in To-Do instead).
    await apiPost('/tickets', { title: t, priority: 'med', status: 'backlog' })
    setTitle('')
    setBusy(false)
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

      <Card className="mt-8 rounded-2xl px-0 pb-2 overflow-hidden">
        <div className="flex px-[18px] pt-4 pb-2">
          {['TICKET', 'TITLE', 'PRIORITY', 'STATUS', 'CREATED'].map((h) => (
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
          </div>
        ))}
      </Card>
    </div>
  )
}
