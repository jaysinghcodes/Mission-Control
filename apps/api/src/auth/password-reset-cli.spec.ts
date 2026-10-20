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

  it('refuses when a Compose api container exists in any state and writes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-docker-'));
    const target = join(dir, 'should-not-exist.json');
    const bin = dockerBin(dir, { services: 'api', volume: '' });
    const fallback = join(__dirname, '..', '..', 'data', 'session-state.json');
    const before = existsSync(fallback) ? readFileSync(fallback) : null;
    try {
      const result = await runReset({
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SESSION_STATE_PATH: target,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('Dashboard password');
      expect(result.stderr).toContain(
        'Could not reset the dashboard password.',
      );
      expect(result.stderr).toContain(
        'This checkout has a Compose API. A reset on the host does not change the password that API reads.',
      );
      expect(result.stderr).toContain('Run docker compose start api');
      expect(result.stderr).toContain(
        'Then run docker compose exec api npm run password:reset',
      );
      expect(existsSync(target)).toBe(false);
      const after = existsSync(fallback) ? readFileSync(fallback) : null;
      expect(after).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses when compose is down but the mc-auth volume still exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-volume-'));
    const target = join(dir, 'should-not-exist.json');
    const bin = dockerBin(dir, { services: '', volume: 'proj_mc-auth' });
    try {
      const result = await runReset({
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SESSION_STATE_PATH: target,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('Dashboard password');
      expect(result.stderr).toContain('Run docker compose start api');
      expect(result.stderr).toContain(
        'Then run docker compose exec api npm run password:reset',
      );
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
      `SESSION_STATE_PATH=${state}\nINGEST_TOKEN=from-dotenv\n`,
      { mode: 0o600 },
    );
    const bin = dockerBin(dir, { services: '', volume: '' });
    try {
      const result = await runReset(
        { PATH: `${bin}:${process.env.PATH ?? ''}` },
        join(tree, 'apps/api/scripts/password-reset.mjs'),
        ['SESSION_STATE_PATH', 'MC_COMPOSE'],
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

function dockerBin(
  dir: string,
  reply: { services: string; volume: string },
): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const services = reply.services.replace(/'/g, `'\\''`);
  const volume = reply.volume.replace(/'/g, `'\\''`);
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
  case " $* " in
    *" -a "*) printf '%s\\n' '${services}' ;;
  esac
  exit 0
fi
if [ "$1" = "volume" ] && [ "$2" = "ls" ]; then
  case " $* " in
    *mc-auth*) printf '%s\\n' '${volume}' ;;
  esac
  exit 0
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
