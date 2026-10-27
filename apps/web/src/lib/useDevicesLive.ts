import { useEffect, useRef } from 'react'
import { devicesRefreshTs } from './device-form'

/**
 * Refetch GET /devices when a devices.snapshot arrives. Dashboard create
 * and delete broadcast one, and so does the bridge. Polling stays as the
 * slow fallback.
 */
export function useDevicesLive(
  events: readonly { type: string; ts: number }[],
  refetch: () => void,
): void {
  const seen = useRef(0)
  useEffect(() => {
    const next = devicesRefreshTs(seen.current, events)
    if (next == null) return
    seen.current = next
    void refetch()
  }, [events, refetch])
}
