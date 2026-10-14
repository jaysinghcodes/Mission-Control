/**
 * One live placement for Agents, Team, and Office.
 *
 * Precedence, first match wins:
 * 1. Active ticket. The bot is the assignee (id or name) of a ticket in a
 *    pipeline stage: build, qa, review, or done (inprogress counts as build).
 *    The room is that stage. The subtitle is the ticket title.
 *    Several tickets: newest createdAt, then the later stage.
 * 2. Active run. status is running or needs_approval, the run names this bot,
 *    and ticketId points at a ticket in a pipeline stage. The room is that
 *    ticket's stage. The subtitle is the ticket title, or the run name.
 *    A queued, done, or failed run is not active. A run with no ticket in a
 *    stage does not take a desk.
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

export type LiveRoom = 'build' | 'qa' | 'ship' | 'deploy' | 'commons'
export type LiveSource = 'ticket' | 'run' | 'heartbeat'

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

export interface LivePerson {
  id: string
  name: string
  status?: string | null
  currentTask?: string | null
}

export interface LiveWork {
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

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : 0
}

export function samePerson(
  agent: { id: string; name: string },
  label: string | null | undefined,
): boolean {
  const raw = (label ?? '').trim()
  if (!raw) return false
  const key = raw.toLowerCase()
  return key === agent.id.trim().toLowerCase() || key === agent.name.trim().toLowerCase()
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
    (ticket) => samePerson(agent, ticket.assignee) && stageRoom(ticket.status),
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

/**
 * Who an activity row is about. Prefer payload.agent, then the ticket
 * assignee, then the run's agent. The word system is never a name.
 */
export function activityActor(
  payload: ActivityPayload | null | undefined,
  roster: readonly { id: string; name: string; role?: string | null }[],
  tickets: readonly LiveTicket[],
  runs: readonly LiveRun[] = [],
): ActivityActor | null {
  const named = (payload?.agent ?? '').trim()
  let label = named && !NOT_AN_AGENT.has(named.toLowerCase()) ? named : ''
  if (!label) {
    const ref = (payload?.ticket ?? '').trim()
    if (ref) {
      const ticket = tickets.find((row) => row.key === ref || row.id === ref)
      const assignee = ticket?.assignee?.trim() ?? ''
      if (assignee && !NOT_AN_AGENT.has(assignee.toLowerCase())) label = assignee
    }
  }
  if (!label) {
    const id = (payload?.id ?? '').trim()
    if (id) {
      const run = runs.find((row) => row.id === id)
      const who = run?.agent?.trim() ?? ''
      if (who && !NOT_AN_AGENT.has(who.toLowerCase())) label = who
    }
  }
  if (!label) return null
  const key = label.toLowerCase()
  const hit = roster.find(
    (agent) => agent.id.toLowerCase() === key || agent.name.toLowerCase() === key,
  )
  if (hit) return { id: hit.id, name: hit.name, role: hit.role ?? null }
  return { id: label, name: label, role: null }
}

/** Newest run.* socket event, or 0 when none has arrived. */
export function latestWorkEventTs(events: readonly { type: string; ts: number }[]): number {
  let latest = 0
  for (const event of events) {
    if (event.type.startsWith('run.') && event.ts > latest) latest = event.ts
  }
  return latest
}
