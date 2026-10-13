import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  readShowSampleBots,
  SHOW_SAMPLE_BOTS_EVENT,
  visibleAgents,
  writeShowSampleBots,
  type RosterSource,
} from './sample-roster'

function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Off until the operator turns it on. The value survives a reload. */
export function useShowSampleBots(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => readShowSampleBots(browserStorage()))
  useEffect(() => {
    const sync = () => setOn(readShowSampleBots(browserStorage()))
    window.addEventListener('storage', sync)
    window.addEventListener(SHOW_SAMPLE_BOTS_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SHOW_SAMPLE_BOTS_EVENT, sync)
    }
  }, [])
  const write = useCallback((next: boolean) => {
    writeShowSampleBots(browserStorage(), next)
    setOn(next)
    window.dispatchEvent(new Event(SHOW_SAMPLE_BOTS_EVENT))
  }, [])
  return [on, write]
}

/**
 * Re-render as the clock moves so a registered bot can become Offline
 * without waiting for the next poll. A mocked clock advances this too.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useRosterView<T extends RosterSource>(agents: readonly T[]): {
  visible: T[]
  now: number
  showSampleBots: boolean
} {
  const [showSampleBots] = useShowSampleBots()
  const now = useNow()
  const visible = useMemo(
    () => visibleAgents(agents, showSampleBots),
    [agents, showSampleBots],
  )
  return { visible, now, showSampleBots }
}
