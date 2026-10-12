import { useEffect, useRef } from 'react'
import { rosterRefreshTs } from './roster-live'

/**
 * Refetch GET /agents when a register, heartbeat, or delete broadcasts
 * agents.snapshot. The page does not reload and the robot art stays put.
 */
export function useRosterLive(
  events: readonly { type: string; ts: number }[],
  refetch: () => void,
): void {
  const seen = useRef(0)
  useEffect(() => {
    const next = rosterRefreshTs(seen.current, events)
    if (next == null) return
    seen.current = next
    void refetch()
  }, [events, refetch])
}
