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
 *   2. Anyone else would get slotForId(id) — stable across reloads, still
 *      inside 0–11. A hash can land on a robot someone else already wears
 *      ("scrum master" has no roster slot, so it can hash onto Writer).
 *      The first 12 seats therefore CLAIM slots: a known job takes its robot
 *      if it is still free, then everyone else walks forward from their hash
 *      until they find a free one. Two agents in that seated set never share
 *      a drawing.
 *   3. The dashboard may show more agents than there are designs. Seats are
 *      handed out in this order, and ties inside a tier use numeric order
 *      (the first integer in the name — "Spawn 2" before "Spawn 10"), then
 *      creation time when both agents have one, then a numeric string compare.
 *      A plain A–Z sort is wrong: "Spawn 10" sorts before "Spawn 2", so the
 *      badge landed on Spawn 9 and Spawn 10/11 kept full robots.
 *        - parentless agents (the org roots — their robot is what children copy)
 *        - then agents whose role is one of the 12 jobs
 *        - then the rest, until 12 seats are full
 *      Every agent past that cap who has a parent in the same list is a SMALL
 *      NUMBERED COPY of the parent's robot. The number is 1-based among that
 *      parent's overflow children, in the same numeric / creation-time order.
 *      OpenClaw's starter cap is 3 children per agent, so the badge is a
 *      single digit in normal use. Sharing the parent's robot is the only
 *      allowed repeat, and the badge is what makes the copy readable.
 */
import { ROBOT_COUNT, ROSTER, slotForId } from './robots'

/** The bits of an API agent this picker needs. Structural — full Agent fits. */
export interface AgentRobotRef {
  id: string
  name?: string | null
  role?: string | null
  parentId?: string | null
  /** ISO string or epoch ms, when the wire has it. Used only as a tiebreak. */
  createdAt?: string | number | null
}

/**
 * How to draw one agent.
 * childNumber === null → a full robot (one of the 12, unique among seats).
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
 * roles (the caller then falls through to slotForId, then to a free seat).
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

/** Preferred slot 0–11 for one agent, before the "already taken" walk. */
export function slotForAgent(agent: Pick<AgentRobotRef, 'id' | 'name' | 'role'>): number {
  const known = rosterSlotForAgent(agent)
  if (known != null) return known
  // Empty id still has to land somewhere stable. Name is the next-best key.
  return slotForId(agent.id || agent.name || 'agent')
}

/** First integer in the name ("Spawn 10" → 10). Null when the name has none. */
function firstInt(name: string | null | undefined): number | null {
  const m = (name ?? '').match(/\d+/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** Epoch ms when createdAt parses; null when the agent doesn't carry one. */
function timeOf(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * Seat order inside a tier. Numbers in the name win ("Spawn 2" before
 * "Spawn 10") — a code-unit sort puts "Spawn 10" first and hands the badge
 * to the wrong child. When either name has no number, creation time orders
 * them if both have it. The numeric string compare is only the leftover
 * tiebreak, so "Planner" still sorts steadily against "Spawn 00".
 */
function bySeat(a: AgentRobotRef, b: AgentRobotRef): number {
  const na = firstInt(a.name)
  const nb = firstInt(b.name)
  if (na != null && nb != null && na !== nb) return na - nb
  const ta = timeOf(a.createdAt)
  const tb = timeOf(b.createdAt)
  if (ta != null && tb != null && ta !== tb) return ta - tb
  const n = (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' })
  if (n !== 0) return n
  return a.id.localeCompare(b.id)
}

/**
 * Roots, then known jobs, then everyone else. Each tier is already bySeat,
 * so Spawn 11 is the last spawn considered — the one that should wear badge 1
 * when the chief and Spawn 0–10 have taken the 12 seats.
 */
function seatOrder(agents: readonly AgentRobotRef[]): AgentRobotRef[] {
  const ordered = [...agents].sort(bySeat)
  const roots = ordered.filter((a) => !a.parentId)
  const jobs = ordered.filter((a) => a.parentId && rosterSlotForAgent(a) != null)
  const rest = ordered.filter((a) => a.parentId && rosterSlotForAgent(a) == null)
  return [...roots, ...jobs, ...rest]
}

/**
 * One distinct slot per seated agent.
 * Pass 1: a known roster job takes its robot while it is free, in seat
 * order, so the real Writer keeps Writer even if a scrum master's hash is
 * also slot 8.
 * Pass 2: everyone else starts at slotForId and walks forward until a robot
 * nobody in this set has claimed. With at most 12 seated agents this always
 * finds a free slot.
 */
function assignUnique(seated: readonly AgentRobotRef[]): Map<string, number> {
  const taken = new Set<number>()
  const out = new Map<string, number>()
  for (const a of seated) {
    const pref = rosterSlotForAgent(a)
    if (pref != null && !taken.has(pref)) {
      taken.add(pref)
      out.set(a.id, pref)
    }
  }
  for (const a of seated) {
    if (out.has(a.id)) continue
    const start = slotForId(a.id || a.name || 'agent')
    for (let i = 0; i < ROBOT_COUNT; i++) {
      const cand = (start + i) % ROBOT_COUNT
      if (!taken.has(cand)) {
        taken.add(cand)
        out.set(a.id, cand)
        break
      }
    }
  }
  return out
}

/**
 * One face per agent id.
 *
 * The first min(n, 12) agents in seat order get full, unique robots — that
 * includes a roster of 12 or fewer, where hashes used to collide (Demo
 * Planner and Demo Writer both drawing Writer, or a spawn drawing Chief).
 * Past 12, the leftovers copy their parent's slot and get childNumber
 * 1, 2, 3… in the same seat order. An overflow agent with no parent in this
 * list still gets a wrapped slot (there is no 13th drawing) but no number —
 * a number means "copy of parent".
 */
export function robotFaces(agents: readonly AgentRobotRef[]): Map<string, RobotFace> {
  const faces = new Map<string, RobotFace>()
  const ordered = seatOrder(agents)
  const seated = ordered.slice(0, ROBOT_COUNT)
  const slots = assignUnique(seated)
  for (const a of seated) {
    faces.set(a.id, { slot: slots.get(a.id) ?? slotForAgent(a), childNumber: null })
  }
  if (agents.length <= ROBOT_COUNT) return faces

  const byId = new Map(agents.map((a) => [a.id, a]))
  const primary = new Set(seated.map((a) => a.id))

  // Group the overflow by parent so siblings are numbered 1..n together.
  // `ordered` is already numeric / creation-time, so Spawn 11 is child 1
  // when it is the only spawn past the cap — not Spawn 9 from an A–Z sort.
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
