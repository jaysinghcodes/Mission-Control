/**
 * Office floor placement.
 *
 * The locked picture (design-refs/ticket-9) is Build / QA / Ship / Deploy
 * desks plus a Commons. This module only decides who sits where for the
 * segmented filter. Task lines, activity, and pipeline counts stay on the
 * live agent / ticket / approval payloads.
 */

export type DeskRoom = 'build' | 'qa' | 'ship' | 'deploy'
export type Room = DeskRoom | 'commons'
export type FloorMode = 'all' | 'gather' | 'meeting' | 'break'

export const FLOOR_MODES: readonly FloorMode[] = ['all', 'gather', 'meeting', 'break']
export const DESK_ROOMS: readonly DeskRoom[] = ['build', 'qa', 'ship', 'deploy']

/** Two desks per room, matching the locked mock. Overflow joins the Commons. */
export const DESK_CAP = 2

export interface FloorAgent {
  id: string
  name: string
  role?: string | null
  status?: string | null
  currentTask?: string | null
}

export function floorMode(index: number): FloorMode {
  return FLOOR_MODES[index] ?? 'all'
}

function hay(agent: FloorAgent): string {
  return `${agent.role ?? ''} ${agent.name}`.toLowerCase()
}

/** Home seat from role. Product sits in Ship (Atlas); the council sits in Commons. */
export function homeRoom(agent: FloorAgent): Room {
  const r = hay(agent)
  if (/chief|research|support|scout|trend/.test(r)) return 'commons'
  if (/qa|quality|security|alert/.test(r)) return 'qa'
  if (/writer|summary|scribe|product/.test(r)) return 'ship'
  if (/ops|data|deploy/.test(r)) return 'deploy'
  if (/engineer|developer|development|\bdev\b|design/.test(r)) return 'build'
  return agent.status === 'working' ? 'build' : 'commons'
}

/** On the clock: working, or waiting on a decision. Idle agents are on break. */
export function isOnClock(agent: FloorAgent, blocked: boolean): boolean {
  return agent.status === 'working' || blocked
}

function seatRank(agent: FloorAgent, blockedIds: ReadonlySet<string>): number {
  if (blockedIds.has(agent.id)) return 1
  if (agent.status === 'working') return 0
  return 2
}

const COMMONS_SEAT = ['chief', 'research', 'scout', 'trend', 'support']

function commonsSeat(agent: FloorAgent): number {
  const r = hay(agent)
  const i = COMMONS_SEAT.findIndex((key) => r.includes(key))
  return i === -1 ? COMMONS_SEAT.length : i
}

/**
 * All working: everyone at their home seat (idle agents stay at their desk).
 * Gather: on-the-clock agents only, still at home.
 * Meeting: the Commons council only.
 * Break: idle agents leave their desks and land in the Commons.
 */
export function placeFloor<T extends FloorAgent>(
  agents: readonly T[],
  mode: FloorMode,
  blockedIds: ReadonlySet<string>,
): Record<Room, T[]> {
  const buckets: Record<Room, T[]> = {
    build: [],
    qa: [],
    ship: [],
    deploy: [],
    commons: [],
  }
  for (const agent of agents) {
    const home = homeRoom(agent)
    const onClock = isOnClock(agent, blockedIds.has(agent.id))
    if (mode === 'gather' && !onClock) continue
    if (mode === 'meeting' && (home !== 'commons' || !onClock)) continue
    if (mode === 'break') {
      if (onClock) continue
      buckets.commons.push(agent)
      continue
    }
    buckets[home].push(agent)
  }
  for (const id of DESK_ROOMS) {
    buckets[id].sort(
      (a, b) => seatRank(a, blockedIds) - seatRank(b, blockedIds) || a.name.localeCompare(b.name),
    )
    const extra = buckets[id].splice(DESK_CAP)
    buckets.commons.push(...extra)
  }
  buckets.commons.sort((a, b) => commonsSeat(a) - commonsSeat(b) || a.name.localeCompare(b.name))
  return buckets
}

/** People-count byline. Blocked agents are not "testing" / "in progress". */
export function roomByline(
  room: DeskRoom,
  crew: readonly FloorAgent[],
  blockedIds: ReadonlySet<string>,
): string {
  const n = crew.filter((agent) => agent.status === 'working' && !blockedIds.has(agent.id)).length
  if (n === 0) return 'Idle'
  if (room === 'build') return n === 1 ? '1 in progress' : `${n} in progress`
  if (room === 'qa') return n === 1 ? '1 testing' : `${n} testing`
  if (room === 'ship') return n === 1 ? '1 ready' : `${n} ready`
  return n === 1 ? '1 deploying' : `${n} deploying`
}

export function taskLine(agent: FloorAgent, blocked: boolean): string {
  if (blocked) return 'Needs approval'
  const task = agent.currentTask?.trim()
  if (task) return task
  return agent.status === 'working' ? 'Working' : 'Idle'
}

export function commonsByline(crew: readonly FloorAgent[], mode: FloorMode): string {
  const n = crew.length
  if (n === 0) return 'Empty'
  if (mode === 'break') return n === 1 ? '1 on break' : `${n} on break`
  const council = crew.every((agent) => homeRoom(agent) === 'commons')
  if (council) return `Build council · ${n} ${n === 1 ? 'agent' : 'agents'}`
  return n === 1 ? '1 agent' : `${n} agents`
}

/** Table caption. The chief's task is the meeting topic; break has no topic. */
export function commonsTopic(crew: readonly FloorAgent[], mode: FloorMode): string | null {
  if (mode === 'break' || crew.length === 0) return null
  const chief = crew.find((agent) => /chief/.test(hay(agent)))
  const line = (chief?.currentTask ?? crew.find((agent) => agent.currentTask?.trim())?.currentTask ?? '').trim()
  return line || null
}

/** Short age for the activity rail (2m, 1h), so the time stays on one line. */
export function activityAge(ts: string, now: number): string {
  const ms = now - new Date(ts).getTime()
  if (!Number.isFinite(ms)) return ''
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}
