import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, SoftCard, SearchInput, Face, AgentName, StatusChip, Kicker, EmptyState, Banner } from '../components/shell'
import { agentCaption } from '../data/roster'
import { API_URL } from '../lib/apiBase'
import { formatChicagoClock, formatChicagoDayHeading } from '../lib/chicago-day'
import { groupMemoryByDay } from '../lib/memory-groups'

/**
 * Memory — notes the bridge posted (memory.snapshot) or seed:demo wrote.
 * The layout is the ticket 13 page: day list on the left, reader on the
 * right, All / Long-term / Daily notes, search. This file only fills that
 * chrome with the memory API. It does not read disk.
 */

interface MemoryEntry {
  id: string
  title: string
  snippet: string
  agent: string
  createdAt: string
  day: string
  kind: string
  source: string | null
  ref: string | null
}

interface MemoryList {
  entries: MemoryEntry[]
  total: number
}

interface MemoryDetail extends MemoryEntry {
  body: string
}

function kindLabel(kind: string): string {
  if (kind === 'long-term') return 'Long-term'
  if (kind === 'daily') return 'Daily note'
  return 'Note'
}

function kindTone(kind: string): 'blue' | 'teal' | 'gray' {
  if (kind === 'long-term') return 'blue'
  if (kind === 'daily') return 'teal'
  return 'gray'
}

function emptyFilterCopy(day: string, query: string, tab: number): string {
  if (day) return 'Nothing saved this day.'
  if (query.trim()) return 'No memories match that search.'
  if (tab === 1) return 'No long-term memories in this view.'
  if (tab === 2) return 'No daily notes in this view.'
  return 'No memories match.'
}

