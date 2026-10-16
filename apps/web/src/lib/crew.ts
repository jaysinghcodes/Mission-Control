/**
 * Applies config/crew.json seats from GET /settings.
 *
 * The names live in that file. This module does not list them.
 * A seat is used only when naming mode is crew and the saved map
 * points this agent id at that seat. A role word never picks a seat.
 */

export interface CrewSeat {
  id: string
  name: string
  role: string
  desk: string
  color: string
}

export type NamingMode = 'crew' | 'own'

export interface NamedAgent {
  id: string
  name?: string | null
  role?: string | null
  color?: string | null
  position?: number | null
}

export interface NamingState {
  mode: NamingMode | null
  map: Record<string, string>
  seats: readonly CrewSeat[]
}

export interface Presented {
  name: string
  role: string
  color: string
  /** Null in own names mode: the office keeps the generic desk. */
  desk: string | null
}

const HEX = /^#[0-9a-fA-F]{6}$/
const FALLBACK_COLOR = '#58A6FF'

export function safeColor(value: string | null | undefined, fallback: string = FALLBACK_COLOR): string {
  const color = (value ?? '').trim()
  return HEX.test(color) ? color : fallback
}

export function presentAgent(agent: NamedAgent, state: NamingState): Presented {
  const own: Presented = {
    name: agent.name?.trim() || 'agent',
    role: agent.role?.trim() || 'Agent',
    color: safeColor(agent.color),
    desk: null,
  }
  if (state.mode !== 'crew') return own
  const seatId = state.map[agent.id]
  if (!seatId) return own
  const seat = state.seats.find((row) => row.id === seatId)
  if (!seat) return own
  return {
    name: seat.name,
    role: seat.role,
    color: safeColor(seat.color, own.color),
    desk: seat.desk,
  }
}

/** Id, stored name, or the crew name for a mapped id. Not a role keyword. */
export function findByLabel<T extends NamedAgent>(
  agents: readonly T[],
  label: string | null | undefined,
  state: NamingState,
): T | undefined {
  const key = (label ?? '').trim().toLowerCase()
  if (!key) return undefined
  return agents.find((agent) => {
    if (agent.id.trim().toLowerCase() === key) return true
    if ((agent.name ?? '').trim().toLowerCase() === key) return true
    return presentAgent(agent, state).name.toLowerCase() === key
  })
}

/** Team order is the position the API stored, then id. */
export function orderByPosition<T extends { id: string; position?: number | null }>(agents: readonly T[]): T[] {
  return [...agents].sort((a, b) => {
    const pa = a.position ?? 0
    const pb = b.position ?? 0
    if (pa !== pb) return pa - pb
    return a.id.localeCompare(b.id)
  })
}

/**
 * First open assignment. Seat i goes to the agent at position i.
 * Names and roles are not read.
 */
export function assignSeatsInOrder(
  agents: readonly { id: string; position?: number | null }[],
  seats: readonly { id: string }[],
): Record<string, string> {
  const ordered = orderByPosition(agents)
  const map: Record<string, string> = {}
  for (let i = 0; i < ordered.length && i < seats.length; i++) {
    map[ordered[i].id] = seats[i].id
  }
  return map
}
