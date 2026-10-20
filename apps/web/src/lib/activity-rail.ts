/**
 * One sentence for an activity row. Office, Calendar, and System all use
 * this. A row with no sentence is omitted. An event type string is never
 * a sentence.
 */
import { activityText } from './activity-text'
import { presentAgent, type NamingState } from './crew'
import {
  activityActor,
  type ActivityActor,
  type ActivityPayload,
  type LiveRun,
  type LiveTicket,
} from './live-work'

const EVENT_TYPE = /^(?:agents|agent|run|ticket|health|approval|sessions|session|calendar|memory|usage)\.[a-z0-9_.]+$/i

export interface RailPayload extends ActivityPayload {
  summary?: string | null
  title?: string | null
  action?: string | null
  status?: string | null
  agents?: unknown
}

export interface RailEvent {
  type?: string
  payload?: RailPayload | null
  name?: unknown
  summary?: unknown
  title?: unknown
  agent?: unknown
  id?: unknown
  action?: unknown
  status?: unknown
  agents?: unknown
  ticket?: unknown
}

export interface RailLine {
  actor: ActivityActor | null
  text: string
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isEventType(text: string): boolean {
  return EVENT_TYPE.test(text.trim())
}

function payloadOf(event: RailEvent): RailPayload | null {
  if (event.payload && typeof event.payload === 'object') return event.payload
  const id = textOf(event.id)
  const agent = textOf(event.agent)
  const name = textOf(event.name)
  const summary = textOf(event.summary)
  const action = textOf(event.action)
  const status = textOf(event.status)
  const ticket = textOf(event.ticket)
  if (!id && !agent && !name && !summary && !action && !status && !ticket && !event.agents) return null
  return {
    id: id || null,
    agent: agent || null,
    name: name || null,
    summary: summary || null,
    title: textOf(event.title) || null,
    action: action || null,
    status: status || null,
    ticket: ticket || null,
    agents: event.agents,
  }
}

/** The registered name baked into a stored register, delete, or status sentence. */
function storedRegisteredName(stored: string): string {
  if (stored.endsWith(' registered')) return stored.slice(0, -' registered'.length).trim()
  if (stored.endsWith(' went offline')) return stored.slice(0, -' went offline'.length).trim()
  const mark = ' is now '
  const at = stored.lastIndexOf(mark)
  if (at > 0) return stored.slice(0, at).trim()
  return ''
}

function sentenceFor(payload: RailPayload, actorName: string): string {
  const action = textOf(payload.action)
  if (action === 'register') return `${actorName} registered`
  if (action === 'delete') return `${actorName} went offline`
  const status = textOf(payload.status).toLowerCase().replace(/_/g, ' ')
  if (status && action !== 'heartbeat') return `${actorName} is now ${status}`
  return ''
}

/**
 * Seated crew name for this agent id. Own names mode, or an agent with
 * no seat, keeps the registered name. A display name is not a map key.
 */
function seatedName(actor: ActivityActor, naming?: NamingState | null): string {
  if (!naming) return actor.name
  return presentAgent({ id: actor.id, name: actor.name, role: actor.role }, naming).name
}

/**
 * The line to show, or null when the row is a snapshot refresh or has
 * nothing to say. payload.id is read as a roster id by activityActor.
 * A living agent, or an id that still has a seat, uses the current name,
 * so a seat change in Settings relabels the row. An id that has left the
 * roster and has no seat keeps the stored sentence. The row header uses
 * that same registered name, not the raw id.
 */
export function activityRailLine(
  event: RailEvent,
  roster: readonly { id: string; name: string; role?: string | null }[],
  tickets: readonly LiveTicket[] = [],
  runs: readonly LiveRun[] = [],
  naming?: NamingState | null,
): RailLine | null {
  const payload = payloadOf(event)
  const storedRaw = activityText(payload)
  const stored = storedRaw && !isEventType(storedRaw) && storedRaw !== (event.type ?? '') ? storedRaw : ''
  const action = textOf(payload?.action)
  const refresh = Array.isArray(payload?.agents) || action === 'heartbeat'
  if (refresh && !stored) return null
  const actor = activityActor(payload, roster, tickets, runs)
  const known = actor != null && roster.some((agent) => agent.id.trim() === actor.id.trim())
  const presented = actor ? seatedName(actor, naming) : ''
  const fromSeat = actor != null && presented !== actor.name
  const relabel = known || fromSeat
  const rebuilt = relabel ? sentenceFor(payload ?? {}, presented) : ''
  const text = rebuilt || stored
  if (!text || isEventType(text) || text === event.type) return null
  const remembered = !relabel && stored ? storedRegisteredName(stored) : ''
  const actorName = relabel ? presented : remembered || actor?.name || ''
  return { actor: actor ? { ...actor, name: actorName } : null, text }
}