export default function Memory() {
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const agents = rosterQ.data?.agents ?? []
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [day, setDay] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<MemoryDetail | null>(null)

  const path = useMemo(() => {
    const params = new URLSearchParams()
    if (tab === 1) params.set('kind', 'long-term')
    if (tab === 2) params.set('kind', 'daily')
    const q = query.trim()
    if (q) params.set('q', q)
    if (day) params.set('day', day)
    const qs = params.toString()
    return qs ? `/memory?${qs}` : '/memory'
  }, [tab, query, day])

  const { data, loading, errorMessage, refetch } = useApi<MemoryList>(path, { pollMs: 20000 })
  const { events } = useLiveActivity()
  const entries = data?.entries ?? []
  const seenSnapshot = useRef(0)

  useEffect(() => {
    const latest = events.reduce((max, event) => (
      event.type === 'memory.snapshot' && event.ts > max ? event.ts : max
    ), 0)
    if (latest > seenSnapshot.current) {
      seenSnapshot.current = latest
      void refetch()
    }
  }, [events, refetch])

  useEffect(() => {
    if (entries.length === 0) {
      if (selected !== null) setSelected(null)
      return
    }
    if (!selected || !entries.some((row) => row.id === selected)) {
      setSelected(entries[0].id)
    }
  }, [entries, selected])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    const ctrl = new AbortController()
    let live = true
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/memory/${encodeURIComponent(selected)}`, { signal: ctrl.signal })
        if (!res.ok) return
        const json = (await res.json()) as { entry?: MemoryDetail }
        if (live && json.entry) setDetail(json.entry)
      } catch {
        // Abort, or the API blinked. The list snippet stays on screen.
      }
    })()
    return () => {
      live = false
      ctrl.abort()
    }
  }, [selected])

  const groups = useMemo(() => groupMemoryByDay(entries), [entries])
  const current = entries.find((row) => row.id === selected) ?? null
  const body = detail && detail.id === selected ? detail.body : current?.snippet ?? ''
  const summary = !data
    ? (loading && !errorMessage ? 'Loading memories…' : 'Memories not loaded')
    : data.total === 0
      ? 'No memories yet'
      : `${entries.length} ${entries.length === 1 ? 'memory' : 'memories'}`

  return (
    <div>
      <PageHeader
        title="Memory"
        summary={summary}
        tools={
          <>
            <Segmented labels={['All', 'Long-term', 'Daily notes']} active={tab} onChange={setTab} ariaLabel="Memory filter" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search memories" label="Search memories" />
            <input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              aria-label="Jump to a date"
              className="h-8 rounded-[9px] bg-mc-ctl px-2 text-[13px] text-mc-text"
            />
            {day && (
              <button type="button" onClick={() => setDay('')} className="h-8 px-2 text-[13px] font-semibold text-mc-accent-text">
                All days
              </button>
            )}
          </>
        }
      />
      {errorMessage && data && <Banner>{errorMessage}</Banner>}
      {!data && errorMessage && (
        <EmptyState title="Memories not loaded" body={errorMessage} />
      )}
      {data && data.total === 0 && (
        <EmptyState
          title="Nothing remembered yet"
          body="No notes are saved. Connect OpenClaw so the bridge can post them, or load the sample set. This page does not read files on disk."
        >
          <Link to="/connect" className="mt-3 inline-block text-[13px] font-semibold text-mc-accent-text">Setup</Link>
          <p className="mt-2 text-[13px] text-mc-sub">
            Or run <code className="font-mono text-mc-text">npm run seed:demo</code>
          </p>
        </EmptyState>
      )}
      {data && data.total > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <SoftCard className="max-h-[640px] overflow-y-auto p-2">
            {entries.length === 0 && (
              <p className="px-3 py-6 text-[13px] text-mc-sub">{emptyFilterCopy(day, query, tab)}</p>
            )}
            {groups.map((group) => (
              <div key={group.day}>
                <button
                  type="button"
                  onClick={() => setSelected(group.entries[0].id)}
                  className="px-3 py-2 text-left"
                >
                  <Kicker>{formatChicagoDayHeading(group.day)}</Kicker>
                </button>
                {group.entries.map((row) => {
                  const on = current?.id === row.id
                  const who = faceFor(row.agent, agents)
                  const cap = agentCaption(who.name, who.role)
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelected(row.id)}
                      className={`flex w-full gap-3 rounded-[10px] px-3 py-3 text-left ${on ? 'bg-mc-sel' : ''}`}
                    >
                      <Face agent={who} agents={agents} px={34} />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-2">
                          <span className="truncate text-[14px] font-semibold">{row.title}</span>
                          <span className="whitespace-nowrap text-[11.5px] text-mc-sub">{formatChicagoClock(row.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-mc-sub">{cap.name} · {row.snippet}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </SoftCard>
          {current ? (
            <SoftCard className="px-8 py-7">
              <MemoryReader entry={current} body={body} agents={agents} />
            </SoftCard>
          ) : (
            <SoftCard className="px-8 py-7">
              <p className="text-[13px] text-mc-sub">{emptyFilterCopy(day, query, tab)}</p>
            </SoftCard>
          )}
        </div>
      )}
    </div>
  )
}

function MemoryReader({
  entry,
  body,
  agents,
}: {
  entry: MemoryEntry
  body: string
  agents: Agent[]
}) {
  const who = faceFor(entry.agent, agents)
  const cap = agentCaption(who.name, who.role)
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Face agent={who} agents={agents} px={44} />
          <div>
            <AgentName name={who.name} role={who.role} size="md" />
            <div className="text-[12.5px] text-mc-sub">Saved {formatChicagoClock(entry.createdAt)} CT</div>
          </div>
        </div>
        <StatusChip label={kindLabel(entry.kind)} tone={kindTone(entry.kind)} />
      </div>
      <h2 className="mt-6 text-[24px] font-bold tracking-tight">{entry.title}</h2>
      <div className="mt-4 max-h-[min(520px,60vh)] overflow-y-auto whitespace-pre-wrap break-words text-[15px] leading-relaxed text-mc-text">
        {body}
      </div>
      <div className="mt-8 border-t border-mc-sep pt-4 text-[13px]">
        <span className="mr-3 text-[10.5px] font-semibold tracking-[0.06em] text-mc-sub">FROM</span>
        <span className="text-mc-sub2">{entry.ref || `${cap.name} · ${cap.role}`}</span>
      </div>
    </>
  )
}

function faceFor(name: string, roster: Agent[]): Agent {
  const key = name.toLowerCase()
  const hit = roster.find((agent) => {
    const cap = agentCaption(agent.name, agent.role)
    return agent.name.toLowerCase() === key || cap.name.toLowerCase() === key
  })
  if (hit) return hit
  return {
    id: name,
    name,
    color: '#58A6FF',
    role: null,
    status: 'idle',
    parentId: null,
    emoji: null,
    personalityTags: null,
    currentTask: null,
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: null,
    channel: null,
  }
}
