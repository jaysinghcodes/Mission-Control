import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { ROSTER, RobotAvatar, type RobotStatus } from './robots'
import { robotFaces, slotForAgent, type AgentRobotRef } from './robotAssign'

/**
 * AgentAvatar — the one robot renderer for Team, the profile drawer, Office
 * and Live Activity (ticket 12).
 *
 * It draws robots.tsx (ROSTER slots 0–11, RobotAvatar, slotForId). That file
 * is the artwork source of truth: flat-vector robots, and a light sticker
 * halo (SVG dilate of the robot's own color) so the navy outline stays
 * readable on the dark UI. The halo is on when the app is in dark mode and
 * off in light mode — a white bloom on a white card would hide the outline.
 *
 * There are 12 drawings, not 13. robotAssign hands out those slots. When the
 * roster grows past 12, extra agents that have a parent render here as a
 * smaller copy of the parent's robot with a numbered badge (1, 2, 3…).
 *
 * Callers keep the old props: `agent` plus an optional numeric `size`
 * multiplier (Team member 1, chief 1.9, drawer 1.8, floor 0.8). Pass `agents`
 * (the list this agent came from) so the past-12 numbering can see the parent.
 * Without it, the agent is drawn as a single full robot.
 */

/** Minimal agent shape. The full API Agent satisfies this. */
export interface AvatarAgentShape {
  id?: string | null
  name?: string | null
  role?: string | null
  status?: string | null
  parentId?: string | null
}

/**
 * Legacy multiplier → pixels, lined up with the roster sheet's UI sizes
 * (32px floor bot, 40px member card, 64px chief / profile).
 * Overflow children are scaled down again — they are a copy, not a new seat.
 */
function avatarPx(size: number, child: boolean): number {
  const base = size >= 1.7 ? 64 : size >= 1.2 ? 48 : size >= 0.95 ? 40 : 32
  return child ? Math.max(22, Math.round(base * 0.62)) : base
}

/**
 * Live status → RobotAvatar's pip.
 * working / idle match the API. error-ish states use the robot's red
 * "blocked" pip (the artwork has no separate "error" status). Anything we
 * don't recognise stays offline rather than inventing a state. A missing
 * status draws no pip — the surrounding card already has its own dot.
 */
function robotStatus(status: string | null | undefined): RobotStatus | undefined {
  const s = (status ?? '').toLowerCase().trim()
  if (!s) return undefined
  if (s === 'working' || s === 'active' || s === 'busy') return 'working'
  if (s === 'idle') return 'idle'
  if (s === 'blocked' || s === 'error' || s === 'failed' || s === 'failure' || s === 'fault') return 'blocked'
  if (s === 'offline') return 'offline'
  return 'offline'
}

/**
 * Dark UI = no `.light` class on <html> (see AppLayout's theme toggle).
 * Default is dark, which is also the first paint before the effect runs.
 */
function useDarkUi(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document === 'undefined' ? true : !document.documentElement.classList.contains('light'),
  )
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(!root.classList.contains('light'))
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

/** Stable id for the picker. API ids are unique; name is only a fallback. */
function toRef(agent: AvatarAgentShape, index: number): AgentRobotRef {
  return {
    id: agent.id?.trim() || agent.name?.trim() || `agent-${index}`,
    name: agent.name,
    role: agent.role,
    parentId: agent.parentId ?? null,
  }
}

export function AgentAvatar({
  agent,
  agents,
  size = 1,
}: {
  agent: AvatarAgentShape
  /** Full roster this agent belongs to. Needed for "past 12 → parent's robot". */
  agents?: readonly AvatarAgentShape[]
  size?: number
}) {
  const dark = useDarkUi()
  const list = (agents && agents.length > 0 ? agents : [agent]).map(toRef)
  const self = toRef(agent, 0)
  // If the caller passed a list that doesn't include this agent (a detail
  // view opened by id), still draw them — just without overflow numbering.
  const faces = robotFaces(list.some((a) => a.id === self.id) ? list : [self, ...list])
  const face = faces.get(self.id) ?? { slot: slotForAgent(self), childNumber: null }
  const spec = ROSTER[face.slot]
  const px = avatarPx(size, face.childNumber != null)
  const name = agent.name?.trim() || 'agent'
  const parent = face.childNumber != null
    ? list.find((a) => a.id === (agent.parentId ?? ''))
    : undefined
  const parentName = parent?.name?.trim()
  // The SVG's own <title> is the accessible name. The badge is aria-hidden
  // so the number isn't read twice.
  const label = face.childNumber != null
    ? `${name}, child ${face.childNumber}${parentName ? ` of ${parentName}` : ''} — ${spec.role} robot`
    : `${name} — ${spec.role} robot`
  const status = robotStatus(agent.status)
  // Badge diameter tracks the robot so a 22px copy still gets a readable digit.
  const badge = Math.max(14, Math.round(px * 0.4))

  return (
    <span className="relative inline-flex shrink-0" style={{ width: px, height: px }}>
      {/* halo defaults on inside RobotAvatar; we pass it explicitly so light
          mode can turn the sticker off. tile stays off — the dark UI uses the
          halo, not the tinted card (tile is the ≤32px list-row option). */}
      <RobotAvatar
        slot={face.slot}
        size={px}
        status={status}
        halo={dark}
        tile={false}
        title={label}
      />
      {face.childNumber != null && (
        <span
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center rounded-full font-bold"
          style={{
            top: -2,
            right: -2,
            minWidth: badge,
            height: badge,
            padding: '0 2px',
            fontSize: Math.max(9, Math.round(badge * 0.62)),
            lineHeight: 1,
            // The robot's own color, inked like the roster sheet (near-black
            // digit, dark sticker edge) so it reads on both card surfaces.
            background: spec.color,
            color: '#0b0b10',
            border: '2px solid #0b0b10',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.35)',
          } as CSSProperties}
        >
          {face.childNumber}
        </span>
      )}
    </span>
  )
}
