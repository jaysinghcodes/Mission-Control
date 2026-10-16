import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { networkInterfaces, tmpdir } from 'os';
import { join, resolve } from 'path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { hashPassword } from './password';
import { isIngestWrite, skipsSession } from './route-class';
import {
  LOGIN_LIMIT_MESSAGE,
  resetLoginLimits,
  setLoginClock,
} from './login-limit';
import { changePasswordHash } from './session-state';
import { listRegisteredRoutes, probePath } from './write-routes';

/**
 * Off loopback, every dashboard read and write is 401 without a session.
 * Supertest connects from 127.0.0.1, so TRUSTED_PROXY names that peer and
 * X-Forwarded-For supplies the client. A second check uses a real non
 * loopback interface when this machine has one, with the header unset.
 */
const TOKEN = 'route-coverage-token';
const PASSWORD = 'dashboard-login-test-password';
const REMOTE = '203.0.113.10';

describe('dashboard session', () => {
  let app: INestApplication;
  let stateDir = '';
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.INGEST_TOKEN = TOKEN;
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword(PASSWORD);
    process.env.SESSION_SECRET = 'dashboard-session-secret';
    process.env.TRUSTED_PROXY = '127.0.0.1';
    process.env.LOGIN_FAIL_LIMIT = '5';
    process.env.LOGIN_WINDOW_SECONDS = '60';
    process.env.LOGIN_BACKOFF_MAX_SECONDS = '900';
    stateDir = mkdtempSync(join(tmpdir(), 'mc-dash-'));
    process.env.SESSION_STATE_PATH = join(stateDir, 'state.json');
    resetLoginLimits();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    resetLoginLimits();
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
    process.env = { ...saved };
    if (app) await app.close();
  });

  function remote(method: string, path: string) {
    const verb = method.toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete';
    const req = request(app.getHttpServer())
      [verb](path)
      .set('x-forwarded-for', REMOTE);
    if (verb !== 'get') req.send({});
    return req;
  }

  it('returns 401 for every dashboard route off loopback and not for ingest or login', async () => {
    const routes = listRegisteredRoutes(app);
    const dashboard = routes.filter(
      (route) => !skipsSession(route.method, route.path),
    );
    expect(
      dashboard.some(
        (route) => route.method === 'GET' && route.path === '/sessions',
      ),
    ).toBe(true);
    expect(
      dashboard.some(
        (route) => route.method === 'GET' && route.path === '/health',
      ),
    ).toBe(true);
    expect(dashboard.length).toBeGreaterThan(10);
    for (const route of dashboard) {
      const denied = await remote(route.method, probePath(route.path));
      expect(denied.status).toBe(401);
      expect(denied.body).toEqual({ statusCode: 401, message: 'unauthorized' });
    }
  });

  it('keeps ingest on its own token off loopback', async () => {
    const open = await remote('POST', '/events');
    expect(open.status).toBe(401);
    const allowed = await request(app.getHttpServer())
      .post('/events')
      .set('x-forwarded-for', REMOTE)
      .set('x-ingest-token', TOKEN)
      .send({ type: 'health.tick', payload: {} });
    expect(allowed.status).not.toBe(401);
    expect(isIngestWrite('POST', '/agents/register')).toBe(true);
    expect(isIngestWrite('DELETE', '/agents/someone')).toBe(false);
  });

  it('ignores X-Forwarded-For when the peer is not a trusted proxy', async () => {
    delete process.env.TRUSTED_PROXY;
    const spoofed = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-forwarded-for', REMOTE);
    expect(spoofed.status).not.toBe(401);
    process.env.TRUSTED_PROXY = '127.0.0.1';
  });

  it('logs in with the password, then reads /sessions, and logout closes it', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', REMOTE)
      .send({ password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ statusCode: 401, message: 'unauthorized' });

    const status = await request(app.getHttpServer())
      .get('/auth/session')
      .set('x-forwarded-for', REMOTE);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ authenticated: false, loginRequired: true });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', REMOTE)
      .send({ password: PASSWORD });
    expect(login.status).toBe(204);
    const line = headerLine(login.headers['set-cookie']);
    expect(line).toMatch(/^mc_session=/);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(process.env.DASHBOARD_PASSWORD_HASH ?? 'hash');

    const cookie = line.split(';')[0];
    const read = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(read.status).not.toBe(401);

    const loopback = await request(app.getHttpServer()).get('/auth/session');
    expect(loopback.body).toEqual({
      authenticated: true,
      loginRequired: false,
    });

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(logout.status).toBe(204);
    const cleared = headerLine(logout.headers['set-cookie']);
    expect(cleared).toMatch(/Max-Age=0/i);

    const copied = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(copied.status).toBe(401);
    expect(copied.body).toEqual({ statusCode: 401, message: 'unauthorized' });
  });

  it('does not trust X-Forwarded-For from a real non loopback socket', async () => {
    const ip = lanIp();
    if (!ip) return;
    delete process.env.TRUSTED_PROXY;
    await app.listen(0, '0.0.0.0');
    // The HTTP server type from Nest is any here. Read the port without using it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const port = listenPort(app.getHttpServer().address());
    const res = await fetch(`http://${ip}:${port}/sessions`, {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe('unauthorized');
    process.env.TRUSTED_PROXY = '127.0.0.1';
  });

  it('does not revoke when a remote logout has no session, and disconnects sockets when it does', async () => {
    const gateway = app.get(LiveActivityGateway);
    const spy = jest.spyOn(gateway, 'dropRevokedSockets');
    const cookie = await loginCookie(app);
    spy.mockClear();

    const anonymous = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('x-forwarded-for', REMOTE);
    expect(anonymous.status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
    const still = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(still.status).not.toBe(401);

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(logout.status).toBe(204);
    expect(spy).toHaveBeenCalled();
    const copied = await request(app.getHttpServer())
      .get('/sessions')
      .set('x-forwarded-for', REMOTE)
      .set('Cookie', cookie);
    expect(copied.status).toBe(401);
    expect(freshProcessAccepts(cookie)).toBe(false);
    const renewed = await loginCookie(app);
    expect(freshProcessAccepts(renewed)).toBe(true);
    spy.mockRestore();
  });

  it('does not rate limit loopback', async () => {
    for (let i = 0; i < 6; i += 1) {
      const wrong = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: 'nope' });
      expect(wrong.status).toBe(401);
      expect(wrong.headers['retry-after']).toBeUndefined();
    }
    const ok = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: PASSWORD });
    expect(ok.status).toBe(204);
  });

  it('refuses the 6th login inside a minute even with the right password, then allows it after the wait', async () => {
    const ip = '198.51.100.20';
    let now = 1_700_000_000_000;
    setLoginClock(() => now);
    try {
      for (let i = 0; i < 5; i += 1) {
        const wrong = await request(app.getHttpServer())
          .post('/auth/login')
          .set('x-forwarded-for', ip)
          .send({ password: 'nope' });
        expect(wrong.status).toBe(401);
      }
      const blocked = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-forwarded-for', ip)
        .send({ password: PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('60');
      expect(blocked.body).toEqual({
        statusCode: 429,
        message: LOGIN_LIMIT_MESSAGE,
      });
      const during = await request(app.getHttpServer())
        .post('/events')
        .set('x-forwarded-for', ip)
        .set('x-ingest-token', TOKEN)
        .send({ type: 'health.tick', payload: {} });
      expect(during.status).not.toBe(401);
      expect(during.status).not.toBe(429);

      now += 60_000;
      const ok = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-forwarded-for', ip)
        .send({ password: PASSWORD });
      expect(ok.status).toBe(204);
    } finally {
      resetLoginLimits();
    }
  });

  it('a password change revokes every session and the new process keeps that', async () => {
    const original = process.env.DASHBOARD_PASSWORD_HASH ?? '';
    const next = 'next-dashboard-password';
    try {
      const first = await loginCookie(app);
      const second = await loginCookie(app);
      const changed = await request(app.getHttpServer())
        .post('/auth/password')
        .set('x-forwarded-for', REMOTE)
        .set('Cookie', first)
        .send({ currentPassword: PASSWORD, newPassword: next });
      expect(changed.status).toBe(204);
      for (const cookie of [first, second]) {
        const dead = await request(app.getHttpServer())
          .get('/sessions')
          .set('x-forwarded-for', REMOTE)
          .set('Cookie', cookie);
        expect(dead.status).toBe(401);
        expect(freshProcessAccepts(cookie)).toBe(false);
      }
      const oldPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-forwarded-for', REMOTE)
        .send({ password: PASSWORD });
      expect(oldPassword.status).toBe(401);
      const cookie = await loginCookie(app, next);
      expect(freshProcessAccepts(cookie)).toBe(true);
      const wrongCurrent = await request(app.getHttpServer())
        .post('/auth/password')
        .set('x-forwarded-for', REMOTE)
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'another-password' });
      expect(wrongCurrent.status).toBe(401);
      const still = await request(app.getHttpServer())
        .get('/sessions')
        .set('x-forwarded-for', REMOTE)
        .set('Cookie', cookie);
      expect(still.status).not.toBe(401);
    } finally {
      changePasswordHash(original);
    }
  });
});

