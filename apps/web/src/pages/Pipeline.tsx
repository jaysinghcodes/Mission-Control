import { useEffect, useMemo, useState } from 'react'
import { useApi, apiSend } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { PageHeader, Segmented, SoftCard, StatusChip, Btn, Kicker, Face, AgentName, EmptyState, FieldError } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'
import { OPERATOR_ASSIGNEE } from '../config'
import { STAGES, stageCounts, stageIndexForStatus, ticketNeedsYou, type ApprovalLike } from '../lib/board'
import { startedIso } from '../lib/started'
import { TicketRuns } from '../components/TicketRuns'
import { runsForTicket } from '../lib/ticket-runs'

/**
 * Pipeline — the same tickets as the board, in Build → QA → Ship → Deploy.
 * Stage counts use the shared status map (board.ts), so this header matches
 * the Office pipeline panel. Needs-you is a pending approval, not a run flag.
 */

interface Ticket {
  id: string
  key: string | null
  title: string
  status: string
  assignee: string | null
  createdAt: string
}
interface TicketsResp { tickets: Ticket[] }
interface ApprovalsResp { approvals: ApprovalLike[] }
interface RunRow {
  id: string
  name: string
  agent?: string | null
  status: string
  progress?: number | null
  ticketId?: string | null
  startedAt: string | null
  createdAt: string
}
interface RunsResp { runs: RunRow[] }

const STAGE_COLOR = ['var(--mc-blue)', 'var(--mc-orange)', 'var(--mc-green)', 'var(--mc-teal)']

