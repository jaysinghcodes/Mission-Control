/**
 * Display rules for the seeded roster.
 *
 * A real bot has source registered or snapshot. While none exist, every
 * default stays on screen. Once one exists, unclaimed defaults hide until
 * Show sample bots is on, or until every real bot is gone. Hiding does not
 * delete rows. Robot art is chosen from the full list, not this filter.
 */

export const SHOW_SAMPLE_BOTS_LABEL = 'Show sample bots'
export const SAMPLE_LABEL = 'Sample'
export const OFFLINE_LABEL = 'Offline'

export const SHOW_SAMPLE_BOTS_KEY = 'mc-show-sample-bots'
export const SHOW_SAMPLE_BOTS_EVENT = 'mc-show-sample-bots'

/**
 * Same window as the API. GET /settings sends `offlineAfterMs`
 * (`OFFLINE_AFTER_MS`). Until that arrives, the clock check stays open
 * and the server `online` flag is what marks a bot offline.
 */
let offlineWindowMs = Number.POSITIVE_INFINITY

export function setOfflineWindowMs(ms: number) {
  if (Number.isFinite(ms) && ms > 0) offlineWindowMs = ms
}

export function offlineWindowMsNow(): number {
  return offlineWindowMs
}

export interface RosterSource {
  source?: string | null
}

export interface RosterPresence extends RosterSource {
  online?: boolean
  lastSeenAt?: string | null
  status?: string | null
}

export function isRealSource(source: string | null | undefined): boolean {
  return source === 'registered' || source === 'snapshot'
}

export function isSampleSource(source: string | null | undefined): boolean {
  return source === 'default'
}

export function hasRealBot(agents: readonly RosterSource[]): boolean {
  return agents.some((agent) => isRealSource(agent.source))
}

/**
 * Unclaimed defaults stay visible when the roster is only the seed, or when
 * the operator turns samples on. Otherwise they drop out of the list.
 * Registered and snapshot rows always stay. Order is unchanged.
 */
export function visibleAgents<T extends RosterSource>(
  agents: readonly T[],
  showSampleBots: boolean,
): T[] {
  if (!hasRealBot(agents) || showSampleBots) return agents.slice()
  return agents.filter((agent) => !isSampleSource(agent.source))
}

export function showSampleTag(agent: RosterSource): boolean {
  return isSampleSource(agent.source)
}

/**
 * A registered bot is Offline when the server says so, or when lastSeenAt
 * is at least the API offline window behind the clock this page is using.
 */
export function isRegisteredOffline(agent: RosterPresence, now: number): boolean {
  if (agent.source !== 'registered') return false
  if (typeof agent.lastSeenAt === 'string' && agent.lastSeenAt.length > 0) {
    const seen = Date.parse(agent.lastSeenAt)
    if (Number.isFinite(seen) && now - seen >= offlineWindowMs) return true
  }
  return agent.online === false
}

/** Idle art while offline, so the dimming sits on the existing idle robot. */
export function robotStatusFor(agent: RosterPresence, now: number, status?: string | null): string | null | undefined {
  if (isRegisteredOffline(agent, now)) return 'idle'
  return status ?? agent.status
}

export function readShowSampleBots(storage: { getItem(key: string): string | null } | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(SHOW_SAMPLE_BOTS_KEY) === '1'
  } catch {
    return false
  }
}

export function writeShowSampleBots(
  storage: { setItem(key: string, value: string): void } | null,
  on: boolean,
): void {
  if (!storage) return
  try {
    storage.setItem(SHOW_SAMPLE_BOTS_KEY, on ? '1' : '0')
  } catch {
    // This view still updates. The next reload uses the default.
  }
}

/**
 * Roster names first, in the supplied order. Anyone else is appended so a
 * real bot still shows beside the sample roster. With no roster match, the
 * first 12 agents are the row, same as before.
 */
export function orderedPeople<T extends { id: string }>(
  agents: readonly T[],
  rosterNames: readonly string[],
  captionName: (agent: T) => string,
): T[] {
  const used = new Set<string>()
  const picked: T[] = []
  for (const name of rosterNames) {
    const match = agents.find((agent) => {
      if (used.has(agent.id)) return false
      return captionName(agent) === name
    })
    if (!match) continue
    used.add(match.id)
    picked.push(match)
  }
  if (picked.length === 0) return agents.slice(0, 12)
  const rest = agents.filter((agent) => !used.has(agent.id))
  return [...picked, ...rest]
}
