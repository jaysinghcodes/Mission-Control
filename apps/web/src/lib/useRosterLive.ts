import { useEffect, useRef } from 'react'
import { rosterConnectRefresh, rosterRefreshTs } from './roster-live'

/**
 * Refetch GET /agents when the socket connects, and again when a register,
 * heartbeat, or delete broadcasts agents.snapshot. The connect refetch
 * picks up a bot that registered while the first load was still in flight.
 * The page does not reload and the robot art stays put.
 */
export function useRosterLive(
  events: readonly { type: string; ts: number }[],
  refetch: () => void,
  connected = false,
): void {
  const seen = useRef(0)
  const wasConnected = useRef(false)
  useEffect(() => {
    const justConnected = rosterConnectRefresh(wasConnected.current, connected)
    wasConnected.current = connected
    if (justConnected) void refetch()
    const next = rosterRefreshTs(seen.current, events)
    if (next == null) return
    seen.current = next
    void refetch()
  }, [events, refetch, connected])
}
