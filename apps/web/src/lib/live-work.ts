/**
 * One live placement for Agents, Team, and Office.
 *
 * Precedence, first match wins:
 * 1. Active ticket. The assignee equals the agent id. A display name does
 *    not seat a bot. The ticket is in build, qa, or review (inprogress
 *    counts as build). The room is that stage. The subtitle is the ticket
 *    title. Several tickets: newest createdAt, then the later stage. A
 *    ticket in done does not seat its bot. The bot returns to Commons.
 *    Pipeline still counts that ticket in Deploy.
 * 2. Active run, when no active ticket applies. status is running or
 *    needs_approval, agent equals this bot's id, and ticketId points at a
 *    ticket in build, qa, review, or done. The room is that ticket's
 *    stage. Deploy seats a bot only when this run points at a ticket in
 *    done. A run on a review ticket seats Ship. The subtitle is the
 *    ticket title, or the run name. A queued, done, or failed run is not
 *    active. A run with no ticket in a stage does not take a desk.
 * 3. Heartbeat. Room is Commons. The subtitle is currentTask when it is
 *    non blank, otherwise Working or Idle from status.
 *
 * Role text is not a seat. A stored status does not pick a room. To Do and
 * Backlog are not stages, so those tickets send the bot back to Commons
 * when no active run applies.
 *
 * Stage indexes match stageIndexForStatus in board.ts. The web test locks
 * the two maps together.
 */

type LiveRoom = 'build' | 'qa' | 'ship' | 'deploy' | 'commons'
type LiveSource = 'ticket' | 'run' | 'heartbeat'

export interface LiveTicket {
  id?: string | null
  key?: string | null
  title?: string | null
  status?: string | null
  assignee?: string | null
  createdAt?: string | null
}

export interface LiveRun {
  id?: string | null
  name?: string | null
  agent?: string | null
  status?: string | null
  ticketId?: string | null
  createdAt?: string | null
}

interface LivePerson {
  id: string
  name: string
  status?: string | null
  currentTask?: string | null
}

interface LiveWork {
  room: LiveRoom
  subtitle: string
  working: boolean
  source: LiveSource
}

const STAGE_ROOM: Record<number, Exclude<LiveRoom, 'commons'>> = {
  0: 'build',
  1: 'qa',
  2: 'ship',
  3: 'deploy',
}

/** Same status map as board.ts stageIndexForStatus. */
export function liveStageIndex(status: string | null | undefined): number | null {
  const s = (status ?? '').toLowerCase()
  if (s === 'build' || s === 'inprogress') return 0
  if (s === 'qa') return 1
  if (s === 'review') return 2
  if (s === 'done') return 3
  return null
}

function stageRoom(status: string | null | undefined): Exclude<LiveRoom, 'commons'> | null {
  const index = liveStageIndex(status)
  if (index === null) return null
  return STAGE_ROOM[index] ?? null
}

/** Done is idle. Pipeline still counts it as Deploy. It does not seat a bot. */
function ticketSeats(status: string | null | undefined): boolean {
  const index = liveStageIndex(status)
  return index !== null && index < 3
}

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : 0
}

/**
 * Ticket assignees and run agents match the agent id.
 * A display name never seats a bot.
 */
export function samePerson(
  agent: { id: string; name?: string },
  label: string | null | undefined,
): boolean {
  const raw = (label ?? '').trim()
  if (!raw) return false
  return raw === agent.id.trim()
}

function ticketSubtitle(ticket: LiveTicket): string {
  const title = ticket.title?.trim()
  if (title) return title
  const key = ticket.key?.trim()
  if (key) return key
  return 'Working'
}

