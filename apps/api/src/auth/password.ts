import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { bindHost, isLoopbackHost } from './write-token';

/** Installer and API share these scrypt parameters. */
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEY_LEN = 32;

const MAX_N = 262144;
export const MAX_PASSWORD = 1024;

/**
 * Stored form: scrypt:N:r:p:saltHex:keyHex
 * Colons stay inside the value so a shell can source .env without expanding $.
 */
export function hashPassword(
  password: string,
  salt: Buffer = randomBytes(16),
): string {
  const key = scryptSync(password, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('hex'),
    key.toString('hex'),
  ].join(':');
}

export function configuredPasswordHash(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.DASHBOARD_PASSWORD_HASH;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

export function configuredSessionSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.SESSION_SECRET;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** True when `password` matches the stored scrypt hash. A bad hash is false. */
export function passwordMatches(password: string, stored: string): boolean {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (password.length > MAX_PASSWORD) return false;
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || n < 2 || n > MAX_N || (n & (n - 1)) !== 0) {
    return false;
  }
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 8) return false;
  if (!/^[0-9a-f]+$/i.test(parts[4]) || !/^[0-9a-f]+$/i.test(parts[5])) {
    return false;
  }
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length < 8 || salt.length > 64) return false;
  if (expected.length < 16 || expected.length > 64) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}

export const DASHBOARD_BIND_WARNING =
  'WARNING: DASHBOARD_PASSWORD_HASH is not set. The dashboard is open while the API listens on loopback only. Set a password before you expose this API.';

function dashboardRefuseMessage(host: string, missing: string): string {
  return (
    `Refusing to start. The API is bound to ${host}, which is not a loopback address, and ${missing} is not set. ` +
    'Run bash install.sh so it can write DASHBOARD_PASSWORD_HASH and SESSION_SECRET, or set both in .env, then start again.'
  );
}

export type DashboardBindDecision =
  | { action: 'allow' }
  | { action: 'warn'; message: string }
  | { action: 'refuse'; message: string };

/**
 * Compose sets HOST to 0.0.0.0 inside the container, so a password is required
 * there. Loopback with no password stays open.
 */
export function evaluateDashboardBind(
  env: NodeJS.ProcessEnv = process.env,
): DashboardBindDecision {
  const host = bindHost(env);
  const hash = configuredPasswordHash(env);
  const secret = configuredSessionSecret(env);
  if (isLoopbackHost(host)) {
    if (!hash) return { action: 'warn', message: DASHBOARD_BIND_WARNING };
    return { action: 'allow' };
  }
  if (!hash) {
    return {
      action: 'refuse',
      message: dashboardRefuseMessage(host, 'DASHBOARD_PASSWORD_HASH'),
    };
  }
  if (!secret) {
    return {
      action: 'refuse',
      message: dashboardRefuseMessage(host, 'SESSION_SECRET'),
    };
  }
  return { action: 'allow' };
}
