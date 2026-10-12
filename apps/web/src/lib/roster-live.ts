/**
 * When an agents.snapshot event is newer than the last refetch, the open
 * roster should load again. Polling stays as a fallback. This does not
 * change how a robot is drawn.
 */
export function latestRosterEventTs(
  events: readonly { type: string; ts: number }[],
): number {
  let latest = 0
  for (const event of events) {
    if (event.type === 'agents.snapshot' && event.ts > latest) latest = event.ts
  }
  return latest
}

/** The timestamp to store after a refetch, or null when nothing new arrived. */
export function rosterRefreshTs(
  seenTs: number,
  events: readonly { type: string; ts: number }[],
): number | null {
  const latest = latestRosterEventTs(events)
  return latest > seenTs ? latest : null
}
