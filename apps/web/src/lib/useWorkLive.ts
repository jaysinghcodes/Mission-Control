import { useEffect, useRef } from 'react'
import { latestWorkEventTs } from './live-work'

/**
 * Refetch tickets, runs, and activity when a run.* event arrives.
 * Ticket moves broadcast run.progress and run.queued. Run writes broadcast
 * run.started, run.completed, run.failed, and run.queued. The page does not reload.
 */
export function useWorkLive(
  events: readonly { type: string; ts: number }[],
  ...refetchers: Array<() => void>
): void {
  const seen = useRef(0)
  const pending = useRef(refetchers)
  pending.current = refetchers
  useEffect(() => {
    const latest = latestWorkEventTs(events)
    if (latest <= seen.current) return
    seen.current = latest
    for (const refetch of pending.current) void refetch()
  }, [events])
}
