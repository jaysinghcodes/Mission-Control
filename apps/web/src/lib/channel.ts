/**
 * Chat link for an agent. A link renders only when the operator's own
 * data supplies one. No server id is shipped in this repo.
 */

export const DISCORD_GUILD: string = String(import.meta.env.VITE_DISCORD_GUILD_ID ?? '').trim()

const SNOWFLAKE = /^\d{17,21}$/

/**
 * 1. `channel` as a full http(s) URL, kept as is.
 * 2. `channel` as a Discord snowflake, expanded only when
 *    VITE_DISCORD_GUILD_ID is set.
 * 3. Anything else is null. Callers hide the link.
 *
 * `_name` stays so older call sites still compile. It is not used.
 */
export function channelHref(channel: string | null | undefined, _name?: string | null): string | null {
  const v = (channel ?? '').trim()
  if (/^https?:\/\//i.test(v)) return v
  if (SNOWFLAKE.test(v) && DISCORD_GUILD) return `https://discord.com/channels/${DISCORD_GUILD}/${v}`
  return null
}
