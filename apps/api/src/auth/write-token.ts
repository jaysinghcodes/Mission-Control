import { timingSafeEqual } from 'crypto';

/**
 * Shared write token.
 *
 * INGEST_TOKEN is the one secret for every mutating route, including
 * POST /events. Callers send it as x-ingest-token. Reads do not use it.
 *
 * A blank or whitespace-only value counts as unset so a fresh clone that
 * clears the placeholder still gets the loopback path.
 */
export function configuredWriteToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.INGEST_TOKEN;
  if (typeof raw !== 'string') return null;
  if (raw.trim() === '') return null;
  return raw;
}

/** True when `provided` equals `expected`. Length mismatches stay 401. */
export function tokensMatch(
  provided: string | undefined,
  expected: string,
): boolean {
  if (typeof provided !== 'string') return false;
  const got = Buffer.from(provided);
  const want = Buffer.from(expected);
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(got, want);
}

/**
 * Host the API will bind. Matches the listen call in main.ts: an unset
 * HOST is loopback, not every interface.
 */
export function bindHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HOST;
  if (typeof raw !== 'string') return '127.0.0.1';
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : '127.0.0.1';
}

/** 127.0.0.0/8, localhost, and ::1. 0.0.0.0 and :: are not loopback. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === 'localhost' || bare === '::1') return true;
  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return false;
  return nums[0] === 127;
}

export const WRITE_AUTH_WARNING =
  'WARNING: INGEST_TOKEN is not set. Write routes are unauthenticated while the API listens on loopback only. Set INGEST_TOKEN before you expose this API.';

/** One plain startup line when production has no token and still listens on loopback. */
export const PRODUCTION_NO_TOKEN_LINE =
  'INGEST_TOKEN is not set. NODE_ENV is production, so every write route returns 401 until you set INGEST_TOKEN. Example: INGEST_TOKEN=$(openssl rand -hex 24)';

export function refuseMessage(host: string): string {
  return (
    `Refusing to start. The API is bound to ${host}, which is not a loopback address, and INGEST_TOKEN is not set. ` +
    'Set INGEST_TOKEN to a long random string, then start again. Example: INGEST_TOKEN=$(openssl rand -hex 24)'
  );
}

export type WriteBindDecision =
  | { action: 'allow' }
  | { action: 'warn'; message: string }
  | { action: 'log'; message: string }
  | { action: 'refuse'; message: string };

/**
 * What main.ts should do before it listens.
 *
 * No token off loopback refuses to start. No token on loopback warns and
 * stays open, except NODE_ENV=production, which still starts and logs how
 * to set the token. Writes then fail closed.
 */
export function evaluateWriteBind(
  env: NodeJS.ProcessEnv = process.env,
): WriteBindDecision {
  const host = bindHost(env);
  const token = configuredWriteToken(env);
  if (!token && !isLoopbackHost(host)) {
    return { action: 'refuse', message: refuseMessage(host) };
  }
  if (!token && env.NODE_ENV === 'production') {
    return { action: 'log', message: PRODUCTION_NO_TOKEN_LINE };
  }
  if (!token) return { action: 'warn', message: WRITE_AUTH_WARNING };
  return { action: 'allow' };
}
