import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, StatusChip, Face, Kicker, EmptyState, SearchInput } from '../components/shell'
import { AgentProfileDrawer } from '../components/AgentProfileDrawer'
import { agentCaption } from '../data/roster'
import { agentNeedsYou, type ApprovalLike } from '../lib/board'

/**
 * Agents — who is doing what right now. The old Team roster, as cards.
 * Profile drawer is the click-through. Robots stay the shipped roster.
 * Needs-you is a pending approval, the same list as the nav badge.
 */

function tone(
  agent: Agent,
  pending: ApprovalLike[],
  tickets: { key?: string | null; title?: string | null; assignee?: string | null }[],
): 'red' | 'green' | 'gray' {
  if (agentNeedsYou(agent, pending, tickets)) return 'red'
  if (agent.status === 'working') return 'green'
  return 'gray'
}

export default function Agents() {
  const { data, loading, errorMessage } = useApi<AgentsResp>('/agents', { pollMs: 15000 })
  const approvalsQ = useApi<{ approvals: ApprovalLike[] }>('/approvals', { pollMs: 15000 })
  const ticketsQ = useApi<{ tickets: { key: string | null; title: string; assignee: string | null }[] }>('/tickets', { pollMs: 15000 })
  const { events } = useLiveActivity()
  const refetchApprovals = approvalsQ.refetch
  const agents = data?.agents ?? []
  const pending = approvalsQ.data?.approvals ?? []
  const tickets = ticketsQ.data?.tickets ?? []

  useEffect(() => {
    if (events.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [events, refetchApprovals])
  const [filter, setFilter] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Agent | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const sorted = useMemo(() => {
    const rank = (a: Agent) => (tone(a, pending, tickets) === 'red' ? 0 : tone(a, pending, tickets) === 'green' ? 1 : 2)
    return [...agents].sort((a, b) => rank(a) - rank(b) || agentCaption(a.name, a.role).name.localeCompare(agentCaption(b.name, b.role).name))
  }, [agents, pending, tickets])

  const visible = sorted.filter((a) => {
    const t = tone(a, pending, tickets)
    if (filter === 1 && t !== 'green' && t !== 'red') return false
    if (filter === 2 && t !== 'gray') return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const cap = agentCaption(a.name, a.role)
    return `${cap.name} ${cap.role} ${a.currentTask ?? ''} ${a.recentActivity ?? ''}`.toLowerCase().includes(q)
  })

  const working = agents.filter((a) => tone(a, pending, tickets) === 'green').length
  const needs = agents.filter((a) => tone(a, pending, tickets) === 'red').length
  const summary = !data
    ? (loading && !errorMessage ? 'Loading agents…' : 'Agents not loaded')
    : agents.length === 0
      ? 'No agents yet'
      : `${agents.length} agents · ${working} working${needs ? ` · ${needs} needs you` : ''}`

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
      {data && agents.length === 0 && (
        <EmptyState
          title="No agents yet"
          body="Connect the OpenClaw bridge, or run npm run seed:demo. This page stays empty on purpose until someone is on the roster."
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((agent) => {
          const cap = agentCaption(agent.name, agent.role)
          const t = tone(agent, pending, tickets)
          const now = agent.currentTask || agent.recentActivity || (t === 'gray' ? 'Idle' : 'Working')
          return (
            <button
              key={agent.id}
              type="button"
              ref={open?.id === agent.id ? trigger : undefined}
              onClick={(e) => { trigger.current = e.currentTarget; setOpen(agent) }}
              className="mc-card px-4 py-4 text-left"
            >
              <div className="flex items-start gap-3">
                <Face agent={{ ...agent, status: t === 'red' ? 'blocked' : agent.status }} agents={agents} px={72} />
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold">{cap.name}</div>
                  <div className="text-[12.5px] text-mc-sub">{cap.role}</div>
                  <div className="mt-2">
                    <StatusChip label={t === 'red' ? 'Needs you' : t === 'green' ? 'Working' : 'Idle'} tone={t === 'red' ? 'red' : t === 'green' ? 'green' : 'gray'} />
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-mc-sep pt-3">
                <Kicker>{t === 'gray' ? 'Status' : 'Now'}</Kicker>
                <p className={`mt-1 line-clamp-2 text-[13.5px] ${t === 'red' ? 'text-mc-redtext' : t === 'gray' ? 'text-mc-sub2' : 'text-mc-text'}`}>{now}</p>
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
