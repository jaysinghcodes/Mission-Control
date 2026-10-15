import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { PageHeader, Segmented, SoftCard, Face, AgentName, SearchInput, EmptyState } from '../components/shell'
import { RosterRobot, SampleTag } from '../components/rosterMarks'
import { AgentProfileDrawer } from '../components/AgentProfileDrawer'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'
import { activityNeedsYou, agentNeedsYou, stageCounts, stageIndexForStatus, type ApprovalLike } from '../lib/board'
import { activityText } from '../lib/activity-text'
import { pluralize } from '../lib/pluralize'
import { activityActor, deriveLiveWork, type LiveRun, type LiveTicket } from '../lib/live-work'
import { useRosterLive } from '../lib/useRosterLive'
import { useWorkLive } from '../lib/useWorkLive'
import { OFFLINE_LABEL, isRegisteredOffline, showSampleTag } from '../lib/sample-roster'
import { useRosterView } from '../lib/useSampleRoster'
import {
  activityAge,
  commonsByline,
  commonsTopic,
  DESK_ROOMS,
  floorMode,
  placeFloor,
  roomByline,
  type DeskRoom,
  type Room,
} from '../lib/office'

/**
 * Office. Build, QA, Ship, Deploy, and Commons follow live work.
 * Agents, Team, and this floor share deriveLiveWork. Click an agent for
 * the profile drawer. Click a room for that stage's tickets.
 * The segmented control filters who is on the floor (see placeFloor).
 */

