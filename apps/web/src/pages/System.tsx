import { Fragment, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useApiStatus } from '../lib/apiStatus'
import { PageHeader, Segmented, SoftCard, StatusChip, Face, Kicker, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'
import Logs from './Logs'
import Sessions from './Sessions'
import Settings from './Settings'
import CustomTools from './CustomTools'

/**
 * System. Health, models and spend, and the old observe pages behind a click.
 * Last 24 hours / last 7 days / month to date read GET /usage?period=24h|7d|month.
 * Those windows are sums of daily points. 24h is a rolling day. A short range
 * shows the API note (for example "Showing 3 days of data so far") and only
 * the days that were collected.
 */

interface HealthResp { status: string; database: string; uptimeSeconds: number; lastIngestAt?: string | null }
interface SystemResp {
  cpu: { pct: number }
  memory: { pct: number }
  os: { hostname: string; platform: string }
}
interface Provider {
  name?: string
  model?: string
  cost?: number
  tokensIn?: number
  tokensOut?: number
  agents?: string[]
}
interface Usage {
  period: string
  totalCost: number
  tokensIn: number
  tokensOut: number
  providers: Provider[] | Record<string, Provider> | null
}
interface UsageResp {
  usage: Usage | null
  note?: string | null
  days?: { day: string; totalCost: number }[]
}
interface EventApi { type: string; payload: { name?: string; summary?: string; agent?: string } | null; ts: string }

const PERIODS = [
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'Month to date' },
] as const

function providersOf(usage: Usage | null | undefined): Provider[] {
  if (!usage?.providers) return []
  return Array.isArray(usage.providers) ? usage.providers : Object.values(usage.providers)
}

const STALE_MS = 15 * 60 * 1000

function ingestFact(iso: string | null | undefined): { value: string; ok: boolean } {
  if (!iso) return { value: 'Not connected', ok: false }
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return { value: 'Not connected', ok: false }
  const age = Date.now() - at
  const mins = Math.max(0, Math.round(age / 60000))
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
  return { value: `Last ingest ${when}`, ok: age < STALE_MS }
}

function money(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'No data'
  if (n === 0) return '$0'
  return `$${n.toFixed(2)}`
}

function tokens(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'No data'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function barLabel(day: string, count: number): string {
  const [, month, date] = day.split('-').map(Number)
  if (!month || !date) return day
  if (count > 10) return String(date)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(2026, month - 1, date)))
  return `${name} ${date}`
}