export function deriveLiveWork(
  agent: LivePerson,
  tickets: readonly LiveTicket[],
  runs: readonly LiveRun[],
): LiveWork {
  const assigned = tickets.filter(
    (ticket) => samePerson(agent, ticket.assignee) && ticketSeats(ticket.status),
  )
  assigned.sort((a, b) => {
    const byTime = timeMs(b.createdAt) - timeMs(a.createdAt)
    if (byTime !== 0) return byTime
    const byStage = (liveStageIndex(b.status) ?? -1) - (liveStageIndex(a.status) ?? -1)
    if (byStage !== 0) return byStage
    return (a.key ?? a.id ?? '').localeCompare(b.key ?? b.id ?? '')
  })
  const ticket = assigned[0]
  if (ticket) {
    return {
      room: stageRoom(ticket.status) ?? 'commons',
      subtitle: ticketSubtitle(ticket),
      working: true,
      source: 'ticket',
    }
  }

  const active = runs.filter((run) => {
    if (run.status !== 'running' && run.status !== 'needs_approval') return false
    if (!samePerson(agent, run.agent)) return false
    const linked = tickets.find((row) => row.id && run.ticketId && row.id === run.ticketId)
    return !!linked && !!stageRoom(linked.status)
  })
  active.sort(
    (a, b) => timeMs(b.createdAt) - timeMs(a.createdAt) || (a.id ?? '').localeCompare(b.id ?? ''),
  )
  const run = active[0]
  if (run) {
    const linked = tickets.find((row) => row.id && run.ticketId && row.id === run.ticketId)
    const title = linked?.title?.trim()
    const name = run.name?.trim()
    return {
      room: (linked && stageRoom(linked.status)) || 'commons',
      subtitle: title || name || 'Working',
      working: true,
      source: 'run',
    }
  }

  const task = agent.currentTask?.trim() ?? ''
  const working = agent.status === 'working'
  return {
    room: 'commons',
    subtitle: task || (working ? 'Working' : 'Idle'),
    working,
    source: 'heartbeat',
  }
}

const NOT_AN_AGENT = new Set(['system', 'openclaw'])

export interface ActivityPayload {
  agent?: string | null
  ticket?: string | null
  name?: string | null
  id?: string | null
}

export interface ActivityActor {
  id: string
  name: string
  role: string | null
}

function isSkippedLabel(value: string): boolean {
  return !value || NOT_AN_AGENT.has(value.toLowerCase())
}

/** Roster hit by agent id. A display name does not match. */
function actorById(
  roster: readonly { id: string; name: string; role?: string | null }[],
  id: string,
): ActivityActor | null {
  const key = id.trim()
  if (!key) return null
  const hit = roster.find((agent) => agent.id.trim() === key)
  if (!hit) return null
  return { id: hit.id, name: hit.name, role: hit.role ?? null }
}

/**
 * Who an activity row is about. Match the agent id only: payload.agent,
 * then payload.id when that id is on the roster (register and status),
 * then the ticket assignee, then the run's agent. A display name does
 * not select a crew bot. The word system is never a name. An unresolved
 * label stays on the actor so the sticker is generic.
 */
export function activityActor(
  payload: ActivityPayload | null | undefined,
  roster: readonly { id: string; name: string; role?: string | null }[],
  tickets: readonly LiveTicket[],
  runs: readonly LiveRun[] = [],
): ActivityActor | null {
  const agentField = (payload?.agent ?? '').trim()
  const idField = (payload?.id ?? '').trim()
  const ticketRef = (payload?.ticket ?? '').trim()
  const ticket = ticketRef
    ? tickets.find((row) => row.key === ticketRef || row.id === ticketRef)
    : undefined
  const assignee = ticket?.assignee?.trim() ?? ''
  const run = idField ? runs.find((row) => row.id === idField) : undefined
  const runAgent = run?.agent?.trim() ?? ''

  if (!isSkippedLabel(agentField)) {
    const hit = actorById(roster, agentField)
    if (hit) return hit
  }
  const fromId = actorById(roster, idField)
  if (fromId) return fromId
  if (!isSkippedLabel(assignee)) {
    const hit = actorById(roster, assignee)
    if (hit) return hit
  }
  if (!isSkippedLabel(runAgent)) {
    const hit = actorById(roster, runAgent)
    if (hit) return hit
  }

  const label = [agentField, assignee, runAgent].find((value) => !isSkippedLabel(value)) ?? ''
  if (!label) return null
  return { id: label, name: label, role: null }
}

/**
 * Newest socket event that should refetch tickets, runs, and activity.
 * run.* and agent.status move work. A register or delete snapshot moves
 * the Office rail. A heartbeat snapshot does not, so a task clear does
 * not wait on the activity poll.
 */
export function latestWorkEventTs(
  events: readonly { type: string; ts: number; action?: unknown }[],
): number {
  let latest = 0
  for (const event of events) {
    const action = typeof event.action === 'string' ? event.action : ''
    const rosterWrite =
      event.type === 'agents.snapshot' && (action === 'register' || action === 'delete')
    const work = event.type.startsWith('run.') || event.type === 'agent.status' || rosterWrite
    if (work && event.ts > latest) latest = event.ts
  }
  return latest
}
