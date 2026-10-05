/**
 * config.ts — build-time, display-only settings for the web app.
 *
 * Ticket 3 (OSS reposition): the UI used to hardcode the original author's
 * name ("Good evening, Jay", a "J" avatar, "Give Jarvis a task…"). A fresh
 * clone must not ship anyone's personal names, so the operator's name now
 * comes from configuration:
 *
 *   VITE_OPERATOR_NAME=Ada   → "Good evening, Ada", "A" avatar
 *   unset / blank            → neutral "Good evening", generic avatar
 *
 * Vite inlines VITE_* vars at BUILD time:
 *   - `npm run dev`: set VITE_OPERATOR_NAME in the root .env (exported with
 *     `set -a; . ./.env`) or in apps/web/.env.
 *   - Docker: compose passes the root OPERATOR_NAME as the
 *     VITE_OPERATOR_NAME build arg (rebuild the web image after changing it).
 *
 * Display only — never a secret, never used for auth.
 */

/** The configured operator name, trimmed; '' when not configured. */
export const OPERATOR_NAME: string = String(import.meta.env.VITE_OPERATOR_NAME ?? '').trim().slice(0, 80)

/**
 * The name the API stamps on tickets/runs created without an explicit
 * assignee. Mirrors apps/api/src/config/operator.ts: OPERATOR_NAME, or the
 * neutral "Operator" fallback. Used to recognise "my" runs in the UI.
 */
export const OPERATOR_ASSIGNEE: string = OPERATOR_NAME || 'Operator'

/**
 * Time-of-day greeting, optionally personalised.
 *   greeting(new Date('…T09:00'), 'Ada') → "Good morning, Ada"
 *   greeting(new Date('…T20:00'), '')    → "Good evening"
 * Uses the browser's local clock (it's the operator's day that matters).
 */
export function greeting(now: Date = new Date(), name: string = OPERATOR_NAME): string {
  const h = now.getHours()
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  return name ? `Good ${part}, ${name}` : `Good ${part}`
}

/** Avatar initial for the topbar account button; null → render a generic glyph. */
export function operatorInitial(name: string = OPERATOR_NAME): string | null {
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : null
}
