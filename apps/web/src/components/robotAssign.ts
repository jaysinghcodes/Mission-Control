/**
 * robotAssign.ts — which of the 12 hand-tuned robots an agent wears (ticket 12).
 *
 * Artwork lives in robots.tsx and is the source of truth: ROSTER is exactly
 * 12 slots (0–11), RobotAvatar draws them, slotForId hashes any id into that
 * range. This module only decides the slot. It does not invent a 13th design.
 *
 * Rules:
 *   1. An agent whose role (or name) is one of the roster jobs gets that slot,
 *      so "QA" is always the QA robot and "development" wears the Engineer.
 *   2. Anyone else gets slotForId(id) — stable across reloads, still inside
 *      0–11.
 *   3. The dashboard may show more agents than there are designs. The first
 *      12 seats stay full robots (roots first, then roster-role agents, then
 *      whoever is left, in name order). Every agent past that cap who has a
 *      parent in the same list is a SMALL NUMBERED COPY of the parent's
 *      robot. The number is 1-based among that parent's overflow children.
 *      OpenClaw's starter cap is 3 children per agent, so the badge is a
 *      single digit in normal use.
 */
import { ROBOT_COUNT, ROSTER, slotForId } from './robots'

/** The bits of an API agent this picker needs. Structural — full Agent fits. */
export interface AgentRobotRef {
  id: string
  name?: string | null
  role?: string | null
  parentId?: string | null
}

/**
 * How to draw one agent.
 * childNumber === null → a full robot (one of the 12).
 * childNumber >= 1     → overflow child: same slot as the parent, drawn
 *                         smaller, with this number on the badge.
 */
export interface RobotFace {
  slot: number
  childNumber: number | null
}

/** Lowercase, collapse separators — same idea as data/roster.ts. */
const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Dashboard lane names that are the same job as a roster robot but a
 * different word. The seed and the bridge push "development" / "summary" /
 * "alerts"; the artwork calls those Engineer / Writer / Security.
 * Matched against the role only, and only as a whole phrase, so "dev" does
 * not steal "development" and "lead" does not retag a "Lead Designer".
 */
const ROLE_ALIASES: ReadonlyArray<{ slot: number; keys: readonly string[] }> = [
  { slot: 0, keys: ['chief of staff', 'chief-of-staff', 'main agent', 'operator'] },
  { slot: 2, keys: ['development', 'developer', 'dev', 'engineering', 'engineer'] },
  { slot: 3, keys: ['quality assurance', 'quality', 'qa'] },
  { slot: 4, keys: ['researcher', 'research'] },
  { slot: 5, keys: ['designer', 'design'] },
  { slot: 6, keys: ['operations', 'ops'] },
  { slot: 7, keys: ['data'] },
  { slot: 8, keys: ['summarizer', 'summary', 'scribe', 'writer'] },
  { slot: 9, keys: ['security', 'alerts', 'alert', 'sentinel'] },
  { slot: 10, keys: ['support'] },
  { slot: 11, keys: ['scout'] },
  { slot: 1, keys: ['product'] },
]

/**
 * Roster slot for a known job, or null when the agent isn't one of the 12
 * roles (the caller then falls through to slotForId).
 */
export function rosterSlotForAgent(agent: Pick<AgentRobotRef, 'name' | 'role'>): number | null {
  const role = norm(agent.role)
  const name = norm(agent.name)
  // Exact roster label first ("Chief of Staff", "QA", "Scout", …).
  for (let i = 0; i < ROSTER.length; i++) {
    const label = norm(ROSTER[i].role)
    if ((role && role === label) || (name && name === label)) return i
  }
  if (!role) return null
  for (const row of ROLE_ALIASES) {
    if (row.keys.some((k) => role === norm(k))) return row.slot
  }
  return null
}

/** Slot 0–11 for one agent, ignoring the "past 12 agents" numbering rule. */
export function slotForAgent(agent: Pick<AgentRobotRef, 'id' | 'name' | 'role'>): number {
  const known = rosterSlotForAgent(agent)
  if (known != null) return known
  // Empty id still has to land somewhere stable. Name is the next-best key.
  return slotForId(agent.id || agent.name || 'agent')
}

/** Name, then id — so child numbers don't jump around between polls. */
function byName(a: AgentRobotRef, b: AgentRobotRef): number {
  const n = (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
  if (n !== 0) return n
  return a.id.localeCompare(b.id)
}

/**
 * One face per agent id.
 *
 * At or under 12 agents everyone gets a full robot. Past that, seats are
 * handed out until ROBOT_COUNT is exhausted:
 *   - parentless agents (the org roots — their robot is what children copy)
 *   - then agents whose role is one of the 12 jobs (so QA keeps the QA robot
 *     even when a swarm of spawned sub-agents sorts first alphabetically)
 *   - then the rest, in name order
 * Agents left over copy their parent's slot and get childNumber 1, 2, 3…
 * An overflow agent with no parent in this list still gets a wrapped slot
 * (there is no 13th drawing) but no number — a number means "copy of parent".
 */
export function robotFaces(agents: readonly AgentRobotRef[]): Map<string, RobotFace> {
  const faces = new Map<string, RobotFace>()
  if (agents.length <= ROBOT_COUNT) {
    for (const a of agents) faces.set(a.id, { slot: slotForAgent(a), childNumber: null })
    return faces
  }

  const byId = new Map(agents.map((a) => [a.id, a]))
  const ordered = [...agents].sort(byName)
  const primaryIds: string[] = []
  const claim = (list: AgentRobotRef[]) => {
    for (const a of list) {
      if (primaryIds.length >= ROBOT_COUNT) return
      if (!primaryIds.includes(a.id)) primaryIds.push(a.id)
    }
  }
  // Roots first, then named jobs, then whoever is left — never more than 12.
  claim(ordered.filter((a) => !a.parentId))
  claim(ordered.filter((a) => rosterSlotForAgent(a) != null))
  claim(ordered)
  const primary = new Set(primaryIds)

  for (const id of primaryIds) {
    const a = byId.get(id)
    if (!a) continue
    faces.set(id, { slot: slotForAgent(a), childNumber: null })
  }

  // Group the overflow by parent so siblings are numbered 1..n together.
  const kidsByParent = new Map<string, AgentRobotRef[]>()
  for (const a of ordered) {
    if (primary.has(a.id)) continue
    const key = a.parentId && byId.has(a.parentId) ? a.parentId : ''
    const list = kidsByParent.get(key) ?? []
    list.push(a)
    kidsByParent.set(key, list)
  }
  for (const [parentId, kids] of kidsByParent) {
    const parent = parentId ? byId.get(parentId) : undefined
    // Parent may itself be past the cap (13 roots). Still copy that parent's
    // robot — slotForAgent is enough; we don't need the parent to hold a seat.
    const slot = parent ? (faces.get(parent.id)?.slot ?? slotForAgent(parent)) : null
    kids.forEach((kid, i) => {
      faces.set(kid.id, {
        slot: slot ?? slotForAgent(kid),
        childNumber: slot == null ? null : i + 1,
      })
    })
  }
  return faces
}
