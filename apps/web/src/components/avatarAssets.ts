/**
 * Robot avatar assets + resolution — MC-211.
 *
 * Consumes Pixel's MC-210 deliverable (copied into apps/web/src/design/avatars/
 * so the app owns exactly the files it consumes):
 *   - sprites/*.svg        8 unique robot sprites (viewBox 0 0 48 48), one per
 *                          roster agent. State groups (.eyes / .eyes-error /
 *                          .eyes-offline / .tool-active / .error-badge) are
 *                          toggled purely by CSS attribute selectors on the
 *                          root (`data-state`) — see design/avatars/tokens.css.
 *   - role-avatar-map.json machine-readable role → avatar map (identity source
 *                          of truth, mirror of data/roster.ts identities).
 *   - tokens.css           frame/status/motion tokens (imported once in
 *                          main.tsx; reduced-motion safe).
 *
 * Sprite SVGs are imported as ?raw strings; the root <svg> tag is stripped so
 * AgentAvatar can render one controlled <svg class="mc-avatar"> whose
 * data-state / data-size / accent vars come from live agent data (React-owned
 * attributes, CSS drives every transition — no JS motion needed).
 */

import jarvis from '../design/avatars/sprites/jarvis.svg?raw'
import atlas from '../design/avatars/sprites/atlas.svg?raw'
import nova from '../design/avatars/sprites/nova.svg?raw'
import nox from '../design/avatars/sprites/nox.svg?raw'
import sage from '../design/avatars/sprites/sage.svg?raw'
import pixel from '../design/avatars/sprites/pixel.svg?raw'
import scribe from '../design/avatars/sprites/scribe.svg?raw'
import sentinel from '../design/avatars/sprites/sentinel.svg?raw'
import avatarMapRaw from '../design/avatars/role-avatar-map.json?raw'

/** Parsed shape of role-avatar-map.json (fields the app consumes). */
interface AvatarMapAgent {
  key: string
  name: string
  role: string
  roleKey: string
  archetype: string
  accent: string
  accentDeep: string
  sprite: string
  emoji?: string
}
interface AvatarMap {
  version: number
  agents: AvatarMapAgent[]
  fallback: {
    roleKeywords: Record<string, string>
    archetypeDefaults: Record<string, { accent: string; accentDeep: string; emoji: string; sprite: string }>
    defaultArchetype: string
  }
}

/** Single source of truth for avatar identity (parsed once at module load). */
const AVATAR_MAP: AvatarMap = JSON.parse(avatarMapRaw) as AvatarMap

/** Raw sprite source keyed by file name (map `sprite` field → raw string). */
const SPRITE_RAW: Record<string, string> = {
  'jarvis.svg': jarvis,
  'atlas.svg': atlas,
  'nova.svg': nova,
  'nox.svg': nox,
  'sage.svg': sage,
  'pixel.svg': pixel,
  'scribe.svg': scribe,
  'sentinel.svg': sentinel,
}

/** Strip the root <svg …> wrapper so the body can live under a React-owned svg. */
const stripSvgRoot = (raw: string): string =>
  raw.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

/** Inner markup per sprite file — parse once, reuse across renders. */
const SPRITE_BODY: Record<string, string> = Object.fromEntries(
  Object.entries(SPRITE_RAW).map(([file, raw]) => [file, stripSvgRoot(raw)]),
)

/** Avatar frame sizes live in tokens.css (data-size → sm 32 / md 44 / lg 64). */
export type AvatarSize = 'sm' | 'md' | 'lg'
export type AvatarState = 'idle' | 'working' | 'error' | 'offline'

export interface ResolvedAvatar {
  /** Sprite file name (key into SPRITE_BODY), e.g. "nova.svg". */
  sprite: string
  /** Accent color for --avatar-accent (identity hue). */
  accent: string
  /** Deep accent for --avatar-accent-deep (shadows/armature). */
  accentDeep: string
  /** Archetype name (commander/strategist/welder/…). */
  archetype: string
  /** Emoji fallback for cramped rows — empty when not applicable. */
  emoji: string
}

/** Lowercase + collapse separators (same normalization as data/roster.ts). */
const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/* -------------------------------------------------------------------------- */
/* Fallback identity — cloned instances render their own agents               */
/* -------------------------------------------------------------------------- */

/** FNV-1a hash — deterministic per name (MC-210 spec, works on both themes). */
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Stable tint for unknown agents: hue from the name hash, theme-proof. */
const hashHue = (name: string): number => fnv1a(name) % 360
const hashAccent = (name: string): string => `hsl(${hashHue(name)} 70% 62%)`
const hashAccentDeep = (name: string): string => `hsl(${hashHue(name)} 55% 32%)`

/**
 * Resolve an agent's avatar from its API `name` + `role`.
 *
 * Priority (mirrors data/roster.ts identity seeding):
 *  1. Exact roster match — one of the 8 map entries, by roleKey (lane is the
 *     stable identity the bridge pushes) or by name (roster display name, e.g. Atlas/Nova).
 *  2. Fallback archetype — role keyword regex (dev|build|eng → welder, …)
 *     picks the archetype's sprite; the sprite is tinted with a deterministic
 *     color derived from the agent's name hash (each cloned agent gets a
 *     distinct, stable identity).
 *  3. No name at all → default archetype (commander) with its stock colors.
 *
 * Never throws, never returns null — an unknown agent always resolves.
 */
export function resolveAvatar(name: string | null | undefined, role: string | null | undefined): ResolvedAvatar {
  const n = norm(name)
  const r = norm(role)
  for (const a of AVATAR_MAP.agents) {
    const rk = norm(a.roleKey)
    const nm = norm(a.name)
    const roleMatch = r !== '' && rk !== '' && (r === rk || r.includes(rk) || rk.includes(r))
    const nameMatch = n !== '' && nm !== '' && (n === nm || n.includes(nm) || nm.includes(n))
    if (roleMatch || nameMatch) {
      return { sprite: a.sprite, accent: a.accent, accentDeep: a.accentDeep, archetype: a.archetype, emoji: a.emoji ?? '' }
    }
  }
  const { roleKeywords, archetypeDefaults, defaultArchetype } = AVATAR_MAP.fallback
  let archetype = defaultArchetype
  if (r !== '') {
    for (const [arch, pattern] of Object.entries(roleKeywords)) {
      if (new RegExp(pattern, 'i').test(r)) {
        archetype = arch
        break
      }
    }
  }
  const def = archetypeDefaults[archetype] ?? archetypeDefaults[defaultArchetype]
  if (n === '') {
    return { sprite: def.sprite, accent: def.accent, accentDeep: def.accentDeep, archetype, emoji: def.emoji }
  }
  return { sprite: def.sprite, accent: hashAccent(name!), accentDeep: hashAccentDeep(name!), archetype, emoji: def.emoji }
}

/**
 * Map a live agent status string to an avatar data-state (MC-210 spec).
 * Defensive: anything outside working|idle|error|offline renders `offline`
 * rather than crashing or inventing a state.
 */
export function stateFor(status: string | null | undefined): AvatarState {
  const s = norm(status)
  if (s === 'working' || s === 'active' || s === 'busy') return 'working'
  if (s === 'idle') return 'idle'
  if (s === 'error' || s === 'failed' || s === 'failure' || s === 'fault') return 'error'
  return 'offline'
}

/** Sprite inner markup for the resolved sprite file — always present for the 8. */
export function spriteBodyFor(spriteFile: string): string | null {
  return SPRITE_BODY[spriteFile] ?? null
}
