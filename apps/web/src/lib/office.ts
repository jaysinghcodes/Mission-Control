/**
 * Office floor placement.
 *
 * The locked picture is Build / QA / Ship / Deploy desks plus a Commons.
 * Who sits where is the room already chosen by live work (see live-work.ts).
 * This module only applies the segmented filter and the two desk cap.
 * Role text is not a seat. A display name is not a seat.
 * Crew names are applied by agent id before this floor runs.
 * Order inside a room follows agent id, so a crew rename does not
 * move someone between a desk and the Commons. Roster position does not either.
 */

import { pluralize } from './pluralize'

export type DeskRoom = 'build' | 'qa' | 'ship' | 'deploy'
export type Room = DeskRoom | 'commons'
type FloorMode = 'all' | 'gather' | 'meeting' | 'break'

export const FLOOR_MODES: readonly FloorMode[] = ['all', 'gather', 'meeting', 'break']
export const DESK_ROOMS: readonly DeskRoom[] = ['build', 'qa', 'ship', 'deploy']

/** Two desks per room, matching the locked mock. Overflow joins the Commons. */
export const DESK_CAP = 2

interface FloorAgent {
  id: string
  name: string
  role?: string | null
  status?: string | null
  currentTask?: string | null
  /** Live room from deriveLiveWork. Missing means Commons. */
  room?: Room | null
}

export function floorMode(index: number): FloorMode {
  return FLOOR_MODES[index] ?? 'all'
}

/** The room live work already chose. Role text is ignored. */
export function seatRoom(agent: FloorAgent): Room {
  const room = agent.room
  if (room === 'build' || room === 'qa' || room === 'ship' || room === 'deploy' || room === 'commons') {
    return room
  }
  return 'commons'
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

/**
 * All: everyone at their live room.
 * Gather: on the clock only, still in that room.
 * Meeting: on the clock agents whose live room is Commons.
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
    const home = seatRoom(agent)
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
      (a, b) => seatRank(a, blockedIds) - seatRank(b, blockedIds) || a.id.localeCompare(b.id),
    )
    const extra = buckets[id].splice(DESK_CAP)
    buckets.commons.push(...extra)
  }
  buckets.commons.sort((a, b) => a.id.localeCompare(b.id))
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
  if (room === 'build') return pluralize(n, 'in progress', 'in progress')
  if (room === 'qa') return pluralize(n, 'testing', 'testing')
  if (room === 'ship') return pluralize(n, 'ready', 'ready')
  return pluralize(n, 'deploying', 'deploying')
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
  if (mode === 'break') return pluralize(n, 'on break', 'on break')
  return pluralize(n, 'agent')
}

/** Table caption. The first live line in the room; break has no topic. */
export function commonsTopic(crew: readonly FloorAgent[], mode: FloorMode): string | null {
  if (mode === 'break' || crew.length === 0) return null
  const line = (crew.find((agent) => {
    const task = agent.currentTask?.trim()
    return !!task && task !== 'Idle'
  })?.currentTask ?? '').trim()
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
