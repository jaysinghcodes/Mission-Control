/**
 * Failed dashboard logins, per client IP.
 *
 * Defaults: 5 failures inside 60 seconds, then a wait of 60 seconds.
 * Each later lockout doubles until 15 minutes. Loopback never calls this.
 * The counters live in memory. A restart clears them. So does
 * npm run login:reset, which calls POST /auth/login-reset on loopback.
 */

export const DEFAULT_LOGIN_FAIL_LIMIT = 5;
export const DEFAULT_LOGIN_WINDOW_SECONDS = 60;
export const DEFAULT_LOGIN_BACKOFF_MAX_SECONDS = 15 * 60;

/** Shown on the sign in page and returned as the 429 message. */
export const LOGIN_LIMIT_MESSAGE =
  'Too many tries. Try again in a minute. npm run login:reset clears the lock.';

export interface LoginLimitConfig {
  limit: number;
  windowSeconds: number;
  maxBackoffSeconds: number;
}

export interface LoginBlock {
  retryAfter: number;
}

interface Bucket {
  failures: number[];
  lockedUntil: number;
  nextWaitSeconds: number;
}

const buckets = new Map<string, Bucket>();
let nowFn = (): number => Date.now();

export function setLoginClock(fn: () => number): void {
  nowFn = fn;
}

export function resetLoginLimits(): void {
  buckets.clear();
  nowFn = () => Date.now();
}

export function loginLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): LoginLimitConfig {
  return {
    limit: positiveInt(env.LOGIN_FAIL_LIMIT, DEFAULT_LOGIN_FAIL_LIMIT, 100),
    windowSeconds: positiveInt(
      env.LOGIN_WINDOW_SECONDS,
      DEFAULT_LOGIN_WINDOW_SECONDS,
      24 * 60 * 60,
    ),
    maxBackoffSeconds: positiveInt(
      env.LOGIN_BACKOFF_MAX_SECONDS,
      DEFAULT_LOGIN_BACKOFF_MAX_SECONDS,
      24 * 60 * 60,
    ),
  };
}

/** Null when this IP may try. retryAfter is whole seconds for Retry-After. */
export function loginBlock(ip: string, now = nowFn()): LoginBlock | null {
  const bucket = buckets.get(ip);
  if (!bucket || bucket.lockedUntil <= now) return null;
  return {
    retryAfter: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000)),
  };
}

export function recordLoginFailure(
  ip: string,
  env: NodeJS.ProcessEnv = process.env,
  now = nowFn(),
): void {
  const cfg = loginLimitConfig(env);
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = {
      failures: [],
      lockedUntil: 0,
      nextWaitSeconds: cfg.windowSeconds,
    };
    buckets.set(ip, bucket);
  }
  if (bucket.lockedUntil > now) return;
  const windowMs = cfg.windowSeconds * 1000;
  const floor = now - windowMs;
  bucket.failures = bucket.failures.filter((at) => at >= floor);
  bucket.failures.push(now);
  if (bucket.failures.length < cfg.limit) return;
  const wait = Math.min(bucket.nextWaitSeconds, cfg.maxBackoffSeconds);
  bucket.lockedUntil = now + wait * 1000;
  bucket.failures = [];
  bucket.nextWaitSeconds = Math.min(
    bucket.nextWaitSeconds * 2,
    cfg.maxBackoffSeconds,
  );
}

export function recordLoginSuccess(ip: string): void {
  buckets.delete(ip);
}

function positiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > max) return fallback;
  return n;
}