function fmt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Pipeline() {
  const { data, refetch } = useApi<TicketsResp>('/tickets', { pollMs: 10000 })
  const approvalsQ = useApi<ApprovalsResp>('/approvals', { pollMs: 15000 })
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const runsQ = useApi<RunsResp>('/runs', { pollMs: 15000 })
  const { events } = useLiveActivity()
  const refetchApprovals = approvalsQ.refetch
  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState(0)
  const [showDone, setShowDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const roster = rosterQ.data?.agents ?? []
  const runs = runsQ.data?.runs ?? []
  const pending = approvalsQ.data?.approvals ?? []

  useEffect(() => {
    if (events.some((e) => e.type.includes('ticket') || e.type.startsWith('run.'))) void refetch()
    if (events.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [events, refetch, refetchApprovals])

  async function create() {
    const name = title.trim()
    if (!name) {
      setTitleError('Title is required')
      return
    }
    if (busy) return
    setTitleError(null)
    setBusy(true)
    await apiSend('POST', '/tickets', { title: name, priority: 'med', status: 'build' })
    setTitle('')
    setBusy(false)
    void refetch()
  }

  const tickets = data?.tickets ?? []
  const now = Date.now()
  const windowMs = range === 0 ? Infinity : range === 1 ? 86_400_000 : 7 * 86_400_000
  const visible = tickets.filter((t) => windowMs === Infinity || now - new Date(t.createdAt).getTime() < windowMs)
  const moving = visible.filter((t) => {
    const at = stageIndexForStatus(t.status)
    return at !== null && at < 3
  })
  const done = visible.filter((t) => stageIndexForStatus(t.status) === 3)
  const counts = stageCounts(visible)
  const needs = moving.filter((t) => ticketNeedsYou(t, pending)).length

  const summary = data
    ? `${moving.length} moving${needs ? ` · ${needs} needs you` : ''} · ${done.length} finished`
    : 'Loading the trail…'

  const faceFor = useMemo(() => {
    return (agentName: string | null) => {
      const key = (agentName ?? '').toLowerCase()
      const hit = roster.find((a) => a.name.toLowerCase() === key || agentCaption(a.name, a.role).name.toLowerCase() === key)
      if (hit) return hit
      return { id: agentName || 'ticket', name: agentName || OPERATOR_ASSIGNEE, role: null, status: 'working' } as Agent
    }
  }, [roster])

  return (
    <div>
      <PageHeader
        title="Pipeline"
        summary={summary}
        tools={<Segmented labels={['Live', 'Last 24 hours', 'Week']} active={range} onChange={setRange} ariaLabel="Pipeline range" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="Queue a task…"
            aria-label="New task name"
            aria-invalid={!!titleError}
            className="h-8 w-64 max-w-full rounded-lg bg-mc-ctl px-3 text-[13px] outline-none"
          />
          {titleError && <FieldError>{titleError}</FieldError>}
        </div>
        <Btn kind="primary" onClick={() => void create()} disabled={busy}>{busy ? 'Saving…' : 'New task'}</Btn>
      </div>

      {!data && <EmptyState title="Loading…" body="The trail loads from the API." />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STAGES.map((name, i) => (
              <SoftCard key={name} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_COLOR[i] }} />
                    <span className="text-[15px] font-semibold">{name}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-mc-sub">{counts[i] === 0 ? 'Idle' : counts[i] === 1 ? '1 item' : `${counts[i]} items`}</div>
                </div>
                <div className="text-[30px] font-bold tracking-tight">{counts[i]}</div>
              </SoftCard>
            ))}
          </div>

          <div className="mb-3 mt-8">
            <Kicker>Moving now</Kicker>
          </div>
          {moving.length === 0 ? (
            <EmptyState
              title="Nothing is moving"
              body="Queue a task above, or connect your OpenClaw. Seeded demo tickets show up here after npm run seed:demo."
            />
          ) : (
            <SoftCard className="divide-y divide-mc-sep px-2">
              {moving.map((ticket) => {
                const at = stageIndexForStatus(ticket.status) ?? 0
                const who = faceFor(ticket.assignee)
                const blocked = ticketNeedsYou(ticket, pending)
                const open = openId === ticket.id
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setOpenId(open ? null : ticket.id)}
                    className="block w-full px-4 py-4 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <Face agent={{ ...who, status: blocked ? 'blocked' : 'working' }} agents={roster} px={46} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold">{ticket.title}</div>
                        <AgentName name={who.name} role={who.role} />
                        <div className="text-[12.5px] text-mc-sub">Started · {fmt(startedIso(ticket, runs))}</div>
                      </div>
                      <div className="hidden min-w-[280px] items-center md:flex">
                        <div className="relative h-8 flex-1">
                          <div className="absolute left-0 right-0 top-3 h-0.5 bg-mc-track" />
                          {at > 0 && <div className="absolute left-0 top-3 h-0.5 bg-mc-sub2" style={{ width: `${(at / 3) * 100}%` }} />}
                          {STAGES.map((s, j) => (
                            <div key={s} className="absolute top-0" style={{ left: `${(j / 3) * 100}%`, transform: 'translateX(-50%)' }}>
                              <span
                                className="mx-auto block h-3.5 w-3.5 rounded-full border-2"
                                style={{
                                  borderColor: j <= at ? (blocked && j === at ? 'var(--mc-red)' : STAGE_COLOR[j]) : 'var(--mc-track)',
                                  background: j < at ? 'var(--mc-sub2)' : j === at ? (blocked ? 'var(--mc-red)' : STAGE_COLOR[j]) : 'var(--mc-card)',
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      {blocked ? <StatusChip label="Needs you" tone="red" /> : (
                        <span className="whitespace-nowrap text-[13px] text-mc-sub2">In {STAGES[at]}</span>
                      )}
                    </div>
                    {open && (
                      <div className="mt-3 pl-16 text-[12.5px] text-mc-sub">
                        {ticket.key ?? 'No key'} · started {fmt(startedIso(ticket, runs)) || '—'}
                        {blocked ? ' · paused until you decide in Approvals' : ''}
                        <TicketRuns runs={runsForTicket(runs, ticket.id)} />
                      </div>
                    )}
                  </button>
                )
              })}
            </SoftCard>
          )}

          <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-5 text-[13px] text-mc-sub">
            {done.length} finished {range === 2 ? 'this week' : 'in view'}{' '}
            <span className="font-semibold text-mc-accent-text">{showDone ? 'Hide' : 'Show'}</span>
          </button>
          {showDone && done.length > 0 && (
            <SoftCard className="mt-3 divide-y divide-mc-sep">
              {done.map((ticket) => (
                <div key={ticket.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <span className="font-medium">{ticket.title}</span>
                  <span className="shrink-0 whitespace-nowrap text-mc-sub">Started · {fmt(startedIso(ticket, runs))}</span>
                </div>
              ))}
            </SoftCard>
          )}
        </>
      )}
    </div>
  )
}