async function loginCookie(
  app: INestApplication,
  password = PASSWORD,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .set('x-forwarded-for', REMOTE)
    .send({ password });
  expect(login.status).toBe(204);
  return headerLine(login.headers['set-cookie']).split(';')[0] ?? '';
}

function freshProcessAccepts(cookieHeader: string): boolean {
  const register = require.resolve('ts-node/register/transpile-only');
  const apiDir = resolve(__dirname, '..', '..');
  const result = spawnSync(
    process.execPath,
    [
      '-r',
      register,
      '-e',
      [
        "const { validSession } = require('./src/auth/session');",
        'process.exit(validSession(process.env.CHECK_COOKIE) ? 0 : 2);',
      ].join('\n'),
    ],
    {
      cwd: apiDir,
      env: { ...process.env, CHECK_COOKIE: cookieHeader },
      encoding: 'utf8',
    },
  );
  if (result.status !== 0 && result.status !== 2) {
    throw new Error(
      `fresh process status ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.status === 0;
}

function headerLine(value: unknown): string {
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return typeof first === 'string' ? first : '';
  }
  return typeof value === 'string' ? value : '';
}

function listenPort(address: unknown): number {
  if (typeof address !== 'object' || address === null || !('port' in address)) {
    return 0;
  }
  const port = address.port;
  return typeof port === 'number' ? port : 0;
}

function lanIp(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.internal || addr.family !== 'IPv4') continue;
      return addr.address;
    }
  }
  return null;
}