function SpendBars({ days, label }: { days: { day: string; totalCost: number }[]; label: string }) {
  if (days.length === 0) return null
  const max = Math.max(...days.map((d) => d.totalCost), 0)
  const summary = days.map((d) => `${barLabel(d.day, days.length)} ${money(d.totalCost)}`).join(', ')
  return (
    <div className="px-4 pb-3" role="img" aria-label={`Daily spend for ${label}. ${summary}`}>
      <div className="flex h-16 items-end gap-1">
        {days.map((d) => {
          const pct = max <= 0 ? 12 : Math.max(12, Math.round((d.totalCost / max) * 100))
          return (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="w-full rounded-t bg-mc-accent" style={{ height: `${pct}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {days.map((d) => (
          <div key={d.day} className="min-w-0 flex-1 truncate text-center text-[10px] text-mc-sub">
            {barLabel(d.day, days.length)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function System() {
  const { panel } = useParams()
  const health = useApi<HealthResp>('/health', { pollMs: 10000 })
  const sys = useApi<SystemResp>('/system', { pollMs: 10000 })
  const day = useApi<UsageResp>('/usage?period=24h', { pollMs: 30000 })
  const week = useApi<UsageResp>('/usage?period=7d', { pollMs: 30000 })
  const month = useApi<UsageResp>('/usage?period=month', { pollMs: 30000 })
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const sessions = useApi<{ sessions: { agent: string; model: string | null }[] }>('/sessions', { pollMs: 30000 })
  const activity = useApi<{ events: EventApi[] }>('/activity?limit=30', { pollMs: 20000 })
  const api = useApiStatus()
  const [period, setPeriod] = useState(2)
  const [modelOpen, setModelOpen] = useState<string | null>(null)

  const snaps = [day.data?.usage ?? null, week.data?.usage ?? null, month.data?.usage ?? null]
  const responses = [day.data, week.data, month.data]
  const selected = snaps[period]
  const selectedNote = responses[period]?.note || ''
  const selectedDays = responses[period]?.days ?? []
  const any = snaps.some(Boolean)
  const roster = rosterQ.data?.agents ?? []

  const models = useMemo(() => {
    const names = new Set<string>()
    for (const snap of snaps) for (const p of providersOf(snap)) names.add(p.model || p.name || 'model')
    return [...names]
  }, [day.data, week.data, month.data])

  const periodSpend = selected?.totalCost
  const periodName = PERIODS[period].label.toLowerCase()
  const summary = health.data
    ? `${health.data.status === 'ok' ? 'All systems normal' : 'Degraded'}${typeof periodSpend === 'number' ? ` · ${money(periodSpend)} spent ${periodName}` : any ? '' : ' · no spend reported'}`
    : 'Checking health…'
  const bridge = ingestFact(health.data?.lastIngestAt)

  const issue = (activity.data?.events ?? []).find((e) => /fail|error|timeout/i.test(`${e.type} ${e.payload?.name ?? ''} ${e.payload?.summary ?? ''}`))

  if (panel === 'logs' || panel === 'sessions' || panel === 'settings' || panel === 'connection' || panel === 'tools') {
    return (
      <div>
        <Link to="/system" className="mb-3 inline-block text-[13px] font-semibold text-mc-accent-text">← System</Link>
        {panel === 'logs' && <Logs />}
        {panel === 'sessions' && <Sessions />}
        {panel === 'settings' && <Settings />}
        {panel === 'tools' && <CustomTools />}
        {panel === 'connection' && (
          <div>
            <PageHeader title="Connection" summary="How this browser reaches the API." />
            <SoftCard className="px-5 py-4 text-[14px]">
              <p>The API is loopback-only. From another machine, use the SSH tunnel in setup.</p>
              <Link to="/connect" className="mt-3 inline-block font-semibold text-mc-accent-text">Open setup</Link>
            </SoftCard>
          </div>
        )}
      </div>
    )
  }

  const latency = api.latencyMs !== null ? `${api.latencyMs} ms` : 'Waiting'
  const host = sys.data ? `${sys.data.os.hostname}` : 'Waiting'
  const cpu = sys.data ? `CPU ${sys.data.cpu.pct}% · Mem ${sys.data.memory.pct}%` : 'Waiting on /system'

  return (
    <div>
      <PageHeader title="System" summary={summary} />

      <SoftCard className="flex flex-wrap items-center gap-6 px-6 py-5">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-mc-greenbg text-lg text-mc-greentext">
          {health.data?.status === 'ok' ? '✓' : '…'}
        </span>
        <div className="min-w-[180px]">
          <div className="text-[19px] font-bold tracking-tight">
            {health.data ? (health.data.status === 'ok' ? "Everything's running" : 'The API is unhappy') : 'Checking…'}
          </div>
          <div className="text-[12.5px] text-mc-sub">
            {health.data ? `Database ${health.data.database}` : 'Waiting for /health'}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-6">
          <Fact label="API" value={api.state === 'offline' ? 'Offline' : `Connected · ${latency}`} />
          <Fact label="OpenClaw bridge" value={bridge.value} ok={bridge.ok} />
          <Fact label={`Host · ${host}`} value={cpu} />
        </div>
      </SoftCard>

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <Kicker>Models & spend</Kicker>
        <span className="text-[12px] text-mc-sub">Found automatically in OpenClaw sessions · estimated</span>
      </div>
      <div className="mb-3">
        <Segmented
          labels={PERIODS.map((p) => p.label)}
          active={period}
          onChange={setPeriod}
          ariaLabel="Spend period"
        />
      </div>

      {!any && (day.data || week.data || month.data) && (
        <EmptyState
          title="No model spend yet"
          body="The bridge is not posting usage. Connect OpenClaw (bridge/mc-bridge-sync.py) or run npm run seed:demo. The last 24 hours, the last 7 days, and the month to date stay empty until a daily point exists. A per model price override is not part of this build."
        />
      )}
      {!day.data && !week.data && !month.data && (
        <EmptyState title="Usage not loaded" body="Waiting for the API. If it stays down, data on this page is missing rather than zero." />
      )}

      {any && (
        <SoftCard className="px-2 py-2">
          <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-3">
            {PERIODS.map((p, i) => {
              const snap = snaps[i]
              const on = i === period
              const tok = snap ? (snap.tokensIn ?? 0) + (snap.tokensOut ?? 0) : null
              return (
                <button key={p.id} type="button" onClick={() => setPeriod(i)} className={`rounded-xl px-3 py-2 text-left ${on ? 'bg-mc-sel' : ''}`}>
                  <div className="text-[12.5px] font-semibold text-mc-sub">{p.label}</div>
                  <div className="mt-1 whitespace-nowrap text-[28px] font-bold tracking-tight">{snap ? money(snap.totalCost) : 'No data'}</div>
                  <div className="text-[12.5px] text-mc-sub">{tok === null ? 'No data yet' : `${tokens(tok)} tokens`}</div>
                </button>
              )
            })}
          </div>
          {selectedNote ? <p className="px-4 pb-1 text-[13px] text-mc-sub">{selectedNote}</p> : null}
          {!selected ? <p className="px-4 pb-2 text-[13px] text-mc-sub">No data for this range yet</p> : (
            <SpendBars days={selectedDays} label={PERIODS[period].label} />
          )}
          <div className="mc-spend mt-2">
            <div className="mc-spend-cards">
              {models.map((model) => {
                const cells = snaps.map((snap) => providersOf(snap).find((p) => (p.model || p.name) === model))
                const focus = cells[period]
                const who = agentsFor(model, focus, roster, sessions.data?.sessions ?? [])
                const open = modelOpen === model
                return (
                  <div key={model} className="border-t border-mc-sep px-4 py-3">
                    <button type="button" onClick={() => setModelOpen(open ? null : model)} className="text-left">
                      <div className="text-[14.5px] font-semibold break-words">{model}</div>
                      <div className="text-[12px] text-mc-sub">{focus?.name || 'session'} · OpenClaw cost</div>
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      {who.slice(0, 4).map((a) => <Face key={a.id} agent={a} agents={roster} px={28} />)}
                      <span className="text-[12px] text-mc-sub">{who.length ? `${who.length} agents` : 'No agent tagged'}</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {PERIODS.map((p, i) => (
                        <div key={p.id} className="flex items-baseline justify-between gap-4 text-[13px]">
                          <span className="shrink-0">{p.label}</span>
                          <span className={`shrink-0 whitespace-nowrap tabular-nums ${i === period ? 'font-semibold text-mc-text' : 'text-mc-sub2'}`}>
                            {cells[i] ? money(cells[i]?.cost) : 'No data'}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between gap-4 text-[12.5px] text-mc-sub">
                        <span className="shrink-0">Tokens</span>
                        <span className="shrink-0 whitespace-nowrap">{tokens((focus?.tokensIn ?? 0) + (focus?.tokensOut ?? 0))}</span>
                      </div>
                    </div>
                    {open && (
                      <p className="mt-3 text-[13px] text-mc-sub">
                        Estimated from session counters in the {PERIODS[period].label.toLowerCase()} window. Month to date is the calendar month in Central Time. A long session counts on the day of its last activity. This build does not store a per token price.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mc-spend-table overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[11.5px] text-mc-sub">
                    <th className="whitespace-nowrap px-4 py-2 font-semibold">Model</th>
                    <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">Tokens · {PERIODS[period].label.toLowerCase()}</th>
                    {PERIODS.map((p) => (
                      <th key={p.id} className="whitespace-nowrap px-4 py-2 text-right font-semibold">{p.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => {
                    const cells = snaps.map((snap) => providersOf(snap).find((p) => (p.model || p.name) === model))
                    const focus = cells[period]
                    const who = agentsFor(model, focus, roster, sessions.data?.sessions ?? [])
                    const open = modelOpen === model
                    return (
                      <Fragment key={model}>
                        <tr className="border-t border-mc-sep">
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => setModelOpen(open ? null : model)} className="text-left">
                              <div className="whitespace-nowrap text-[14.5px] font-semibold">{model}</div>
                              <div className="text-[12px] text-mc-sub">{focus?.name || 'session'} · OpenClaw cost</div>
                            </button>
                            <div className="mt-1 flex items-center gap-1">
                              {who.slice(0, 4).map((a) => <Face key={a.id} agent={a} agents={roster} px={28} />)}
                              <span className="text-[12px] text-mc-sub">{who.length ? `${who.length} agents` : 'No agent tagged'}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-[14px]">{tokens((focus?.tokensIn ?? 0) + (focus?.tokensOut ?? 0))}</td>
                          {cells.map((c, i) => (
                            <td key={PERIODS[i].id} className={`whitespace-nowrap px-4 py-3 text-right text-[14px] tabular-nums ${i === period ? 'font-semibold text-mc-text' : 'text-mc-sub2'}`}>
                              {c ? money(c.cost) : 'No data'}
                            </td>
                          ))}
                        </tr>
                        {open && (
                          <tr className="border-t border-mc-sep bg-mc-bg">
                            <td colSpan={5} className="px-4 py-3 text-[13px] text-mc-sub">
                              Estimated from session counters in the {PERIODS[period].label.toLowerCase()} window. Month to date is the calendar month in Central Time. A long session counts on the day of its last activity. This build does not store a per token price.
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="px-4 py-3 text-[12.5px] text-mc-sub">
            Estimates use the cost OpenClaw reports for each session. Showing <span className="font-semibold text-mc-text">{PERIODS[period].label}</span>
            {selected ? ` · ${money(selected.totalCost)}` : ''}.
          </p>
        </SoftCard>
      )}

      <div className="mb-3 mt-8"><Kicker>Recent issues</Kicker></div>
      {issue ? (
        <SoftCard className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Face
            agent={roster.find((a) => a.name === issue.payload?.agent) ?? { id: 'issue', name: issue.payload?.agent || 'Scout', role: null, status: 'idle' }}
            agents={roster}
            px={34}
          />
          <div className="min-w-0 flex-1 text-[14px] font-semibold">{issue.payload?.name || issue.payload?.summary || issue.type}</div>
          <StatusChip label="Retrying" tone="orange" />
        </SoftCard>
      ) : (
        <SoftCard className="px-4 py-4 text-[13px] text-mc-sub">No recent issues in the activity feed.</SoftCard>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Logs', 'Live', 'logs'],
          ['Sessions', `${sessions.data?.sessions.length ?? 0} active`, 'sessions'],
          ['Connection', 'SSH tunnel', 'connection'],
          ['Settings', 'Theme, account', 'settings'],
          ['Custom tools', 'Experimental', 'tools'],
        ].map(([label, hint, id]) => (
          <Link key={id} to={`/system/${id}`} className="mc-card flex items-center justify-between px-4 py-3">
            <span className="text-[14px] font-semibold">{label}</span>
            <span className="text-[12.5px] text-mc-sub">{hint} ›</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Fact({ label, value, ok = true }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-mc-sub">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-mc-green' : 'bg-mc-gray'}`} />
        {label}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[13px]">{value}</div>
    </div>
  )
}

function agentsFor(model: string, provider: Provider | undefined, roster: Agent[], sessions: { agent: string; model: string | null }[]): Agent[] {
  const named = provider?.agents ?? []
  const fromSessions = sessions.filter((s) => s.model && (s.model === model || s.model.endsWith(`/${model}`) || model.endsWith(s.model))).map((s) => s.agent)
  const keys = [...named, ...fromSessions]
  const out: Agent[] = []
  for (const key of keys) {
    const hit = roster.find((a) => a.name === key || agentCaption(a.name, a.role).name === key)
    if (hit && !out.some((a) => a.id === hit.id)) out.push(hit)
  }
  return out
}
