/**
 * config.ts — build-time, display-only settings for the web app.
 *
 * Ticket 3 (OSS reposition): the UI used to hardcode the original author's
 * name. A fresh clone must not ship anyone's personal names, so the
 * operator's name now comes from configuration (VITE_OPERATOR_NAME). Unset
 * or blank falls back to the neutral "Operator".
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
