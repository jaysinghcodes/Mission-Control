import { spawn } from 'node:child_process';
import {
  chmodSync,
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

  it('refuses on the host when the Compose api container is running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-pw-docker-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'docker'),
      '#!/bin/sh\nif [ "$1" = "compose" ] && [ "$2" = "ps" ]; then printf "%s\\n" api; exit 0; fi\nexit 0\n',
    );
    chmodSync(join(bin, 'docker'), 0o755);
    const fallback = join(__dirname, '..', '..', 'data', 'session-state.json');
    const before = existsSync(fallback) ? readFileSync(fallback) : null;
    try {
      const result = await runReset({
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        SESSION_STATE_PATH: '',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('Dashboard password');
      expect(result.stderr).toContain(
        'Could not reset the dashboard password.',
      );
      expect(result.stderr).toContain(
        'docker compose exec api npm run password:reset',
      );
      const after = existsSync(fallback) ? readFileSync(fallback) : null;
      expect(after).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function shownPassword(stdout: string): string {
  const match = stdout.match(/^Dashboard password, shown once: (\S+)$/m);
  return match?.[1] ?? '';
}

function runReset(env: NodeJS.ProcessEnv): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
    });
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
