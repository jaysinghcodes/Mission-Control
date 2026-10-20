import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passwordMatches } from './password';

const script = join(__dirname, '..', '..', 'scripts', 'password-reset.mjs');
const REFUSE =
  'Could not reset the dashboard password, so run docker compose up -d first and then npm run password:reset.';
const EXEC_ARGS = 'compose exec -T api npm run password:reset';
const LEGACY_REFUSE =
  'This install has no install mode in .env, so the password was not reset. Run bash install.sh again to record it, then run npm run password:reset again.';
const MAY_HAVE_CHANGED =
  'The new dashboard password could not be read back, so the password may have changed and the old one may no longer work.';

describe('password:reset command', () => {
  it('is wired from the api package and the repo root', () => {
    const apiPkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(apiPkg.scripts?.['password:reset']).toBe(
      'node scripts/password-reset.mjs',
    );
    const rootPkg = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', '..', 'package.json'),
        'utf8',
      ),
    ) as { scripts?: Record<string, string> };
    expect(rootPkg.scripts?.['password:reset']).toContain('password:reset');
  });

  it('does not call an HTTP route', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).not.toContain('/auth/password-reset');
    expect(source).not.toContain('node:http');
    expect(source).not.toContain('node:https');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    const controller = readFileSync(
      join(__dirname, 'auth.controller.ts'),
      'utf8',
    );
    expect(controller).not.toContain('password-reset');
    expect(controller).not.toContain('resetPassword');
  });

  it('prints the password only after the new hash is read back', () => {
    const source = readFileSync(script, 'utf8');
    const writeAt = source.indexOf('writeState(');
    const readAfter = source.indexOf('readState(', writeAt);
    const printAt = source.indexOf(
      'console.log(`Dashboard password, shown once:',
    );
    expect(writeAt).toBeGreaterThan(-1);
    expect(readAfter).toBeGreaterThan(writeAt);
    expect(printAt).toBeGreaterThan(readAfter);
    expect(source.indexOf('MC_COMPOSE')).toBeLessThan(
      source.indexOf('loadEnvFiles('),
    );
  });

  it('writes a new hash and prints the password once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-'));
    const file = join(dir, 'session-state.json');
    writeFileSync(file, `${JSON.stringify({ version: 4 })}\n`, { mode: 0o600 });
    try {
      const result = await runReset({
        SESSION_STATE_PATH: file,
        MC_COMPOSE: '1',
      });
      expect(result.status).toBe(0);
      const password = shownPassword(result.stdout);
      expect(password).not.toBe('');
      expect(result.stdout.split(password).length - 1).toBe(1);
      expect(result.stderr).not.toContain(password);
      expect(result.stdout).toContain('Every session was revoked.');
      const stored = JSON.parse(readFileSync(file, 'utf8')) as {
        version: number;
        passwordHash: string;
      };
      expect(stored.version).toBe(5);
      expect(passwordMatches(password, stored.passwordHash)).toBe(true);
      expect((readFileSync(file) as Buffer).includes(password)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not print a password when the session file cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-blocked-'));
    const blocker = join(dir, 'not-a-directory');
    writeFileSync(blocker, 'x');
    const target = join(blocker, 'session-state.json');
    try {
      const result = await runReset({
        SESSION_STATE_PATH: target,
        MC_COMPOSE: '1',
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('Dashboard password');
      expect(result.stdout).not.toContain('Every session was revoked.');
      expect(result.stderr).toContain('Could not write the session file.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses when the api container was removed and writes no host file', async () => {
    await expectComposeRefusal('removed');
  });

  it('refuses when compose is down and writes no host file', async () => {
    await expectComposeRefusal('down');
  });

  it('refuses when compose down -v removed the volume and writes no host file', async () => {
    await expectComposeRefusal('down-v');
  });

  it('refuses when Docker permission is denied and writes no host file', async () => {
    await expectComposeRefusal('denied');
  });

  it('refuses when DOCKER_HOST is dead and writes no host file', async () => {
    await expectComposeRefusal('dead-host');
  });

  it('refuses when compose exec exits 0 without a confirmed reset', async () => {
    await expectComposeRefusal('empty');
  });

  it('resets inside the api container after compose is up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-up-'));
    const hostTarget = join(dir, 'host-should-not-exist.json');
    const containerState = join(dir, 'container-session-state.json');
    writeFileSync(
      containerState,
      `${JSON.stringify({ version: 2, passwordHash: 'old' })}\n`,
      { mode: 0o600 },
    );
    const log = join(dir, 'docker-args.txt');
    const bin = dockerBin(dir, 'success');
    const fallback = join(__dirname, '..', '..', 'data', 'session-state.json');
    const before = existsSync(fallback) ? readFileSync(fallback) : null;
    try {
      const result = await runReset(
        {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          MC_INSTALL_MODE: 'compose',
          SESSION_STATE_PATH: hostTarget,
          DOCKER_ARGV_LOG: log,
          CONTAINER_STATE: containerState,
          RESET_SCRIPT: script,
          NODE_BIN: process.execPath,
        },
        script,
        ['MC_COMPOSE'],
      );
      expect(readFileSync(log, 'utf8').trim()).toBe(EXEC_ARGS);
      expect(result.status).toBe(0);
      const password = shownPassword(result.stdout);
      expect(password).not.toBe('');
      expect(result.stdout.split(password).length - 1).toBe(1);
      expect(result.stdout).toContain('Every session was revoked.');
      expect(existsSync(hostTarget)).toBe(false);
      const after = existsSync(fallback) ? readFileSync(fallback) : null;
      expect(after).toEqual(before);
      const stored = JSON.parse(readFileSync(containerState, 'utf8')) as {
        version: number;
        passwordHash: string;
      };
      expect(stored.version).toBe(3);
      expect(passwordMatches(password, stored.passwordHash)).toBe(true);
      expect(stored.passwordHash).not.toBe('old');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads MC_INSTALL_MODE=compose from .env and does not write a host file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-marker-'));
    const tree = join(dir, 'repo');
    const hostTarget = join(dir, 'host-should-not-exist.json');
    mkdirSync(join(tree, 'apps/api/scripts'), { recursive: true });
    mkdirSync(join(tree, 'apps/api/src'), { recursive: true });
    cpSync(script, join(tree, 'apps/api/scripts/password-reset.mjs'));
    cpSync(
      join(__dirname, '..', 'load-env.js'),
      join(tree, 'apps/api/src/load-env.js'),
    );
    writeFileSync(
      join(tree, '.env'),
      'MC_INSTALL_MODE=compose\nSESSION_STATE_PATH=' + hostTarget + '\n',
      { mode: 0o600 },
    );
    const log = join(dir, 'docker-args.txt');
    const bin = dockerBin(dir, 'down');
    try {
      const result = await runReset(
        {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          DOCKER_ARGV_LOG: log,
        },
        join(tree, 'apps/api/scripts/password-reset.mjs'),
        ['MC_INSTALL_MODE', 'MC_COMPOSE', 'SESSION_STATE_PATH'],
      );
      expect(result.status).not.toBe(0);
      expect(readFileSync(log, 'utf8').trim()).toBe(EXEC_ARGS);
      expect(result.stderr.trim()).toBe(REFUSE);
      expect(result.stdout).not.toContain('Dashboard password');
      expect(existsSync(hostTarget)).toBe(false);
      expect(existsSync(join(tree, 'apps/api/data/session-state.json'))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the native write with no marker when the docker command is missing', async () => {
    const tree = legacyTree('mc-pw-native-');
    const empty = join(tree.dir, 'empty-bin');
    mkdirSync(empty, { recursive: true });
    try {
      const result = await runReset({ PATH: empty }, tree.script, [
        'MC_INSTALL_MODE',
        'MC_COMPOSE',
        'SESSION_STATE_PATH',
      ]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const password = shownPassword(result.stdout);
      expect(password).not.toBe('');
      expect(result.stdout).toContain('Every session was revoked.');
      const stored = JSON.parse(readFileSync(tree.state, 'utf8')) as {
        version: number;
        passwordHash: string;
      };
      expect(passwordMatches(password, stored.passwordHash)).toBe(true);
    } finally {
      rmSync(tree.dir, { recursive: true, force: true });
    }
  });

  it('keeps the native write with no marker when Docker shows no Compose trace', async () => {
    const tree = legacyTree('mc-pw-native-docker-');
    const log = join(tree.dir, 'docker-args.txt');
    const bin = traceBin(tree.dir, 'none');
    try {
      const result = await runReset(
        { PATH: `${bin}:${process.env.PATH ?? ''}`, DOCKER_ARGV_LOG: log },
        tree.script,
        ['MC_INSTALL_MODE', 'MC_COMPOSE', 'SESSION_STATE_PATH', 'DOCKER_HOST'],
      );
      expect(result.status).toBe(0);
      const password = shownPassword(result.stdout);
      expect(password).not.toBe('');
      const stored = JSON.parse(readFileSync(tree.state, 'utf8')) as {
        passwordHash: string;
      };
      expect(passwordMatches(password, stored.passwordHash)).toBe(true);
      const calls = readFileSync(log, 'utf8');
      expect(calls).toContain('compose config --format json');
      expect(calls).toContain('compose ps --all --quiet');
      expect(calls).toContain('volume ls --quiet --filter name=^repo_mc-auth$');
      expect(calls).not.toContain('exec');
    } finally {
      rmSync(tree.dir, { recursive: true, force: true });
    }
  });

  it('refuses with no marker when this checkout has Compose containers', async () => {
    await expectLegacyRefusal('containers');
  });

  it('refuses with no marker when only the mc-auth volume is left', async () => {
    await expectLegacyRefusal('volume');
  });

  it('refuses with no marker when the Docker daemon cannot be reached', async () => {
    await expectLegacyRefusal('unreachable');
  });

  it('refuses with no marker when compose config fails', async () => {
    await expectLegacyRefusal('config-fails');
  });

  it('says the password may have changed when the read back fails inside the container', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-readback-'));
    const file = join(dir, 'session-state.json');
    writeFileSync(file, `${JSON.stringify({ version: 4 })}\n`, { mode: 0o600 });
    const preload = staleReadPreload(dir);
    try {
      const result = await runReset(
        {
          SESSION_STATE_PATH: file,
          MC_COMPOSE: '1',
          NODE_OPTIONS: `--import ${preload}`,
        },
        script,
      );
      expect(result.status).toBe(3);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(
        `${MAY_HAVE_CHANGED} Run docker compose exec api npm run password:reset again to set a new one.`,
      );
      expect(result.stderr).not.toContain('Under Compose');
      expect(result.stderr).not.toContain('Could not write the session file.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says the password may have changed when the native read back fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-readback-native-'));
    const file = join(dir, 'session-state.json');
    writeFileSync(file, `${JSON.stringify({ version: 4 })}\n`, { mode: 0o600 });
    const preload = staleReadPreload(dir);
    try {
      const result = await runReset(
        {
          SESSION_STATE_PATH: file,
          MC_INSTALL_MODE: 'native',
          NODE_OPTIONS: `--import ${preload}`,
        },
        script,
        ['MC_COMPOSE'],
      );
      expect(result.status).toBe(3);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(
        `${MAY_HAVE_CHANGED} Run npm run password:reset again to set a new one.`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('relays an unconfirmed container reset from the host without the up hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-relay-'));
    const target = join(dir, 'should-not-exist.json');
    const log = join(dir, 'docker-args.txt');
    const bin = dockerBin(dir, 'unconfirmed');
    try {
      const result = await runReset(
        {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          MC_INSTALL_MODE: 'compose',
          SESSION_STATE_PATH: target,
          DOCKER_ARGV_LOG: log,
        },
        script,
        ['MC_COMPOSE'],
      );
      expect(readFileSync(log, 'utf8').trim()).toBe(EXEC_ARGS);
      expect(result.status).toBe(3);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(
        `${MAY_HAVE_CHANGED} Run npm run password:reset again to set a new one.`,
      );
      expect(result.stderr).not.toContain('docker compose up -d');
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honors SESSION_STATE_PATH from .env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-env-'));
    const state = join(dir, 'from-dotenv.json');
    const tree = join(dir, 'repo');
    mkdirSync(join(tree, 'apps/api/scripts'), { recursive: true });
    mkdirSync(join(tree, 'apps/api/src'), { recursive: true });
    cpSync(script, join(tree, 'apps/api/scripts/password-reset.mjs'));
    cpSync(
      join(__dirname, '..', 'load-env.js'),
      join(tree, 'apps/api/src/load-env.js'),
    );
    writeFileSync(
      join(tree, '.env'),
      `MC_INSTALL_MODE=native\nSESSION_STATE_PATH=${state}\nINGEST_TOKEN=from-dotenv\n`,
      { mode: 0o600 },
    );
    try {
      const result = await runReset(
        {},
        join(tree, 'apps/api/scripts/password-reset.mjs'),
        ['SESSION_STATE_PATH', 'MC_COMPOSE', 'MC_INSTALL_MODE'],
      );
      expect(result.status).toBe(0);
      const password = shownPassword(result.stdout);
      expect(password).not.toBe('');
      expect(result.stdout.split(password).length - 1).toBe(1);
      const stored = JSON.parse(readFileSync(state, 'utf8')) as {
        version: number;
        passwordHash: string;
      };
      expect(passwordMatches(password, stored.passwordHash)).toBe(true);
      expect(existsSync(join(tree, 'apps/api/data/session-state.json'))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

async function expectComposeRefusal(mode: DockerMode): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), `mc-pw-${mode}-`));
  const target = join(dir, 'should-not-exist.json');
  const log = join(dir, 'docker-args.txt');
  const bin = dockerBin(dir, mode);
  const fallback = join(__dirname, '..', '..', 'data', 'session-state.json');
  const before = existsSync(fallback) ? readFileSync(fallback) : null;
  try {
    const result = await runReset(
      {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        MC_INSTALL_MODE: 'compose',
        SESSION_STATE_PATH: target,
        DOCKER_ARGV_LOG: log,
        DOCKER_HOST: mode === 'dead-host' ? 'tcp://127.0.0.1:1' : '',
      },
      script,
      ['MC_COMPOSE'],
    );
    expect(readFileSync(log, 'utf8').trim()).toBe(EXEC_ARGS);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Dashboard password');
    expect(result.stdout).not.toContain('Every session was revoked.');
    expect(result.stderr.trim()).toBe(REFUSE);
    expect(existsSync(target)).toBe(false);
    const after = existsSync(fallback) ? readFileSync(fallback) : null;
    expect(after).toEqual(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type DockerMode =
  | 'success'
  | 'removed'
  | 'down'
  | 'down-v'
  | 'denied'
  | 'dead-host'
  | 'empty'
  | 'unconfirmed';

type TraceMode =
  'none' | 'containers' | 'volume' | 'unreachable' | 'config-fails';

async function expectLegacyRefusal(mode: TraceMode): Promise<void> {
  const tree = legacyTree(`mc-pw-legacy-${mode}-`);
  const log = join(tree.dir, 'docker-args.txt');
  const bin = traceBin(tree.dir, mode);
  try {
    const result = await runReset(
      { PATH: `${bin}:${process.env.PATH ?? ''}`, DOCKER_ARGV_LOG: log },
      tree.script,
      ['MC_INSTALL_MODE', 'MC_COMPOSE', 'SESSION_STATE_PATH', 'DOCKER_HOST'],
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(LEGACY_REFUSE);
    expect(readFileSync(tree.state, 'utf8')).toBe(tree.original);
    expect(
      existsSync(join(tree.root, 'apps/api/data/session-state.json')),
    ).toBe(false);
    expect(readFileSync(log, 'utf8')).not.toContain('exec');
  } finally {
    rmSync(tree.dir, { recursive: true, force: true });
  }
}

/** A checkout copy at <tmp>/repo whose .env has no MC_INSTALL_MODE. */
function legacyTree(prefix: string): {
  dir: string;
  root: string;
  script: string;
  state: string;
  original: string;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const root = join(dir, 'repo');
  const state = join(dir, 'host-session-state.json');
  const original = `${JSON.stringify({ version: 7, passwordHash: 'old' })}\n`;
  mkdirSync(join(root, 'apps/api/scripts'), { recursive: true });
  mkdirSync(join(root, 'apps/api/src'), { recursive: true });
  cpSync(script, join(root, 'apps/api/scripts/password-reset.mjs'));
  cpSync(
    join(__dirname, '..', 'load-env.js'),
    join(root, 'apps/api/src/load-env.js'),
  );
  writeFileSync(join(root, '.env'), `SESSION_STATE_PATH=${state}\n`, {
    mode: 0o600,
  });
  writeFileSync(state, original, { mode: 0o600 });
  return {
    dir,
    root,
    script: join(root, 'apps/api/scripts/password-reset.mjs'),
    state,
    original,
  };
}

/** Docker that answers the no marker queries. exec always fails. */
function traceBin(dir: string, mode: TraceMode): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_ARGV_LOG"
mode='${mode}'
case "$*" in
  "compose config --format json")
    if [ "$mode" = "config-fails" ]; then
      echo 'invalid compose project' >&2
      exit 1
    fi
    printf '%s\\n' '{"name":"repo","volumes":{"mc-auth":{"name":"repo_mc-auth"}}}'
    exit 0
    ;;
  "compose ps --all --quiet")
    if [ "$mode" = "unreachable" ]; then
      echo 'Cannot connect to the Docker daemon' >&2
      exit 1
    fi
    if [ "$mode" = "containers" ]; then
      echo 3f2a1b0c9d8e
    fi
    exit 0
    ;;
  "volume ls --quiet --filter name=^repo_mc-auth$")
    if [ "$mode" = "volume" ]; then
      echo repo_mc-auth
    fi
    exit 0
    ;;
esac
echo "unexpected docker $*" >&2
exit 1
`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return bin;
}

/** Preload that makes the second read of SESSION_STATE_PATH return the old file. */
function staleReadPreload(dir: string): string {
  const file = join(dir, 'stale-read.mjs');
  writeFileSync(
    file,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const target = process.env.SESSION_STATE_PATH;
const original = fs.readFileSync;
let reads = 0;
fs.readFileSync = function (path, ...rest) {
  if (String(path) === target) {
    reads += 1;
    if (reads >= 2) return '{"version":4}\\n';
  }
  return original.call(this, path, ...rest);
};
syncBuiltinESMExports();
`,
  );
  return file;
}

function dockerBin(dir: string, mode: DockerMode): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_ARGV_LOG"
if [ "$1 $2 $3 $4 $5 $6 $7" != "compose exec -T api npm run password:reset" ]; then
  echo "unexpected docker $*" >&2
  exit 1
fi
mode='${mode}'
if [ "$mode" = "success" ]; then
  MC_COMPOSE=1 SESSION_STATE_PATH="$CONTAINER_STATE" exec "$NODE_BIN" "$RESET_SCRIPT"
fi
if [ "$mode" = "removed" ]; then
  echo 'service "api" is not running' >&2
  exit 1
fi
if [ "$mode" = "down" ]; then
  echo 'no such container' >&2
  exit 1
fi
if [ "$mode" = "down-v" ]; then
  echo 'no such container' >&2
  exit 1
fi
if [ "$mode" = "denied" ]; then
  echo 'permission denied while trying to connect to the Docker daemon socket' >&2
  exit 1
fi
if [ "$mode" = "dead-host" ]; then
  echo 'Cannot connect to the Docker daemon' >&2
  exit 1
fi
if [ "$mode" = "unconfirmed" ]; then
  echo 'The new dashboard password could not be read back, so the password may have changed and the old one may no longer work. Run docker compose exec api npm run password:reset again to set a new one.' >&2
  exit 3
fi
exit 0
`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return bin;
}

function shownPassword(stdout: string): string {
  const match = stdout.match(/^Dashboard password, shown once: (\S+)$/m);
  return match?.[1] ?? '';
}

function runReset(
  overrides: NodeJS.ProcessEnv,
  file = script,
  unset: string[] = [],
): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  for (const key of unset) delete env[key];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
