import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { hashPassword } from './password';

/**
 * No HTTP request can reset the dashboard password.
 * The Vite proxy, the API port, and both nginx listeners are all tried,
 * with and without forwarding headers. password:reset writes the session
 * file and logs out every session.
 */
const PASSWORD = 'dashboard-login-test-password';
const REMOTE = '203.0.113.10';
const script = resolve(__dirname, '..', '..', 'scripts', 'password-reset.mjs');
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const nginxTemplate = resolve(repoRoot, 'apps/web/nginx.conf.template');
const viteBin = resolve(repoRoot, 'apps/web/node_modules/vite/bin/vite.js');

describe('password reset has no HTTP route', () => {
  let app: INestApplication;
  let stateDir = '';
  let apiPort = 0;
  const saved = { ...process.env };
  const children: ChildProcess[] = [];
  const temps: string[] = [];

  beforeAll(async () => {
    process.env.INGEST_TOKEN = 'route-coverage-token';
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword(PASSWORD);
    process.env.SESSION_SECRET = 'dashboard-session-secret';
    delete process.env.TRUSTED_PROXY;
    delete process.env.BUNDLED_PROXY;
    delete process.env.MC_COMPOSE;
    stateDir = mkdtempSync(join(tmpdir(), 'mc-pw-http-'));
    process.env.SESSION_STATE_PATH = join(stateDir, 'state.json');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const peer = req.header('x-test-peer');
      if (peer) {
        Object.defineProperty(req.socket, 'remoteAddress', {
          configurable: true,
          value: peer,
        });
      }
      next();
    });
    await app.listen(0, '127.0.0.1');
    const httpServer = app.getHttpServer() as {
      address(): string | { port?: number } | null;
    };
    const address = httpServer.address();
    apiPort =
      typeof address === 'object' && address && typeof address.port === 'number'
        ? address.port
        : 0;
    expect(apiPort).toBeGreaterThan(0);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    for (const child of children) await stopChild(child);
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  it('rejects every reset request and password:reset still revokes every session', async () => {
    const first = await loginCookie(app);
    const second = await loginCookie(app);
    const webPort = await freePort();
    const localNginx = await freePort();
    const tunnelNginx = await freePort();
    const vite = startVite(webPort, apiPort);
    const nginx = startNginx(localNginx, tunnelNginx, apiPort);
    children.push(vite.child, nginx.child);
    temps.push(nginx.dir);
    await waitForPort(webPort, vite.child, vite.logs);
    await waitForPort(localNginx, nginx.child, nginx.logs);
    await waitForPort(tunnelNginx, nginx.child, nginx.logs);

    const headerSets: Record<string, string>[] = [
      {},
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-real-ip': '127.0.0.1' },
      { 'cf-connecting-ip': '127.0.0.1' },
      {
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'cf-connecting-ip': '127.0.0.1',
        cookie: first,
      },
    ];
    const posts = [
      `http://127.0.0.1:${apiPort}/auth/password-reset`,
      `http://127.0.0.1:${webPort}/api/auth/password-reset`,
      `http://127.0.0.1:${localNginx}/api/auth/password-reset`,
      `http://127.0.0.1:${tunnelNginx}/api/auth/password-reset`,
    ];
    for (const url of posts) {
      for (const headers of headerSets) {
        const res = await fetch(url, { method: 'POST', headers });
        expect([url, res.status]).toEqual([url, 404]);
        const text = await res.text();
        expect(text).not.toContain('Dashboard password');
      }
    }
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(
        `http://127.0.0.1:${apiPort}/auth/password-reset`,
        {
          method,
          headers: { 'x-forwarded-for': '127.0.0.1', cookie: first },
        },
      );
      expect(res.status).toBe(404);
    }
    const still = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-test-peer', REMOTE)
      .send({ password: PASSWORD });
    expect(still.status).toBe(204);
    for (const cookie of [first, second]) {
      const live = await request(app.getHttpServer())
        .get('/sessions')
        .set('x-test-peer', REMOTE)
        .set('Cookie', cookie);
      expect(live.status).not.toBe(401);
    }

    const statePath = process.env.SESSION_STATE_PATH ?? '';
    const reset = await runReset(statePath, false);
    expect(reset.status).toBe(0);
    const password = shownPassword(reset.stdout);
    expect(password).not.toBe('');
    expect(password).not.toBe(PASSWORD);
    expect(reset.stdout.split(password).length - 1).toBe(1);
    expect(reset.stdout).toContain('Every session was revoked.');
    for (const cookie of [first, second]) {
      const dead = await request(app.getHttpServer())
        .get('/sessions')
        .set('x-test-peer', REMOTE)
        .set('Cookie', cookie);
      expect(dead.status).toBe(401);
    }
    const oldPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-test-peer', REMOTE)
      .send({ password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    const next = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-test-peer', REMOTE)
      .send({ password });
    expect(next.status).toBe(204);
    const kept = headerLine(next.headers['set-cookie']);

    const again = await runReset(statePath, true);
    expect(again.status).toBe(0);
    const composePassword = shownPassword(again.stdout);
    expect(composePassword).not.toBe('');
    expect(composePassword).not.toBe(password);
    const dropped = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-test-peer', REMOTE)
      .set('Cookie', kept);
    expect(dropped.status).toBe(401);
    const composeLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-test-peer', REMOTE)
      .send({ password: composePassword });
    expect(composeLogin.status).toBe(204);
  }, 60000);
});

function shownPassword(stdout: string): string {
  const match = stdout.match(/^Dashboard password, shown once: (\S+)$/m);
  return match?.[1] ?? '';
}

async function loginCookie(app: INestApplication): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('x-test-peer', REMOTE)
    .send({ password: PASSWORD });
  expect(login.status).toBe(204);
  return firstCookie(login.headers['set-cookie']);
}

