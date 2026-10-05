/**
 * operator.ts — who "the operator" is on this Mission Control install.
 *
 * Why this exists (ticket 3, OSS reposition): the API used to hardcode the
 * original author's personal agent name as the default assignee for
 * new tickets and runs. A cold clone must not ship anyone's personal names,
 * so the default now comes from configuration:
 *
 *   OPERATOR_NAME=Ada        → new tickets/runs default to "Ada"
 *   OPERATOR_NAME unset/blank → neutral fallback "Operator"
 *
 * This is a DISPLAY value only — it is not a secret and is never used for
 * auth, permissions, or routing. Docker: compose passes the root .env value
 * into the api container (docker-compose.yml → api.environment).
 */

/** Neutral fallback used when OPERATOR_NAME is not configured. */
export const DEFAULT_OPERATOR_NAME = 'Operator';

/**
 * Resolve the operator's display name from the environment.
 *
 * Read lazily (on every call, not at import time) so tests and long-running
 * processes see the current env, and a blank value (`OPERATOR_NAME=` copied
 * straight from .env.example) still falls back instead of producing an
 * empty assignee string.
 *
 * @param env — injectable for tests; defaults to `process.env`.
 */
export function operatorName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OPERATOR_NAME?.trim();
  // Clamp absurd values so a pasted paragraph can't blow up every card.
  return raw ? raw.slice(0, 80) : DEFAULT_OPERATOR_NAME;
}
