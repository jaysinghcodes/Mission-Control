import type { Agent } from '../types'
import { Face } from './shell'
import { SAMPLE_LABEL, isRegisteredOffline } from '../lib/sample-roster'

/** Small tag on a default bot. The word is Sample. */
export function SampleTag() {
  return (
    <span className="sample-tag" data-sample-tag="true">
      {SAMPLE_LABEL}
    </span>
  )
}

/**
 * The same robot as the rest of the roster. Offline draws the idle pose
 * and dims it. It does not switch the artwork to a new state.
 */
export function RosterRobot({
  agent,
  agents,
  px = 32,
  now,
  status,
}: {
  agent: Agent
  agents?: readonly Agent[]
  px?: number
  now: number
  status?: string | null
}) {
  const offline = isRegisteredOffline(agent, now)
  const drawn = { ...agent, status: offline ? 'idle' : (status ?? agent.status) }
  return <Face agent={drawn} agents={agents} px={px} dim={offline} />
}
