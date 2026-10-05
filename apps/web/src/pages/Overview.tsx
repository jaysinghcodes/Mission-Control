import { Link } from 'react-router-dom'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { useApi } from '../hooks/useApi'
import { Bot, KpiCard, PillButton, SectionLabel } from '../components/ui'
// Operator name comes from VITE_OPERATOR_NAME (see config.ts) — no hardcoded names.
import { greeting } from '../config'

/**
 * Overview — live dashboard. KPIs come from the real API (runs, approvals,
 * tickets, usage); the Live Activity band streams real Socket.IO events with
 * persisted history as initial load; Approvals shows real pending requests.
 */

interface RunsResp { runs: { id: string; name: string; agent: string | null; status: string }[] }
interface ApprovalsResp { approvals: { id: string; desc: string; kind: string }[] }
interface TicketsResp { tickets: { id: string; status: string }[] }
interface UsageResp { usage: { totalCost: number } | null }

export default function Overview() {
  const { events, connected } = useLiveActivity()
  const runs = useApi<RunsResp>('/runs')
  const approvals = useApi<ApprovalsResp>('/approvals')
  const tickets = useApi<TicketsResp>('/tickets')
  const usage = useApi<UsageResp>('/usage')

  const running = runs.data?.runs.filter((r) => r.status === 'running').length ?? 0
  const pending = approvals.data?.approvals.length ?? 0
  const shipped = tickets.data?.tickets.filter((t) => t.status === 'done').length ?? 0
  const spend = usage.data?.usage?.totalCost ?? null

  const kpis = [
    { value: String(running), label: 'Tasks Running' },
    { value: String(pending), label: 'Pending Approvals' },
    { value: String(shipped), label: 'Shipped Today' },
    { value: spend != null ? `$${spend.toFixed(2)}` : '—', label: 'Spend · 24H' },
  ]

  const liveRows = events.slice(0, 6).map((ev, i) => {
    const p = ev.payload && typeof ev.payload === 'object' ? (ev.payload as Record<string, unknown>) : {}
    const name = 'name' in p ? String(p.name) : ''
    return {
      agent: ev.type === 'health.tick' ? 'system' : 'openclaw',
      color: ev.type === 'run.failed' ? 'var(--mc-red)' : ev.type === 'run.completed' ? 'var(--mc-green)' : 'var(--mc-blue)',
      action: `${ev.type}${name ? ' · ' + name : ''}`,
      key: `${ev.ts}-${i}`,
    }
  })

  return (
    <div className="p-6">
      {/* Time-of-day greeting; personalised only when VITE_OPERATOR_NAME is set
          (neutral "Good evening" on a fresh clone — ticket 3). */}
      <div className="text-[34px] font-semibold leading-tight">{greeting()}</div>
      <div className="mt-1 text-[14.5px] text-mc-sub">Live state from your OpenClaw instance.</div>

      {/* KPI tiles — real values from the API */}
      <div className="grid grid-cols-4 gap-5 mt-8">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} value={kpi.value} label={kpi.label} />
        ))}
      </div>

      <div className="mt-8 h-px bg-mc-border2" />

      <div className="grid grid-cols-2 gap-10 mt-8">
        {/* Live Activity band */}
        <div>
          <SectionLabel>Live Activity</SectionLabel>
          <div className="mt-4">
            {liveRows.length > 0 ? (
              liveRows.map((row) => (
                <div key={row.key} className="flex items-center gap-3 py-[13px] border-b border-mc-border2">
                  <Bot color={row.color} scale={1} />
                  <span className="text-[13px] font-semibold">{row.agent}</span>
                  <span className="text-[12.5px] text-mc-sub truncate">{row.action}</span>
                </div>
              ))
            ) : (
              <div className="py-6 text-[12.5px] text-mc-faint">
                {connected ? 'Connected — waiting for the first event…' : '● offline — API not reachable'}
              </div>
            )}
            <div className="mt-3 text-[12px] text-mc-faint">
              {connected ? '● streaming live' : '● offline — API not reachable'}
            </div>
          </div>
        </div>

        {/* Approvals needed */}
        <div>
          <SectionLabel>Approvals Needed</SectionLabel>
          <div className="mt-4">
            {approvals.data && approvals.data.approvals.length > 0 ? (
              approvals.data.approvals.slice(0, 4).map((row) => (
                <div key={row.id} className="flex items-center gap-3 py-[13px] border-b border-mc-border2">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-mc-amber" />
                  <span className="text-[12.5px] font-medium flex-1 truncate">{row.desc}</span>
                  <Link to="/approvals">
                    <PillButton label="Review" on className="h-7 px-4 text-[12px]" />
                  </Link>
                </div>
              ))
            ) : (
              <div className="py-6 text-[12.5px] text-mc-faint">Nothing pending — you're all caught up.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
