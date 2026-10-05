import { useState } from 'react'
import { useApi, apiPost, apiPatch } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { useEffect } from 'react'
import { Bot, Card, Chip, Inner, PillButton, SectionLabel } from '../components/ui'

/**
 * Tickets — full-page kanban, fully functional (Jay fix #9) + Option B (MC-214).
 *  - New tickets land in TO-DO and are visible instantly
 *  - 5 office-aligned columns: To-Do → Build → QA → Review → Done
 *  - Cards move through all 5 via PATCH; legacy `inprogress` rows render in Build
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

/**
 * Move a ticket between kanban columns.
 *
 * MUST use apiPatch → PATCH /tickets/:id. The API only registers
 * `@Patch(':id')` (see tickets.controller.ts); a POST to the same path 404s,
 * so the old apiPost call made "Start / QA / Review / Done" no-ops and broke
 * ONBOARDING Step 8's ticket smoke loop on a fresh clone (no OpenClaw needed
 * for this path — the controller itself persists run.* activity events).
 */
async function patchTicket(id: string, status: string): Promise<boolean> {
  return (await apiPatch(`/tickets/${id}`, { status })) !== null
}

export default function Tickets() {
  const { data, refetch } = useApi<TicketsResp>('/tickets', { pollMs: 10000 })
  const { events } = useLiveActivity()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const tickets = data?.tickets ?? []

  // Instant refresh on any ticket/run activity event.
  useEffect(() => {
    if (events.some((e) => e.type.startsWith('run.') || e.type.includes('ticket'))) void refetch()
  }, [events, refetch])

  async function create() {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    await apiPost('/tickets', { title: t, priority: 'med' })
    setTitle('')
    setBusy(false)
    void refetch()
  }

  async function move(id: string, status: string) {
    await patchTicket(id, status)
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[22px] font-semibold">Tickets</div>
          <div className="mt-1 text-[13px] text-mc-sub">Kanban — create a ticket, then move it To-Do → Build → QA → Review → Done.</div>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="New ticket title…"
            className="h-9 w-64 rounded-full border border-mc-border bg-mc-card px-4 text-[13px] text-mc-text placeholder:text-mc-faint outline-none focus:border-mc-primary"
          />
          <PillButton label="+ New ticket" on onClick={() => void create()} />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mt-6">
        {COLUMNS.map((col) => {
          const rows = tickets.filter((t) => inColumn(t, col))
          return (
            <Card key={col.title} className="px-3.5 py-3 min-h-[380px]">
              <div className="flex items-center justify-between px-1">
                <SectionLabel>{col.title}</SectionLabel>
                <span className="text-[11px] font-semibold text-mc-sub">{rows.length}</span>
              </div>
              <div className="mt-3 space-y-3">
                {rows.length === 0 && (
                  <div className="text-[12px] text-mc-faint px-1 py-4">
                    {col.title === 'Done' ? 'Nothing shipped yet.' : col.title === 'To-Do' ? 'Empty — create a ticket above.' : `Nothing in ${col.title} yet.`}
                  </div>
                )}
                {rows.map((t) => (
                  <Inner key={t.id} className="rounded-[10px] px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-semibold text-mc-faint">{t.key ?? t.id.slice(0, 8)}</span>
                      <Chip label={t.priority.toUpperCase()} bg={PRIO[t.priority]?.bg ?? PRIO.med.bg} fg={PRIO[t.priority]?.fg ?? PRIO.med.fg} h={18} fs="text-[10px]" />
                    </div>
                    <div className="mt-1.5 text-[13px] font-semibold leading-snug">{t.title}</div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Bot color={t.assignee ? 'var(--mc-primary)' : 'var(--mc-faint)'} scale={0.8} />
                      <span className="text-[11px] text-mc-sub truncate">{t.assignee ?? 'unassigned'}</span>
                    </div>
                    {/* Pipeline actions — full movement through all 5 columns (MC-214) */}
                    <div className="mt-2.5 flex items-center gap-2">
                      {t.status === 'todo' && (
                        <button
                          type="button"
                          onClick={() => void move(t.id, 'inprogress')}
                          className="h-6 px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
                        >
                          ▶ Start
                        </button>
                      )}
                      {(t.status === 'build' || t.status === 'inprogress') && (
                        <>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'qa')}
                            className="h-6 px-3 rounded-full bg-mc-bluebg text-mc-bluetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
                          >
                            ✓ QA
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'todo')}
                            className="h-6 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
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
                            className="h-6 px-3 rounded-full bg-mc-orangebg text-mc-orangetext text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
                          >
                            ✓ Review
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'inprogress')}
                            className="h-6 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
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
                            className="h-6 px-3 rounded-full bg-mc-greenbg text-mc-greentext text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
                          >
                            ✓ Done
                          </button>
                          <button
                            type="button"
                            onClick={() => void move(t.id, 'qa')}
                            className="h-6 px-3 rounded-full bg-mc-inner text-mc-sub text-[10.5px] font-semibold hover:opacity-80 transition-opacity"
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

      {/* Pipeline metrics */}
      <div className="grid grid-cols-5 gap-4 mt-6">
        {metrics.map((m) => (
          <Card key={m.label} className="px-3 py-2">
            <div className="text-[18px] font-semibold">{m.value}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-mc-faint">{m.label}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}
