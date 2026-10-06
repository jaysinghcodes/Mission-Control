import { useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, SoftCard, SearchInput, Face, AgentName, StatusChip, Kicker, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'

/**
 * Memory — what agents remember. Rows come from each agent's recentActivity
 * and current task (bridge or seed). There is no separate memory table.
 */

interface Row {
  id: string
  agent: Agent
  title: string
  body: string
  when: string
  kind: 'long' | 'daily'
}

export default function Memory() {
  const { data, loading, errorMessage } = useApi<AgentsResp>('/agents', { pollMs: 20000 })
  const agents = data?.agents ?? []
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const agent of agents) {
      const text = agent.recentActivity?.trim()
      const task = agent.currentTask?.trim()
      if (text) {
        out.push({
          id: `${agent.id}-recent`,
          agent,
          title: task || text.split(/[.\n]/)[0]?.slice(0, 80) || 'Note',
          body: text,
          when: 'Recent',
          kind: 'long',
        })
      } else if (task) {
        out.push({
          id: `${agent.id}-task`,
          agent,
          title: task,
          body: task,
          when: 'Now',
          kind: 'daily',
        })
      }
    }
    return out
  }, [agents])

  const filtered = rows.filter((r) => {
    if (tab === 1 && r.kind !== 'long') return false
    if (tab === 2 && r.kind !== 'daily') return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const cap = agentCaption(r.agent.name, r.agent.role)
    return `${r.title} ${r.body} ${cap.name} ${cap.role}`.toLowerCase().includes(q)
  })
  const current = filtered.find((r) => r.id === selected) ?? filtered[0] ?? null
  const summary = !data
    ? (loading && !errorMessage ? 'Loading memories…' : 'Memories not loaded')
    : rows.length === 0
      ? 'No memories yet'
      : `${rows.length} memories · from the roster`

  return (
    <div>
      <PageHeader
        title="Memory"
        summary={summary}
        tools={
          <>
            <Segmented labels={['All', 'Long-term', 'Daily notes']} active={tab} onChange={setTab} ariaLabel="Memory filter" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search memories" label="Search memories" />
          </>
        }
      />
      {data && rows.length === 0 && (
        <EmptyState
          title="Nothing remembered yet"
          body="Agents write a recent note when the bridge syncs them. npm run seed:demo fills sample notes so this page is not blank."
        />
      )}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <SoftCard className="max-h-[640px] overflow-y-auto p-2">
            <div className="px-3 py-2"><Kicker>Recent</Kicker></div>
            {filtered.map((row) => {
              const on = current?.id === row.id
              const cap = agentCaption(row.agent.name, row.agent.role)
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row.id)}
                  className={`flex w-full gap-3 rounded-[10px] px-3 py-3 text-left ${on ? 'bg-mc-sel' : ''}`}
                >
                  <Face agent={row.agent} agents={agents} px={34} />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold">{row.title}</span>
                      <span className="whitespace-nowrap text-[11.5px] text-mc-sub">{row.when}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-mc-sub">{cap.name} · {row.body}</span>
                  </span>
                </button>
              )
            })}
          </SoftCard>
          {current && (
            <SoftCard className="px-8 py-7">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Face agent={current.agent} agents={agents} px={44} />
                  <div>
                    <AgentName name={current.agent.name} role={current.agent.role} size="md" />
                    <div className="text-[12.5px] text-mc-sub">Saved with the agent roster</div>
                  </div>
                </div>
                <StatusChip label={current.kind === 'long' ? 'Long-term' : 'Daily note'} tone="blue" />
              </div>
              <h2 className="mt-6 text-[24px] font-bold tracking-tight">{current.title}</h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed">{current.body}</p>
              <div className="mt-8 border-t border-mc-sep pt-4 text-[13px]">
                <span className="mr-3 text-[10.5px] font-semibold tracking-[0.06em] text-mc-sub">FROM</span>
                <span className="text-mc-sub2">{agentCaption(current.agent.name, current.agent.role).name} · {current.agent.currentTask || 'roster'}</span>
              </div>
            </SoftCard>
          )}
        </div>
      )}
    </div>
  )
}
