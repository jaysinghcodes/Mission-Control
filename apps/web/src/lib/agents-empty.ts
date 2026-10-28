/**
 * Agents page copy when search or the status filter hides every card.
 * Filter index matches the Segmented labels: 0 All, 1 Working, 2 Idle.
 */
export const AGENTS_NO_MATCH_TITLE = 'No agents match'

export function agentsNoMatchBody(query: string, filter: number): string {
  const searching = query.trim().length > 0
  const filtered = filter === 1 || filter === 2
  if (searching && filtered) return 'Nobody matches that search and filter. Clear the search and pick All to see every agent.'
  if (searching) return 'Nobody matches that search. Clear it to see every agent.'
  if (filter === 1) return 'Nobody is working right now. Pick All to see every agent.'
  if (filter === 2) return 'Nobody is idle right now. Pick All to see every agent.'
  return 'Nobody to show. Pick All to see every agent.'
}
