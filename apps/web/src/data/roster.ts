/**
 * Approved roster identity map — MC-201 (docs/p0-tickets.md, Epic MC-A).
 *
 * Built-in "Meet the Team" identities: roster agents get friendly names and
 * role labels instead of process-y lane names. This file is the DISPLAY
 * layer only — it never decides *who* is on the team (that always comes from
 * GET /agents), it only decides how an agent's name/role reads on the Team
 * page. Matches are defensive (case/separator-insensitive) so whatever the
 * bridge pushes — `role: "development"`, `role: "Dev"`, name "Nova", … —
 * resolves to the same card identity.
 *
 * Roster (locked):
 *   Lead     → Chief of Staff (root agent; was a personal agent name — ticket 3)
 *   Atlas    → Scrum Master   (scrummaster)
 *   Nova     → Development    (development)
 *   Nox      → QA             (qa)
 *   Sage     → Research       (research)
 *   Pixel    → Design         (design)
 *   Scribe   → Summary        (summary)
 *   Sentinel → Alerts         (alerts)
 *
 * MC-211 will consume the same identities when it wires Pixel's robot
 * avatars. MC-202 adds the channel deep-link helper below.
 */

export interface RosterIdentity {
  /** Human-facing display name (Lead, Atlas, Nova, …). */
  name: string
  /** Human-facing role label (Chief of Staff, Scrum Master, Development, …). */
  role: string
}

interface RosterEntry extends RosterIdentity {
  /** Lane keys matched against the normalized agent role. */
  roleKeys: string[]
  /** Roster names matched against the normalized agent name. */
  nameKeys: string[]
}

export const ROSTER: RosterEntry[] = [
  {
    // Neutral display name for the root agent. Only shown when the API name
    // is generic (e.g. OpenClaw's default agent "main"); a real name pushed
    // by the bridge always wins (see rosterDisplayName). Ticket 3 replaced a
    // personal agent name here and dropped its name-match key — the role
    // keys below already match any chief-of-staff/main agent. nameKeys stays
    // EMPTY on purpose: a substring key like 'lead' would mis-tag agents such
    // as "Lead Designer" as Chief of Staff.
    name: 'Lead', role: 'Chief of Staff',
    roleKeys: ['chief of staff', 'chief-of-staff', 'main agent', 'operator', 'main'],
    nameKeys: [],
  },
  {
    name: 'Atlas', role: 'Scrum Master',
    roleKeys: ['scrum master', 'scrummaster', 'scrum-master'],
    nameKeys: ['atlas'],
  },
  {
    name: 'Nova', role: 'Development',
    roleKeys: ['development', 'developer', 'dev'],
    nameKeys: ['nova'],
  },
  {
    name: 'Nox', role: 'QA',
    roleKeys: ['qa', 'quality assurance'],
    nameKeys: ['nox'],
  },
  {
    name: 'Sage', role: 'Research',
    roleKeys: ['research', 'researcher'],
    nameKeys: ['sage'],
  },
  {
    name: 'Pixel', role: 'Design',
    roleKeys: ['design', 'designer'],
    nameKeys: ['pixel'],
  },
  {
    name: 'Scribe', role: 'Summary',
    roleKeys: ['summary', 'summarizer', 'scribe'],
    nameKeys: ['scribe'],
  },
  {
    name: 'Sentinel', role: 'Alerts',
    roleKeys: ['alerts', 'alert', 'watchtower', 'sentinel'],
    nameKeys: ['sentinel'],
  },
]

/** Lowercase + collapse separators so matching is punctuation-insensitive. */
const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** True when the API name is a generic placeholder (spawned sub-agent etc.). */
const isGenericName = (name: string | null | undefined): boolean => {
  const n = norm(name)
  if (!n) return true
  return n === 'main' || n.startsWith('subagent') || n.startsWith('sub agent') || /^agent\b/.test(n)
}

