import { useEffect, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, StatusChip, Kicker, EmptyState, SearchInput } from '../components/shell'
import { AgentProfileDrawer } from '../components/AgentProfileDrawer'
import { RosterRobot, SampleTag } from '../components/rosterMarks'
import { agentCaption } from '../data/roster'
import { agentNeedsYou, type ApprovalLike } from '../lib/board'
import { pluralize } from '../lib/pluralize'
import { deriveLiveWork, type LiveRun, type LiveTicket } from '../lib/live-work'
import { useRosterLive } from '../lib/useRosterLive'
import { useWorkLive } from '../lib/useWorkLive'
import { OFFLINE_LABEL, isRegisteredOffline, showSampleTag } from '../lib/sample-roster'
import { useRosterView } from '../lib/useSampleRoster'

/**
 * Agents — who is doing what right now. The old Team roster, as cards.
 * Profile drawer is the click-through. Robots stay the shipped roster.
 * Needs-you is a pending approval, the same list as the nav badge.
 */

function tone(
  agent: Agent,
  pending: ApprovalLike[],
  tickets: { key?: string | null; title?: string | null; assignee?: string | null }[],
  working: boolean,
): 'red' | 'green' | 'gray' {
  if (agentNeedsYou(agent, pending, tickets)) return 'red'
  if (working) return 'green'
  return 'gray'
}

export default function Agents() {
  const { data, loading, errorMessage, refetch } = useApi<AgentsResp>('/agents', { pollMs: 15000 })
  const approvalsQ = useApi<{ approvals: ApprovalLike[] }>('/approvals', { pollMs: 15000 })
  const ticketsQ = useApi<{ tickets: LiveTicket[] }>('/tickets', { pollMs: 15000 })
  const runsQ = useApi<{ runs: LiveRun[] }>('/runs', { pollMs: 15000 })
  const { events, connected } = useLiveActivity()
  const refetchApprovals = approvalsQ.refetch
  const agents = data?.agents ?? []
  const { visible: roster, now } = useRosterView(agents)
  const pending = approvalsQ.data?.approvals ?? []
  const tickets = ticketsQ.data?.tickets ?? []
  const runs = runsQ.data?.runs ?? []
  const liveFor = (agent: Agent) => deriveLiveWork(agent, tickets, runs)
  const shownTone = (agent: Agent) => (isRegisteredOffline(agent, now) ? 'gray' : tone(agent, pending, tickets, liveFor(agent).working))

  useRosterLive(events, refetch, connected)
  useWorkLive(events, ticketsQ.refetch, runsQ.refetch)
  useEffect(() => {
    if (events.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [events, refetchApprovals])
  const [filter, setFilter] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Agent | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const rank = (a: Agent) => (shownTone(a) === 'red' ? 0 : shownTone(a) === 'green' ? 1 : 2)
  const sorted = [...roster].sort((a, b) => rank(a) - rank(b) || agentCaption(a.name, a.role).name.localeCompare(agentCaption(b.name, b.role).name))

  const visible = sorted.filter((a) => {
    const t = shownTone(a)
    if (filter === 1 && t !== 'green' && t !== 'red') return false
    if (filter === 2 && t !== 'gray') return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const cap = agentCaption(a.name, a.role)
    return `${cap.name} ${cap.role} ${liveFor(a).subtitle} ${a.recentActivity ?? ''}`.toLowerCase().includes(q)
  })

  const working = roster.filter((a) => liveFor(a).working && !isRegisteredOffline(a, now)).length
  const needs = roster.filter((a) => shownTone(a) === 'red').length
  const summary = !data
    ? (loading && !errorMessage ? 'Loading agents…' : 'Agents not loaded')
    : roster.length === 0
      ? 'No agents yet'
      : `${pluralize(roster.length, 'agent')} · ${pluralize(working, 'working', 'working')}${needs ? ` · ${pluralize(needs, 'needs you', 'need you')}` : ''}`

  return (
    <div>
      <PageHeader
        title="Agents"
        summary={summary}
        tools={
          <>
            <Segmented labels={['All', 'Working', 'Idle']} active={filter} onChange={setFilter} ariaLabel="Agent filter" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search" label="Search agents" />
          </>
        }
      />
      {errorMessage && (
        <p className="mb-4 text-[13px] text-mc-orangetext">Couldn't load agents ({errorMessage}).</p>
      )}
      {data && roster.length === 0 && (
        <EmptyState
          title="No agents yet"
          body="Connect the OpenClaw bridge, or run npm run seed:demo. This page stays empty on purpose until someone is on the roster."
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((agent) => {
          const cap = agentCaption(agent.name, agent.role)
          const offline = isRegisteredOffline(agent, now)
          const live = liveFor(agent)
          const t = shownTone(agent)
          const line = live.subtitle
          const chip = offline ? OFFLINE_LABEL : t === 'red' ? 'Needs you' : t === 'green' ? 'Working' : 'Idle'
          return (
            <button
              key={agent.id}
              type="button"
              data-agent-id={agent.id}
              data-offline={offline ? 'true' : 'false'}
              data-live-room={live.room}
              data-live-subtitle={line}
              data-live-source={live.source}
              ref={open?.id === agent.id ? trigger : undefined}
              onClick={(e) => {
                trigger.current = e.currentTarget
                setOpen({
                  ...agent,
                  status: live.working ? 'working' : 'idle',
                  currentTask: live.subtitle === 'Idle' ? agent.currentTask : live.subtitle,
                })
              }}
              className="mc-card px-4 py-4 text-left"
            >
              <div className="flex items-start gap-3">
                <RosterRobot
                  agent={agent}
                  agents={agents}
                  px={72}
                  now={now}
                  status={t === 'red' ? 'blocked' : live.working ? 'working' : 'idle'}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="text-[16px] font-semibold">{cap.name}</div>
                    {showSampleTag(agent) && <SampleTag />}
                  </div>
                  <div className="text-[12.5px] text-mc-sub">{cap.role}</div>
                  <div className="mt-2">
                    <StatusChip label={chip} tone={t === 'red' ? 'red' : t === 'green' ? 'green' : 'gray'} />
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-mc-sep pt-3">
                <Kicker>{t === 'gray' ? 'Status' : 'Now'}</Kicker>
                <p className={`mt-1 line-clamp-2 text-[13.5px] ${t === 'red' ? 'text-mc-redtext' : t === 'gray' ? 'text-mc-sub2' : 'text-mc-text'}`}>{offline ? OFFLINE_LABEL : line}</p>
              </div>
            </button>
          )
        })}
      </div>
      {open && (
        <AgentProfileDrawer agent={open} agents={agents} onClose={() => { setOpen(null); trigger.current?.focus() }} />
      )}
    </div>
  )
}
