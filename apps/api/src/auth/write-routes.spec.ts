import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import {
  listRegisteredWriteRoutes,
  probePath,
  type RegisteredWriteRoute,
} from './write-routes';
import { isAuthRoute, isIngestWrite } from './route-class';

/**
 * Route coverage for ingest auth and for dashboard writes on loopback.
 *
 * Ingest routes still 401 without x-ingest-token. Dashboard writes on
 * loopback do not. Off loopback coverage lives in dashboard-auth.spec.ts.
 */
const TOKEN = 'route-coverage-token';

const REQUIRED: RegisteredWriteRoute[] = [
  { method: 'POST', path: '/events' },
  { method: 'POST', path: '/tickets' },
  { method: 'PATCH', path: '/tickets/:id' },
  { method: 'POST', path: '/projects' },
  { method: 'PATCH', path: '/projects/:id' },
  { method: 'POST', path: '/runs' },
  { method: 'PATCH', path: '/runs/:id' },
  { method: 'POST', path: '/models' },
  { method: 'DELETE', path: '/models/:id' },
  { method: 'PUT', path: '/mission' },
  { method: 'POST', path: '/approvals/:id/decide' },
  { method: 'POST', path: '/custom-tools' },
  { method: 'PATCH', path: '/custom-tools/:id' },
  { method: 'DELETE', path: '/custom-tools/:id' },
  { method: 'POST', path: '/custom-tools/preview' },
  { method: 'POST', path: '/custom-tools/:id/preview' },
  { method: 'POST', path: '/agents/register' },
  { method: 'POST', path: '/agents/:id/heartbeat' },
  { method: 'DELETE', path: '/agents/:id' },
];

describe('write route coverage', () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.INGEST_TOKEN = TOKEN;
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    process.env = { ...saved };
    if (app) await app.close();
  });

  function hit(route: RegisteredWriteRoute, token?: string) {
    const method = route.method.toLowerCase() as
      'post' | 'put' | 'patch' | 'delete';
    const path = probePath(route.path);
    const req = request(app.getHttpServer())[method](path);
    if (token) req.set('x-ingest-token', token);
    return req.send({});
  }

  it('lists every registered write route, including the known set', () => {
    const routes = listRegisteredWriteRoutes(app);
    expect(routes.length).toBeGreaterThan(0);
    const missing = REQUIRED.filter(
      (required) =>
        !routes.some(
          (route) =>
            route.method === required.method && route.path === required.path,
        ),
    );
    expect(missing).toEqual([]);
    const reads = routes.filter((route) => route.method === 'GET');
    expect(reads).toEqual([]);
  });

  it('returns 401 for ingest without the token and lets dashboard writes through on loopback', async () => {
    const routes = listRegisteredWriteRoutes(app);
    expect(routes.length).toBeGreaterThanOrEqual(REQUIRED.length);
    for (const route of routes) {
      const ingest = isIngestWrite(route.method, route.path);
      const denied = await hit(route);
      if (ingest) {
        expect(denied.status).toBe(401);
        expect(denied.body).toEqual({
          statusCode: 401,
          message: 'unauthorized',
        });
        const allowed = await hit(route, TOKEN);
        expect(allowed.status).not.toBe(401);
      } else if (isAuthRoute(route.method, route.path)) {
        // Login checks the password. An empty body is a failed login.
        // Logout only clears the cookie.
        if (route.method === 'POST' && route.path === '/auth/logout') {
          expect(denied.status).not.toBe(401);
        }
      } else {
        expect([route.method, route.path, denied.status]).not.toEqual([
          route.method,
          route.path,
          401,
        ]);
      }
    }
  });

  it('rejects a wrong ingest token and still serves loopback reads', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/events')
      .set('x-ingest-token', 'not-the-token')
      .send({ type: 'health.tick', payload: {} });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ statusCode: 401, message: 'unauthorized' });

    const read = await request(app.getHttpServer()).get('/');
    expect(read.status).toBe(200);

    const dashboard = await request(app.getHttpServer())
      .post('/tickets')
      .send({});
    expect(dashboard.status).toBe(400);
  });

  it('allows a write when INGEST_TOKEN is unset', async () => {
    delete process.env.INGEST_TOKEN;
    const res = await request(app.getHttpServer()).post('/tickets').send({});
    expect(res.status).not.toBe(401);
    process.env.INGEST_TOKEN = TOKEN;
  });
});