function firstCookie(value: unknown): string {
  const line = cookieLine(value);
  return line.split(';')[0] ?? '';
}

function cookieLine(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  const first = value.find((item): item is string => typeof item === 'string');
  return first ?? '';
}

function headerLine(value: unknown): string {
  return firstCookie(value);
}

function runReset(
  statePath: string,
  compose: boolean,
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolvePromise) => {
    const env = { ...process.env, SESSION_STATE_PATH: statePath };
    if (compose) env.MC_COMPOSE = '1';
    else delete env.MC_COMPOSE;
    const child = spawn(process.execPath, [script], {
      env,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('close', (status) => resolvePromise({ status, stdout }));
  });
}

function startVite(
  webPort: number,
  apiPort: number,
): { child: ChildProcess; logs: () => string } {
  let text = '';
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(webPort)],
    {
      cwd: resolve(repoRoot, 'apps/web'),
      env: {
        ...process.env,
        PORT: String(apiPort),
        MC_WEB_PORT: String(webPort),
        MC_API_PORT: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    text += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    text += chunk;
  });
  return { child, logs: () => text };
}

function startNginx(
  localPort: number,
  tunnelPort: number,
  apiPort: number,
): { child: ChildProcess; dir: string; logs: () => string } {
  const bin = nginxBin();
  if (!bin)
    throw new Error('nginx is required for the password reset route test');
  const dir = mkdtempSync(join(tmpdir(), 'mc-pw-nginx-'));
  for (const name of [
    'client_body',
    'proxy',
    'fastcgi',
    'uwsgi',
    'scgi',
    'html',
  ]) {
    mkdirSync(join(dir, name));
  }
  const template = readFileSync(nginxTemplate, 'utf8')
    .replace('listen 5173;', `listen 127.0.0.1:${localPort};`)
    .replace('listen 3011;', `listen 127.0.0.1:${tunnelPort};`)
    .replaceAll('root /usr/share/nginx/html;', `root ${join(dir, 'html')};`)
    .replaceAll('http://api:3000', `http://127.0.0.1:${apiPort}`);
  writeFileSync(join(dir, 'server.conf'), template);
  const conf = join(dir, 'nginx.conf');
  writeFileSync(
    conf,
    [
      'worker_processes 1;',
      `error_log ${join(dir, 'error.log')};`,
      `pid ${join(dir, 'nginx.pid')};`,
      'events { worker_connections 32; }',
      'http {',
      `  access_log ${join(dir, 'access.log')};`,
      `  client_body_temp_path ${join(dir, 'client_body')};`,
      `  proxy_temp_path ${join(dir, 'proxy')};`,
      `  fastcgi_temp_path ${join(dir, 'fastcgi')};`,
      `  uwsgi_temp_path ${join(dir, 'uwsgi')};`,
      `  scgi_temp_path ${join(dir, 'scgi')};`,
      `  include ${join(dir, 'server.conf')};`,
      '}',
      '',
    ].join('\n'),
  );
  let text = '';
  const child = spawn(bin, ['-c', conf, '-g', 'daemon off;'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    text += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    text += chunk;
  });
  return { child, dir, logs: () => text };
}

function stopChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return Promise.resolve();
  const pid = child.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolvePromise();
    }, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

function nginxBin(): string | null {
  for (const candidate of [
    'nginx',
    '/usr/sbin/nginx',
    '/usr/local/sbin/nginx',
  ]) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status === 0 && text.toLowerCase().includes('nginx'))
      return candidate;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

function waitForPort(
  port: number,
  child: ChildProcess,
  logs: () => string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`listener exited ${child.exitCode}\n${logs()}`));
        return;
      }
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.end();
        resolvePromise();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > 8000) {
          reject(new Error(`port ${port} did not listen\n${logs()}`));
          return;
        }
        setTimeout(tick, 50);
      });
    };
    tick();
  });
}
