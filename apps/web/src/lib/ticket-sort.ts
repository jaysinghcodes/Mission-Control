/**
 * Display order for one column. Nothing here calls the API.
 * The browser stores the choice under mc-ticket-sort.
 */

export const SORT_STORAGE_KEY = 'mc-ticket-sort'

export const SORT_MODES = ['priority', 'newest', 'oldest'] as const
export type SortMode = (typeof SORT_MODES)[number]

export const SORT_LABELS: Record<SortMode, string> = {
  priority: 'Priority',
  newest: 'Newest',
  oldest: 'Oldest',
}

export interface SortableTicket {
  id: string
  priority: string
  createdAt: string
}

export interface SortStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function defaultSortMode(column: string): SortMode {
  return column === 'done' ? 'newest' : 'priority'
}

/** Unknown priority sorts with med. */
export function priorityRank(priority: string): number {
  if (priority === 'high') return 0
  if (priority === 'low') return 2
  return 1
}

function createdMillis(value: string): number {
  const n = new Date(value).getTime()
  return Number.isFinite(n) ? n : 0
}

function byId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

export function compareTickets(mode: SortMode, a: SortableTicket, b: SortableTicket): number {
  if (mode === 'priority') {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    const byAge = createdMillis(a.createdAt) - createdMillis(b.createdAt)
    if (byAge !== 0) return byAge
    return byId(a, b)
  }
  const direction = mode === 'newest' ? -1 : 1
  const byAge = (createdMillis(a.createdAt) - createdMillis(b.createdAt)) * direction
  if (byAge !== 0) return byAge
  return byId(a, b)
}

export function sortTickets<T extends SortableTicket>(rows: readonly T[], mode: SortMode): T[] {
  return [...rows].sort((a, b) => compareTickets(mode, a, b))
}

export function isSortMode(value: unknown): value is SortMode {
  return value === 'priority' || value === 'newest' || value === 'oldest'
}

function browserStore(): SortStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** A missing, broken, or blocked store returns an empty map and never throws. */
export function readSortMap(storage?: SortStore | null): Partial<Record<string, SortMode>> {
  try {
    const store = storage === undefined ? browserStore() : storage
    if (!store) return {}
    const raw = store.getItem(SORT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Partial<Record<string, SortMode>> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isSortMode(value)) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function writeSortMap(
  map: Partial<Record<string, SortMode>>,
  storage?: SortStore | null,
): void {
  try {
    const store = storage === undefined ? browserStore() : storage
    if (!store) return
    store.setItem(SORT_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // The page still sorts with the defaults.
  }
}

export function modeForColumn(map: Partial<Record<string, SortMode>>, column: string): SortMode {
  const stored = map[column]
  return isSortMode(stored) ? stored : defaultSortMode(column)
}
