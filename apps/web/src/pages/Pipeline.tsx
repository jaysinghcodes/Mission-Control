import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { PageHeader, Segmented, SoftCard, StatusChip, Btn, Kicker, Face, AgentName, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'
import { OPERATOR_ASSIGNEE } from '../config'

/**
 * Pipeline — the old Tasks run trail, drawn as Build → QA → Ship → Deploy.
 * Live runs come from GET /runs. With no runs (and no bridge) the page says so.
 */

interface Run {
  id: string
  name: string
  agent: string | null
  status: string
  progress: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
interface RunsResp { runs: Run[] }

const STAGES = ['Build', 'QA', 'Ship', 'Deploy'] as const
const STAGE_COLOR = ['var(--mc-blue)', 'var(--mc-orange)', 'var(--mc-green)', 'var(--mc-teal)']

function stageIndex(run: Run): number {
  if (run.status === 'needs_approval') return 2
  if (run.status === 'done' || run.status === 'failed') return 3
  if (run.status === 'queued') return 0
  const p = run.progress
  if (p < 35) return 0
  if (p < 70) return 1
  return 2
}

function fmt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function age(iso: string | null): string {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m`
}

export default function Pipeline() {
  const { data, refetch } = useApi<RunsResp>('/runs', { pollMs: 10000 })
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const { events } = useLiveActivity()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState(0)
  const [showDone, setShowDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const prevStatus = useRef<Record<string, string>>({})
  const roster = rosterQ.data?.agents ?? []

  useEffect(() => {
    if (events.some((e) => e.type.startsWith('run.'))) void refetch()
  }, [events, refetch])

  useEffect(() => {
    for (const run of data?.runs ?? []) {
      const prev = prevStatus.current[run.id]
      if (prev && prev !== run.status) {
        setFlashId(run.id)
        setTimeout(() => setFlashId(null), 1800)
      }
      prevStatus.current[run.id] = run.status
    }
  }, [data])

  async function create() {
    const name = title.trim()
    if (!name || busy) return
    setBusy(true)
    await apiPost('/runs', { name })
    setTitle('')
    setBusy(false)
    void refetch()
  }

  const runs = data?.runs ?? []
  const now = Date.now()
  const windowMs = range === 0 ? Infinity : range === 1 ? 86_400_000 : 7 * 86_400_000
  const visible = runs.filter((r) => windowMs === Infinity || now - new Date(r.createdAt).getTime() < windowMs)
  const moving = visible.filter((r) => r.status !== 'done' && r.status !== 'failed')
  const done = visible.filter((r) => r.status === 'done' || r.status === 'failed')
  const needs = moving.filter((r) => r.status === 'needs_approval').length
  const counts = STAGES.map((_, i) => moving.filter((r) => stageIndex(r) === i).length)

  const summary = data
    ? `${moving.length} moving${needs ? ` · ${needs} needs you` : ''} · ${done.length} finished`
    : 'Loading the trail…'

  const faceFor = useMemo(() => {
    return (agentName: string | null) => {
      const key = (agentName ?? '').toLowerCase()
      const hit = roster.find((a) => a.name.toLowerCase() === key || agentCaption(a.name, a.role).name.toLowerCase() === key)
      if (hit) return hit
      return { id: agentName || 'run', name: agentName || OPERATOR_ASSIGNEE, role: null, status: 'working' } as Agent
    }
  }, [roster])

  return (
    <div>
      <PageHeader
        title="Pipeline"
        summary={summary}
        tools={<Segmented labels={['Live', 'Today', 'Week']} active={range} onChange={setRange} ariaLabel="Pipeline range" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
          placeholder="Queue a task…"
          aria-label="New task name"
          className="h-8 w-64 max-w-full rounded-lg bg-mc-ctl px-3 text-[13px] outline-none"
        />
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
              body="Queue a task above, or connect the OpenClaw bridge. Seeded demo runs show up here after npm run seed:demo."
            />
          ) : (
            <SoftCard className="divide-y divide-mc-sep px-2">
              {moving.map((run) => {
                const at = stageIndex(run)
                const who = faceFor(run.agent)
                const blocked = run.status === 'needs_approval'
                const open = openId === run.id
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setOpenId(open ? null : run.id)}
                    className={`block w-full px-4 py-4 text-left ${flashId === run.id ? 'bg-mc-sel' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-4">
                      <Face agent={{ ...who, status: blocked ? 'blocked' : 'working' }} agents={roster} px={46} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-semibold">{run.name}</div>
                        <AgentName name={who.name} role={who.role} />
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
                        <span className="whitespace-nowrap text-[13px] text-mc-sub2">
                          {run.status === 'queued' ? 'Queued' : `In ${STAGES[at]} · ${age(run.startedAt ?? run.createdAt)}`}
                        </span>
                      )}
                    </div>
                    {open && (
                      <div className="mt-3 pl-16 text-[12.5px] text-mc-sub">
                        Queued {fmt(run.createdAt) || '—'}
                        {run.startedAt ? ` · started ${fmt(run.startedAt)}` : ''}
                        {run.status === 'running' ? ` · ${run.progress}%` : ''}
                        {blocked ? ' · paused until you decide in Approvals' : ''}
                      </div>
                    )}
                  </button>
                )
              })}
            </SoftCard>
          )}

          <button type="button" onClick={() => setShowDone((v) => !v)} className="mt-5 text-[13px] text-mc-sub">
            {done.length} finished {range === 2 ? 'this week' : 'in view'}{' '}
            <span className="font-semibold text-mc-accent">{showDone ? 'Hide' : 'Show'}</span>
          </button>
          {showDone && done.length > 0 && (
            <SoftCard className="mt-3 divide-y divide-mc-sep">
              {done.map((run) => (
                <div key={run.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <span className="font-medium">{run.name}</span>
                  <span className="text-mc-sub">{run.status === 'failed' ? 'Failed' : 'Deployed'} · {fmt(run.finishedAt)}</span>
                </div>
              ))}
            </SoftCard>
          )}
        </>
      )}
    </div>
  )
}