interface EventApi { type: string; payload: { name?: string; summary?: string; agent?: string; ticket?: string; id?: string; run?: string; job?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }
interface Ticket extends LiveTicket { id?: string; status: string }
interface TicketsResp { tickets: Ticket[] }
interface RunsResp { runs: LiveRun[] }
interface ApprovalsResp { approvals: ApprovalLike[] }

const ROOMS: { id: DeskRoom; label: string; color: string }[] = [
  { id: 'build', label: 'Build', color: 'var(--mc-blue)' },
  { id: 'qa', label: 'QA', color: 'var(--mc-orange)' },
  { id: 'ship', label: 'Ship', color: 'var(--mc-green)' },
  { id: 'deploy', label: 'Deploy', color: 'var(--mc-teal)' },
]

const ROOM_IDS = new Set<string>([...DESK_ROOMS, 'commons'])

function Desk() {
  return (
    <div className="pointer-events-none mx-auto -mt-3 w-[120px]" aria-hidden>
      <div className="mc-desk-screen mx-auto h-8 w-14 rounded-md p-1">
        <div className="mc-desk-glass h-full w-full rounded-sm">
          <div className="ml-1 mt-1 h-0.5 w-6 rounded bg-mc-accent" />
          <div className="ml-1 mt-1 h-0.5 w-8 rounded bg-[#636366]" />
        </div>
      </div>
      <div className="mc-desk-stand mx-auto h-2.5 w-[88px] rounded-full" />
    </div>
  )
}

function Plant() {
  return (
    <span aria-hidden className="flex w-8 shrink-0 flex-col items-center">
      <span className="block h-9 w-7 rounded-full bg-mc-green/85" />
      <span className="-mt-1 block h-5 w-6 rounded-md bg-mc-fill" />
    </span>
  )
}

function shownLine(subtitle: string, blocked: boolean, offline: boolean): string {
  if (offline) return OFFLINE_LABEL
  if (blocked && (subtitle === 'Idle' || subtitle === 'Working')) return 'Needs approval'
  return subtitle
}

export default function Office() {
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 20000 })
  const activityQ = useApi<ActivityResp>('/activity?limit=12', { pollMs: 15000 })
  const ticketsQ = useApi<TicketsResp>('/tickets', { pollMs: 20000 })
  const runsQ = useApi<RunsResp>('/runs', { pollMs: 20000 })
  const approvalsQ = useApi<ApprovalsResp>('/approvals', { pollMs: 15000 })
  const { events: liveEvents } = useLiveActivity()
  const refetchApprovals = approvalsQ.refetch
  const agents = agentsQ.data?.agents ?? []
  const { visible: roster, now } = useRosterView(agents)
  const pending = approvalsQ.data?.approvals ?? []
  const ticketRows = ticketsQ.data?.tickets ?? []
  const runRows = runsQ.data?.runs ?? []
  const [params, setParams] = useSearchParams()
  const roomParam = params.get('room')
  const focus: Room | null = roomParam && ROOM_IDS.has(roomParam) ? (roomParam as Room) : null

  useRosterLive(liveEvents, agentsQ.refetch)
  useWorkLive(liveEvents, ticketsQ.refetch, runsQ.refetch, activityQ.refetch)
  useEffect(() => {
    if (liveEvents.some((e) => e.type.startsWith('approval'))) void refetchApprovals()
  }, [liveEvents, refetchApprovals])

  function needs(agent: Agent): boolean {
    return agentNeedsYou(agent, pending, ticketRows)
  }
  const [filter, setFilter] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Agent | null>(null)
  const mode = floorMode(filter)

  const floor = useMemo(() => {
    const blocked = new Set<string>()
    const live = new Map(roster.map((agent) => [agent.id, deriveLiveWork(agent, ticketRows, runRows)]))
    for (const agent of roster) {
      if (!isRegisteredOffline(agent, now) && agentNeedsYou(agent, pending, ticketRows)) blocked.add(agent.id)
    }
    const q = query.trim().toLowerCase()
    const visible = q
      ? roster.filter((agent) => {
          const cap = agentCaption(agent.name, agent.role)
          const subtitle = live.get(agent.id)?.subtitle ?? ''
          return `${cap.name} ${cap.role} ${subtitle}`.toLowerCase().includes(q)
        })
      : roster
    const seated = visible.map((agent) => {
      const work = live.get(agent.id)
      return {
        ...agent,
        room: work?.room ?? 'commons' as const,
        status: work?.working ? 'working' : 'idle',
        currentTask: work && work.subtitle !== 'Idle' ? work.subtitle : '',
      }
    })
    return { blocked, live, placed: placeFloor(seated, mode, blocked) }
  }, [roster, mode, query, pending, ticketRows, runRows, now])
  const placed = floor.placed
  const blockedIds = floor.blocked

  const working = roster.filter((a) => {
    const work = floor.live.get(a.id)
    return !!work?.working && !needs(a) && !isRegisteredOffline(a, now)
  }).length
  const needsCount = roster.filter((a) => needs(a) && !isRegisteredOffline(a, now)).length
  const summary = agentsQ.data
    ? roster.length === 0
      ? 'The floor is empty'
      : `${pluralize(roster.length, 'agent')} · ${pluralize(working, 'working', 'working')}${needsCount === 0 ? '' : ` · ${pluralize(needsCount, 'needs you', 'need you')}`}`
    : 'Loading the floor…'

  const pipe = stageCounts(ticketRows)
  const events = activityQ.data?.events ?? []
  const topic = commonsTopic(placed.commons, mode)
  const commonsLabel = commonsByline(placed.commons, mode)

  function toggleRoom(id: Room) {
    const next = new URLSearchParams(params)
    if (focus === id) next.delete('room')
    else next.set('room', id)
    setParams(next, { replace: true })
  }

  function clearRoom() {
    const next = new URLSearchParams(params)
    next.delete('room')
    setParams(next, { replace: true })
  }

  const focusMeta = ROOMS.find((room) => room.id === focus) ?? null
  const focusTickets = focusMeta
    ? ticketRows.filter((ticket) => stageIndexForStatus(ticket.status) === ROOMS.findIndex((room) => room.id === focusMeta.id))
    : []

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

      {agentsQ.data && roster.length === 0 && (
        <EmptyState title="Nobody is in the office" body="Run npm run seed:demo for the sample roster, or connect the OpenClaw bridge. The floor stays empty until agents exist." />
      )}

      {/*
        At a 1280 viewport the window is ~960px wide. A 200px activity rail
        leaves each room ~170px, enough for "Build" + "2 in progress" on one
        line. Wider viewports give the rail more room. Headers never truncate.
      */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_200px] min-[1440px]:grid-cols-[minmax(0,1fr)_268px]">
        <div className="min-w-0 rounded-[18px] bg-mc-bg p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROOMS.map((room) => {
              const crew = placed[room.id]
              const selected = focus === room.id
              return (
                <SoftCard key={room.id} className={`min-w-0 px-2.5 py-3 ${selected ? 'outline outline-2 outline-offset-2 outline-[var(--mc-accent)]' : ''}`}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleRoom(room.id)}
                    className="flex w-full items-center gap-1.5 text-left"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: room.color }} />
                    <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{room.label}</span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] font-medium text-mc-sub">{roomByline(room.id, crew, blockedIds)}</span>
                  </button>
                  {crew.length === 0 && <p className="mt-8 text-center text-[12px] text-mc-sub">Empty</p>}
                  {crew.map((agent) => {
                    const cap = agentCaption(agent.name, agent.role)
                    const offline = isRegisteredOffline(agent, now)
                    const work = floor.live.get(agent.id)
                    const line = shownLine(work?.subtitle ?? 'Idle', blockedIds.has(agent.id), offline)
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        data-agent-id={agent.id}
                        data-offline={offline ? 'true' : 'false'}
                        data-live-room={work?.room ?? 'commons'}
                        data-live-subtitle={line}
                        data-live-source={work?.source ?? 'heartbeat'}
                        onClick={() => setOpen(agent)}
                        aria-label={`${cap.name}, ${cap.role}, ${line}`}
                        className="relative mt-4 block w-full text-center"
                      >
                        <div className="flex justify-center">
                          <RosterRobot
                            agent={agent}
                            agents={agents}
                            px={84}
                            now={now}
                            status={blockedIds.has(agent.id) ? 'blocked' : agent.status}
                          />
                        </div>
                        <Desk />
                        <div className="relative z-10 mt-2">
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            <div className="text-[13px] font-semibold leading-tight">
                              {cap.name} <span className="whitespace-nowrap text-[11px] font-normal text-mc-sub">· {cap.role}</span>
                            </div>
                            {showSampleTag(agent) && <SampleTag />}
                          </div>
                          <div className={`text-[12px] leading-snug ${!offline && blockedIds.has(agent.id) ? 'text-mc-redtext' : 'text-mc-sub'}`}>{line}</div>
                        </div>
                      </button>
                    )
                  })}
                </SoftCard>
              )
            })}
          </div>

          {focusMeta && (
            <SoftCard className="mt-4 px-4 py-3">
              <div id="office-room-detail">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: focusMeta.color }} />
                <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{focusMeta.label}</span>
                <span className="min-w-0 text-[12px] text-mc-sub">
                  {`${pluralize(focusTickets.length, 'ticket')} on the board`}
                </span>
                <button type="button" onClick={clearRoom} className="ml-auto shrink-0 whitespace-nowrap text-[12px] font-semibold text-mc-accent-text">
                  All rooms
                </button>
              </div>
              {focusTickets.length === 0 ? (
                <p className="mt-2 text-[13px] text-mc-sub">Nothing in {focusMeta.label} right now.</p>
              ) : (
                <ul className="mt-2 divide-y divide-mc-sep">
                  {focusTickets.map((ticket) => (
                    <li key={ticket.id ?? ticket.key ?? ticket.title} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                      <span className="min-w-0 truncate font-medium">{ticket.title || 'Untitled'}</span>
                      <span className="shrink-0 whitespace-nowrap text-[12px] text-mc-sub">
                        {ticket.key ?? ''}{ticket.assignee ? ` · ${ticket.assignee}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              </div>
            </SoftCard>
          )}

          {focus === 'commons' && (
            <SoftCard className="mt-4 px-4 py-3">
              <div id="office-room-detail">
              <div className="flex items-center gap-3">
                <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">Commons</span>
                <span className="min-w-0 text-[12px] text-mc-sub">Bots with no active ticket or run sit here.</span>
                <button type="button" onClick={clearRoom} className="ml-auto shrink-0 whitespace-nowrap text-[12px] font-semibold text-mc-accent-text">
                  All rooms
                </button>
              </div>
              </div>
            </SoftCard>
          )}

          <SoftCard className={`mt-4 px-4 py-4 ${focus === 'commons' ? 'outline outline-2 outline-offset-2 outline-[var(--mc-accent)]' : ''}`}>
            <button
              type="button"
              aria-pressed={focus === 'commons'}
              onClick={() => toggleRoom('commons')}
              className="flex w-full items-center gap-3 text-left"
            >
              <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">Commons</span>
              <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] font-medium text-mc-sub">{commonsLabel}</span>
            </button>
            {placed.commons.length === 0 ? (
              <p className="mt-3 text-[13px] text-mc-sub">The commons is empty.</p>
            ) : (
              <div className="mt-4 flex items-end justify-center gap-3 sm:gap-6">
                <Plant />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-end justify-center gap-x-6 gap-y-4">
                    {placed.commons.map((agent) => {
                      const cap = agentCaption(agent.name, agent.role)
                      const offline = isRegisteredOffline(agent, now)
                      const work = floor.live.get(agent.id)
                      const line = shownLine(work?.subtitle ?? 'Idle', blockedIds.has(agent.id), offline)
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          data-agent-id={agent.id}
                          data-offline={offline ? 'true' : 'false'}
                          data-live-room={work?.room ?? 'commons'}
                          data-live-subtitle={line}
                          data-live-source={work?.source ?? 'heartbeat'}
                          onClick={() => setOpen(agent)}
                          aria-label={`${cap.name}, ${cap.role}, ${line}`}
                          className="w-[96px] text-center"
                        >
                          <div className="flex justify-center">
                            <RosterRobot
                              agent={agent}
                              agents={agents}
                              px={72}
                              now={now}
                              status={blockedIds.has(agent.id) ? 'blocked' : agent.status}
                            />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[12px] font-semibold leading-tight">
                            {cap.name}
                            {showSampleTag(agent) && <SampleTag />}
                          </div>
                          <div className="text-[11px] leading-tight text-mc-sub">{cap.role}</div>
                          {!offline && line !== 'Idle' && <div className="text-[11px] leading-tight text-mc-sub">{line}</div>}
                          {offline && <div className="text-[11px] leading-tight text-mc-sub">{OFFLINE_LABEL}</div>}
                        </button>
                      )
                    })}
                  </div>
                  {topic && (
                    <div className="mx-auto mt-4 flex h-11 max-w-[460px] items-center justify-center rounded-full bg-mc-fill px-4 text-center text-[12px] text-mc-sub">
                      {topic}
                    </div>
                  )}
                </div>
                <Plant />
              </div>
            )}
          </SoftCard>
        </div>

        <aside className="min-w-0" data-activity-rail="true">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">Activity</span>
            <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-mc-green">Live</span>
          </div>
          <div className="rounded-[14px] bg-mc-inner">
            {events.length === 0 && <p className="px-4 py-6 text-[12.5px] text-mc-sub">No activity yet. Seed or the bridge fills this list.</p>}
            {events.slice(0, 6).map((e, i) => {
              const actor = activityActor(e.payload, agents, ticketRows, runRows)
              const hit = actor ? agents.find((a) => a.id === actor.id) : undefined
              const who = hit ?? (actor ? { id: actor.id, name: actor.name, role: actor.role, status: 'idle' } : null)
              const text = activityText(e.payload, e.type)
              const waiting = activityNeedsYou(e.payload, pending)
              const failed = /fail/i.test(`${e.type} ${text}`)
              const age = activityAge(e.ts, Date.now())
              const row = (
                <>
                  {who ? <Face agent={who} agents={agents} px={36} /> : <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-mc-fill" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      {who ? <AgentName name={who.name} role={who.role} /> : <span className="text-[12px] font-semibold">Update</span>}
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-mc-sub">{age}</span>
                    </div>
                    <div className={`truncate text-[12px] ${waiting ? 'text-mc-redtext' : failed ? 'text-mc-orangetext' : 'text-mc-sub2'}`}>{text}</div>
                  </div>
                </>
              )
              const cls = 'flex w-full gap-2 border-b border-mc-sep px-3 py-3 text-left last:border-0'
              if (!hit) {
                return <div key={`${e.ts}-${i}`} data-activity-agent={who?.name ?? ''} className={cls}>{row}</div>
              }
              return (
                <button key={`${e.ts}-${i}`} type="button" data-activity-agent={who?.name ?? ''} onClick={() => setOpen(hit)} className={cls} aria-label={`${who?.name ?? 'Update'}, ${text}`}>
                  {row}
                </button>
              )
            })}
          </div>
          <div className="mb-2 mt-5 flex items-center justify-between gap-2">
            <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">Pipeline</span>
            <Link to="/pipeline" className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-mc-accent-text">Open</Link>
          </div>
          <div className="rounded-[14px] bg-mc-inner">
            {ROOMS.map((room, i) => (
              <button
                key={room.id}
                type="button"
                data-pipeline-stage={room.id}
                data-pipeline-count={pipe[i]}
                aria-pressed={focus === room.id}
                onClick={() => toggleRoom(room.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-mc-sep px-4 py-3 text-left last:border-0 ${focus === room.id ? 'bg-mc-sel' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: room.color }} />
                  {room.label}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-mc-sub2">{pipe[i]}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {open && (
        <AgentProfileDrawer agent={open} agents={agents} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}
