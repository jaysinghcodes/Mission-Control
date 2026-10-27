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

const SHOW_SAMPLE_BOTS_KEY = 'mc-show-sample-bots'
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

function isRealSource(source: string | null | undefined): boolean {
  return source === 'registered' || source === 'snapshot'
}

function isSampleSource(source: string | null | undefined): boolean {
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

/**
 * Ids of the sample bots that visibleAgents dropped (issue 117). Empty
 * while every default is on screen.
 */
export function hiddenAgentIds<T extends RosterSource & { id: string }>(
  agents: readonly T[],
  showSampleBots: boolean,
): Set<string> {
  const shown = new Set(visibleAgents(agents, showSampleBots).map((agent) => agent.id))
  return new Set(agents.filter((agent) => !shown.has(agent.id)).map((agent) => agent.id))
}

/**
 * The visible bot a usage or session label names, or undefined (issue 117).
 * A label matches a roster id or display name, ignoring case. An exact id
 * wins over a name. While no sample bot is hidden, this is not used and
 * every label keeps its sticker.
 */
export function visibleBotFor<T extends { id: string; name?: string | null }>(
  agents: readonly T[],
  hidden: ReadonlySet<string>,
  label: string | null | undefined,
): T | undefined {
  const key = (label ?? '').trim()
  if (!key) return undefined
  const exact = agents.find((agent) => agent.id.trim() === key)
  if (exact) return hidden.has(exact.id) ? undefined : exact
  const lower = key.toLowerCase()
  return agents.find((agent) => {
    if (hidden.has(agent.id)) return false
    return agent.id.trim().toLowerCase() === lower || (agent.name ?? '').trim().toLowerCase() === lower
  })
}

/**
 * Agent labels for one System model line. With sample bots hidden, only
 * labels that resolve to a visible bot stay, as that bot's id, so a hidden
 * sample such as Quill and an off roster label such as Sage both drop.
 * With nothing hidden, labels pass through. Blank labels and repeats drop.
 */
export function visibleAgentKeys<T extends { id: string; name?: string | null }>(
  agents: readonly T[],
  hidden: ReadonlySet<string>,
  labels: readonly (string | null | undefined)[],
): string[] {
  const out: string[] = []
  for (const raw of labels) {
    const label = (raw ?? '').trim()
    if (!label) continue
    let key: string | undefined = label
    if (hidden.size > 0) key = visibleBotFor(agents, hidden, label)?.id
    if (key && !out.includes(key)) out.push(key)
  }
  return out
}

/**
 * Work rows minus those owned by a hidden sample bot, so a count beside
 * the floor matches the bots on it. A ticket's owner is `assignee`, a
 * run's is `agent`, both an agent id. Unassigned rows and rows for the
 * operator or an unknown id stay.
 */
export function withoutHiddenBots<T extends { assignee?: string | null; agent?: string | null }>(
  rows: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  if (hidden.size === 0) return rows.slice()
  return rows.filter((row) => {
    const owner = (row.assignee ?? row.agent ?? '').trim()
    return !owner || !hidden.has(owner)
  })
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
