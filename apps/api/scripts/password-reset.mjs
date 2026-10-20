/**
 * Set a new dashboard password and revoke every session.
 *
 * Writes the scrypt hash straight to the session file. There is no HTTP route.
 * Native: npm run password:reset
 * Compose: docker compose exec api npm run password:reset
 *
 * MC_INSTALL_MODE=compose means this checkout is Compose. The host command
 * runs only inside the api container. It does not write a host file.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFiles } from '../src/load-env.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;
const UNREADABLE_VERSION = Number.MAX_SAFE_INTEGER;
const COMPOSE_REFUSE =
  'Could not reset the dashboard password, so run docker compose up -d first and then npm run password:reset.';
const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const repoRoot = resolve(apiDir, '..');
const insideCompose = process.env.MC_COMPOSE === '1';

loadEnvFiles(apiDir, process.env);

if (insideCompose) {
  resetInPlace();
} else if (String(process.env.MC_INSTALL_MODE || '').trim() === 'compose') {
  resetThroughCompose();
} else {
  resetInPlace();
}

function resetThroughCompose() {
  const result = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'api', 'npm', 'run', 'password:reset'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  const out = String(result.stdout || '');
  const confirmed =
    !result.error &&
    result.status === 0 &&
    /^Dashboard password, shown once: \S+$/m.test(out) &&
    out.includes('Every session was revoked.');
  if (!confirmed) {
    console.error(COMPOSE_REFUSE);
    process.exit(1);
  }
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(0);
}

function resetInPlace() {
  const password = randomBytes(18).toString('base64url');
  const passwordHash = hashPassword(password);
  const file = statePath();
  try {
    const before = readState(file);
    const next =
      before.version >= UNREADABLE_VERSION
        ? before.version
        : before.version + 1;
    writeState(file, { version: next, passwordHash });
    const after = readState(file);
    if (after.passwordHash !== passwordHash || after.version !== next) {
      throw new Error('unconfirmed');
    }
  } catch {
    console.error('Could not reset the dashboard password.');
    console.error('Could not write the session file.');
    console.error(
      'Under Compose: docker compose exec api npm run password:reset',
    );
    process.exit(1);
  }
  console.log(`Dashboard password, shown once: ${password}`);
  console.log('Every session was revoked.');
}

function statePath() {
  const raw = process.env.SESSION_STATE_PATH;
  if (typeof raw === 'string' && raw.trim() !== '') return resolve(raw.trim());
  return resolve(apiDir, 'data', 'session-state.json');
}

function hashPassword(value) {
  const salt = randomBytes(16);
  const key = scryptSync(value, salt, SCRYPT_KEY_LEN, {
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

function readState(file) {
  if (!existsSync(file)) return { version: 1, passwordHash: null };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
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

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const body = { version: state.version };
  if (state.passwordHash) body.passwordHash = state.passwordHash;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
