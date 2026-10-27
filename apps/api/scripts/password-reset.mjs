/**
 * Set a new dashboard password and revoke every session.
 *
 * Writes the scrypt hash straight to the session file. There is no HTTP route.
 * Native: npm run password:reset
 * Compose: docker compose exec api npm run password:reset
 *
 * MC_INSTALL_MODE=compose means this checkout is Compose. The host command
 * runs only inside the api container. It does not write a host file.
 *
 * With no marker, a Compose install made before the marker existed must not
 * get a host write that the api never reads. The command asks Docker for
 * this checkout's containers and its mc-auth volume. Either one, or a Docker
 * that cannot answer, refuses and asks for bash install.sh again. Only a
 * machine with no docker command, or a Docker that shows no Compose trace,
 * takes the native write.
 *
 * Exit 3 means the new hash may be saved but could not be read back, so the
 * old password may no longer work. The host relays that from the container.
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
const LEGACY_REFUSE =
  'This install has no install mode in .env, so the password was not reset. Run bash install.sh again to record it, then run npm run password:reset again.';
const DOCKER_SILENT_REFUSE =
  'This install has no install mode in .env and Docker did not answer, so the password was not reset. Start Docker or run bash install.sh again to record it, then run npm run password:reset again.';
const UNCONFIRMED_EXIT = 3;
const DOCKER_TIMEOUT_MS = 20000;
const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const repoRoot = resolve(apiDir, '..');
const insideCompose = process.env.MC_COMPOSE === '1';

loadEnvFiles(apiDir, process.env);

const installMode = String(process.env.MC_INSTALL_MODE || '').trim();

if (insideCompose) {
  resetInPlace();
} else if (installMode === 'compose') {
  resetThroughCompose();
} else if (installMode === '') {
  const trace = composeTrace();
  if (trace === 'none') {
    resetInPlace();
  } else {
    console.error(trace === 'unknown' ? DOCKER_SILENT_REFUSE : LEGACY_REFUSE);
    process.exit(1);
  }
} else {
  resetInPlace();
}

/**
 * Compose trace for a checkout with no install marker.
 * 'none' means no docker command, or Docker answered and shows no container
 * and no mc-auth volume for this checkout. 'found' means one of those exists.
 * 'unknown' means docker is installed but could not answer.
 */
function composeTrace() {
  const config = docker(['compose', 'config', '--format', 'json']);
  if (config === null) return 'none';
  if (!config.ok) return 'unknown';
  let volume = '';
  try {
    const parsed = JSON.parse(config.stdout);
    const named = parsed?.volumes?.['mc-auth']?.name;
    if (typeof named === 'string' && named.trim() !== '') volume = named.trim();
    else if (typeof parsed?.name === 'string' && parsed.name.trim() !== '') {
      volume = `${parsed.name.trim()}_mc-auth`;
    }
  } catch {
    return 'unknown';
  }
  if (!volume) return 'unknown';
  const containers = docker(['compose', 'ps', '--all', '--quiet']);
  if (!containers || !containers.ok) return 'unknown';
  if (containers.stdout.trim() !== '') return 'found';
  const volumes = docker([
    'volume',
    'ls',
    '--quiet',
    '--filter',
    `name=^${volume}$`,
  ]);
  if (!volumes || !volumes.ok) return 'unknown';
  const names = volumes.stdout.split(/\s+/).filter(Boolean);
  return names.includes(volume) ? 'found' : 'none';
}

/** null when the docker command is not installed. */
function docker(args) {
  const result = spawnSync('docker', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
  });
  if (result.error && result.error.code === 'ENOENT') return null;
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || ''),
  };
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
    if (!result.error && result.status === UNCONFIRMED_EXIT) {
      console.error(unconfirmedMessage('npm run password:reset'));
      process.exit(UNCONFIRMED_EXIT);
    }
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
  let next;
  try {
    const before = readState(file);
    next =
      before.version >= UNREADABLE_VERSION
        ? before.version
        : before.version + 1;
    writeState(file, { version: next, passwordHash });
  } catch {
    console.error('Could not reset the dashboard password.');
    console.error('Could not write the session file.');
    if (!insideCompose) {
      console.error(
        'Under Compose: docker compose exec api npm run password:reset',
      );
    }
    process.exit(1);
  }
  const after = readState(file);
  if (after.passwordHash !== passwordHash || after.version !== next) {
    console.error(
      unconfirmedMessage(
        insideCompose
          ? 'docker compose exec api npm run password:reset'
          : 'npm run password:reset',
      ),
    );
    process.exit(UNCONFIRMED_EXIT);
  }
  console.log(`Dashboard password, shown once: ${password}`);
  console.log('Every session was revoked.');
}

/** The new hash may be saved, so the old password may no longer work. */
function unconfirmedMessage(command) {
  return `The new dashboard password could not be read back, so the password may have changed and the old one may no longer work. Run ${command} again to set a new one.`;
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
  chmodSync(tmp, 0o600);
  // The rename is the last step, so a throw above means nothing was saved.
  renameSync(tmp, file);
}
