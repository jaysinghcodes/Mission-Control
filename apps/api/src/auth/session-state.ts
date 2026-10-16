import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';
import { configuredPasswordHash } from './password';

/**
 * Session version on disk.
 *
 * Logout and a password change bump `version`. validSession rejects a
 * cookie whose `v` does not match, including after a restart. A changed
 * password hash in this file overrides DASHBOARD_PASSWORD_HASH on startup.
 */

export const DEFAULT_SESSION_VERSION = 1;

/** A broken file matches no cookie. Sessions stay closed until it is replaced. */
const UNREADABLE_VERSION = Number.MAX_SAFE_INTEGER;

export interface SessionState {
  version: number;
  passwordHash: string | null;
}

export function sessionStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SESSION_STATE_PATH;
  if (typeof raw === 'string' && raw.trim() !== '') return resolve(raw.trim());
  return resolve(apiDirFromHere(), 'data', 'session-state.json');
}

export function readSessionState(
  env: NodeJS.ProcessEnv = process.env,
): SessionState {
  const file = sessionStatePath(env);
  if (!existsSync(file)) {
    return { version: DEFAULT_SESSION_VERSION, passwordHash: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      version?: unknown;
      passwordHash?: unknown;
    };
    const version = parsed.version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > UNREADABLE_VERSION
    ) {
      return { version: UNREADABLE_VERSION, passwordHash: null };
    }
    const passwordHash =
      typeof parsed.passwordHash === 'string' &&
      parsed.passwordHash.trim() !== ''
        ? parsed.passwordHash.trim()
        : null;
    return { version, passwordHash };
  } catch {
    return { version: UNREADABLE_VERSION, passwordHash: null };
  }
}

export function writeSessionState(
  state: SessionState,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const file = sessionStatePath(env);
  mkdirSync(dirname(file), { recursive: true });
  const body: { version: number; passwordHash?: string } = {
    version: state.version,
  };
  if (state.passwordHash) body.passwordHash = state.passwordHash;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function currentSessionVersion(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return readSessionState(env).version;
}

/** Bump the version and keep a stored password hash. Old cookies stop working. */
export function revokeSessions(env: NodeJS.ProcessEnv = process.env): number {
  const state = readSessionState(env);
  const next =
    state.version >= UNREADABLE_VERSION ? state.version : state.version + 1;
  writeSessionState({ version: next, passwordHash: state.passwordHash }, env);
  return next;
}

/**
 * Store a new hash and bump the version in one write.
 * The running process and the next start both use this hash.
 */
export function changePasswordHash(
  hash: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const state = readSessionState(env);
  const next =
    state.version >= UNREADABLE_VERSION ? state.version : state.version + 1;
  writeSessionState({ version: next, passwordHash: hash }, env);
  env.DASHBOARD_PASSWORD_HASH = hash;
  return next;
}

/** File hash wins when a password change has been stored. */
export function effectivePasswordHash(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const stored = readSessionState(env).passwordHash;
  if (stored) return stored;
  return configuredPasswordHash(env);
}

/** Called from boot after .env is loaded. A stored hash replaces the env hash. */
export function applyStoredPassword(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const stored = readSessionState(env).passwordHash;
  if (stored) env.DASHBOARD_PASSWORD_HASH = stored;
}

function apiDirFromHere(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, 'prisma.config.ts'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (existsSync(resolve(process.cwd(), 'prisma.config.ts'))) {
    return process.cwd();
  }
  return process.cwd();
}