/**
 * Resolve an agent's roster identity from its API `name` + `role`.
 * Returns null when the agent is not one of the approved roster members —
 * callers then render the raw API name/role (shape-tolerant, never guessed).
 */
export function rosterIdentity(name: string | null | undefined, role: string | null | undefined): RosterIdentity | null {
  const n = norm(name)
  const r = norm(role)
  for (const entry of ROSTER) {
    // Role keys take precedence (lane is the stable identity the bridge pushes),
    // then the roster name — but never match against a generic spawn name.
    if (entry.roleKeys.some((k) => r === norm(k) || r.includes(norm(k)))) {
      return { name: entry.name, role: entry.role }
    }
    if (!isGenericName(n) && entry.nameKeys.some((k) => n === norm(k) || n.includes(norm(k)))) {
      return { name: entry.name, role: entry.role }
    }
  }
  return null
}

/**
 * Human-facing display for a roster card: identity name when the API name is
 * generic (e.g. "Subagent · 94ce5523" in the development lane), otherwise the
 * agent's real API name (a named root agent keeps its full name). Role label always
 * comes from the identity when matched; callers fall back to `role ?? 'agent'`
 * when there is no match (MC-201 acceptance: role title fallback "agent").
 */
export function rosterDisplayName(name: string | null | undefined, role: string | null | undefined): string {
  const identity = rosterIdentity(name, role)
  if (!identity) return name?.trim() || 'agent'
  return isGenericName(name) ? identity.name : name!.trim()
}

/* ------------------------------------------------------------------ */
/* MC-202 — per-agent chat-channel deep link                           */
/* ------------------------------------------------------------------ */

/*
 * Ticket 3 (OSS reposition): this section used to hardcode one private
 * Discord server's guild id plus a name → channel-snowflake fallback map, so
 * every fresh clone rendered "Open channel" buttons deep-linking into the
 * original author's server. Both are gone. A link now renders ONLY when the
 * operator's own data supplies one:
 *   - the bridge pushes `agent.channel` as a full URL (any chat app), or
 *   - the bridge pushes a bare Discord channel id AND the operator configured
 *     their own server via VITE_DISCORD_GUILD_ID (build-time, optional).
 * No configuration → no link (the drawer hides its footer). Never guessed.
 */

/**
 * Operator's Discord server (guild) id, used only to expand a bare channel
 * snowflake from the bridge into a canonical
 * `https://discord.com/channels/<guild>/<channel>` URL. Optional and empty by
 * default; set VITE_DISCORD_GUILD_ID at build time to enable.
 */
export const DISCORD_GUILD: string = String(import.meta.env.VITE_DISCORD_GUILD_ID ?? '').trim()

/** Discord snowflakes are 17–21 digit integers. */
const SNOWFLAKE = /^\d{17,21}$/

/**
 * Resolve an agent's chat-channel URL, or null when the agent has no
 * reachable channel.
 *
 * Priority:
 *  1. `channel` as a full http(s) URL — the bridge's source of truth, kept
 *     as-is (works for Discord, Slack, Matrix, …).
 *  2. `channel` as a bare Discord snowflake — expanded ONLY when the operator
 *     configured DISCORD_GUILD (VITE_DISCORD_GUILD_ID); otherwise hidden.
 *  3. Anything else (absent, `<#id>` mentions, junk) → null: callers HIDE the
 *     link — never a dead link, never a URL guessed from a name.
 *
 * `_name` is kept for call-site compatibility (it used to key the removed
 * static fallback map) and is intentionally unused.
 */
export function channelHref(channel: string | null | undefined, _name?: string | null): string | null {
  const v = (channel ?? '').trim()
  if (/^https?:\/\//i.test(v)) return v // full canonical URL from the bridge
  if (SNOWFLAKE.test(v) && DISCORD_GUILD) return `https://discord.com/channels/${DISCORD_GUILD}/${v}`
  return null
}
