import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { PageHeader, Segmented, SoftCard, Face, AgentName, SearchInput, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'
import { agentNeedsYou, mentions, pendingBlob, stageCounts, type ApprovalLike } from '../lib/board'

/**
 * Office — Build / QA / Ship / Deploy desks, Commons, Activity and Pipeline.
 * Placement follows role. Idle agents in a desk room stay at the desk;
 * chief, research, support and trends sit in the Commons.
 */

interface EventApi { type: string; payload: { name?: string; summary?: string; agent?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }
interface Ticket { status: string; key?: string | null; title?: string | null; assignee?: string | null }
interface TicketsResp { tickets: Ticket[] }
interface ApprovalsResp { approvals: ApprovalLike[] }

type Room = 'build' | 'qa' | 'ship' | 'deploy' | 'commons'

const ROOMS: { id: Room; label: string; color: string }[] = [
  { id: 'build', label: 'Build', color: 'var(--mc-blue)' },
  { id: 'qa', label: 'QA', color: 'var(--mc-orange)' },
  { id: 'ship', label: 'Ship', color: 'var(--mc-green)' },
  { id: 'deploy', label: 'Deploy', color: 'var(--mc-teal)' },
]

function roomFor(agent: Agent): Room {
  const r = `${agent.role ?? ''} ${agent.name}`.toLowerCase()
  if (/chief|research|support|scout|trend/.test(r)) return 'commons'
  if (/qa|quality|security|alert/.test(r)) return 'qa'
  if (/writer|summary|scribe|review/.test(r)) return 'ship'
  if (/ops|data|deploy/.test(r)) return 'deploy'
  if (/eng|dev|design|product/.test(r)) return 'build'
  return agent.status === 'working' ? 'build' : 'commons'
}

function Desk() {
  return (
    <div className="pointer-events-none mx-auto -mt-3 w-[120px]" aria-hidden>
      <div className="mx-auto h-8 w-14 rounded-md bg-[#1d1d1f] p-1">
        <div className="h-full w-full rounded-sm bg-[#2c2c2e]">
          <div className="ml-1 mt-1 h-0.5 w-6 rounded bg-mc-accent" />
          <div className="ml-1 mt-1 h-0.5 w-8 rounded bg-[#636366]" />
        </div>
      </div>
      <div className="mx-auto h-2.5 w-[88px] rounded-full bg-mc-fill" />
    </div>
  )
}

export default function Office() {
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 20000 })
  const activityQ = useApi<ActivityResp>('/activity?limit=12', { pollMs: 15000 })
  const ticketsQ = useApi<TicketsResp>('/tickets', { pollMs: 20000 })
  const approvalsQ = useApi<ApprovalsResp>('/approvals', { pollMs: 15000 })
  const { events: liveEvents } = useLiveActivity()
  const refetchApprovals = approvalsQ.refetch
  const agents = agentsQ.data?.agents ?? []
  const pending = approvalsQ.data?.approvals ?? []
  const ticketRows = ticketsQ.data?.tickets ?? []

  useEffect(() => {
    if (liveEvents.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [liveEvents, refetchApprovals])

  function needs(agent: Agent): boolean {
    return agentNeedsYou(agent, pending, ticketRows)
  }
  const [filter, setFilter] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const placed = useMemo(() => {
    const buckets: Record<Room, Agent[]> = { build: [], qa: [], ship: [], deploy: [], commons: [] }
    const q = query.trim().toLowerCase()
    for (const agent of agents) {
      const cap = agentCaption(agent.name, agent.role)
      if (q && !`${cap.name} ${cap.role} ${agent.currentTask ?? ''}`.toLowerCase().includes(q)) continue
      const working = agent.status === 'working' || needs(agent)
      if (filter === 1 && !working) continue
      if (filter === 3 && working) continue
      buckets[roomFor(agent)].push(agent)
    }
    // Two desks per room. Overflow joins the Commons.
    for (const id of ['build', 'qa', 'ship', 'deploy'] as Room[]) {
      const extra = buckets[id].splice(2)
      buckets.commons.push(...extra)
    }
    return buckets
  }, [agents, filter, query, pending, ticketRows])

  const working = agents.filter((a) => a.status === 'working').length
  const needsCount = agents.filter((a) => needs(a)).length
  const summary = agentsQ.data
    ? agents.length === 0
      ? 'The floor is empty'
      : `${agents.length} agents · ${working} working${needsCount ? ` · ${needsCount} needs you` : ''}`
    : 'Loading the floor…'

  const pipe = stageCounts(ticketRows)
  const events = activityQ.data?.events ?? []

  function taskLine(agent: Agent): string {
    if (needs(agent)) return agent.currentTask || 'Needs you'
    return agent.currentTask || (agent.status === 'working' ? 'Working' : 'Idle')
  }

  return (
    <div>
      <PageHeader
        title="Office"
        summary={summary}
        tools={
          <>
            <Segmented labels={['All working', 'Gather', 'Meeting', 'Break']} active={filter} onChange={setFilter} ariaLabel="Floor filter" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search" label="Search the floor" />
          </>
        }
      />

      {agentsQ.data && agents.length === 0 && (
        <EmptyState title="Nobody is in the office" body="Run npm run seed:demo for the sample roster, or connect the OpenClaw bridge. The floor stays empty until agents exist." />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-[18px] bg-mc-bg p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROOMS.map((room) => {
              const crew = placed[room.id]
              const busy = crew.filter((a) => a.status === 'working' || needs(a)).length
              const countLabel = busy === 0 ? 'Idle' : busy === 1 ? '1 in progress' : `${busy} in progress`
              return (
                <SoftCard key={room.id} className="relative min-h-[460px] px-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: room.color }} />
                    <span className="min-w-0 truncate text-[15px] font-semibold">{room.label}</span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] text-mc-sub">{countLabel}</span>
                  </div>
                  {crew.length === 0 && <p className="mt-8 text-center text-[12px] text-mc-sub">Empty</p>}
                  {crew.map((agent) => {
                    const cap = agentCaption(agent.name, agent.role)
                    const on = selected === agent.id
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelected(on ? null : agent.id)}
                        className="relative mt-4 block w-full text-center"
                      >
                        <div className="flex justify-center">
                          <Face agent={{ ...agent, status: needs(agent) ? 'blocked' : agent.status }} agents={agents} px={84} />
                        </div>
                        <Desk />
                        <div className="relative z-10 mt-2">
                          <div className="text-[13.5px] font-semibold">{cap.name} <span className="text-[11px] font-normal text-mc-sub">· {cap.role}</span></div>
                          <div className={`text-[12px] ${needs(agent) ? 'text-mc-redtext' : 'text-mc-sub'}`}>{taskLine(agent)}</div>
                          {on && <div className="mt-1 text-[12px] text-mc-accent-text">Open on Agents</div>}
                        </div>
                      </button>
                    )
                  })}
                  {selected && crew.some((a) => a.id === selected) && (
                    <Link to="/agents" className="mt-2 block text-center text-[12px] font-semibold text-mc-accent-text">See this agent</Link>
                  )}
                </SoftCard>
              )
            })}
          </div>

          <SoftCard className="mt-4 px-4 py-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold">Commons</span>
              <span className="text-[12px] text-mc-sub">{placed.commons.length} here</span>
            </div>
            {placed.commons.length === 0 ? (
              <p className="mt-3 text-[13px] text-mc-sub">The commons is empty.</p>
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-6">
                {placed.commons.map((agent) => {
                  const cap = agentCaption(agent.name, agent.role)
                  return (
                    <button key={agent.id} type="button" onClick={() => setSelected(agent.id)} className="w-24 text-center">
                      <div className="flex justify-center">
                        <Face agent={agent} agents={agents} px={64} />
                      </div>
                      <div className="mt-1 text-[12px] font-semibold">{cap.name}</div>
                      <div className="text-[11px] text-mc-sub">{cap.role}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </SoftCard>
        </div>

        <aside>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[15px] font-semibold">Activity</span>
            <span className="text-[12px] font-semibold text-mc-green">Live</span>
          </div>
          <div className="rounded-[14px] bg-mc-inner">
            {events.length === 0 && <p className="px-4 py-6 text-[12.5px] text-mc-sub">No activity yet. Seed or the bridge fills this list.</p>}
            {events.slice(0, 6).map((e, i) => {
              const name = e.payload?.agent || 'system'
              const hit = agents.find((a) => a.name.toLowerCase() === name.toLowerCase())
              const who = hit ?? { id: name, name, role: null, status: 'idle' }
              const text = e.payload?.name || e.payload?.summary || e.type
              const waiting = mentions(pendingBlob(pending), text, name)
              const failed = /fail/i.test(`${e.type} ${text}`)
              return (
                <div key={`${e.ts}-${i}`} className="flex gap-2 border-b border-mc-sep px-3 py-3 last:border-0">
                  <Face agent={who} agents={agents} px={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <AgentName name={who.name} role={who.role} />
                      <span className="whitespace-nowrap text-[11px] text-mc-sub">{new Date(e.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <div className={`truncate text-[12px] ${waiting ? 'text-mc-redtext' : failed ? 'text-mc-orangetext' : 'text-mc-sub2'}`}>{text}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mb-2 mt-5 flex items-center justify-between">
            <span className="text-[15px] font-semibold">Pipeline</span>
            <Link to="/pipeline" className="text-[12px] font-semibold text-mc-accent-text">Open</Link>
          </div>
          <div className="rounded-[14px] bg-mc-inner">
            {ROOMS.map((room, i) => (
              <div key={room.id} className="flex items-center justify-between border-b border-mc-sep px-4 py-3 last:border-0">
                <span className="flex items-center gap-2 text-[13px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: room.color }} />
                  {room.label}
                </span>
                <span className="text-[13px] font-semibold text-mc-sub2">{pipe[i]}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-mc-sub">Counts are tickets on the board.</p>
        </aside>
      </div>
    </div>
  )
}
