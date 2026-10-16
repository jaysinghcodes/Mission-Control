import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createServer, type Server } from 'net';
import request from 'supertest';
import { responseJson } from '../../test/lint-helpers';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

interface GatewayBody {
  gateway: {
    state: string;
    up: boolean;
    source: string;
    host: string;
    port: number;
    version?: string;
  };
}

/**
 * gateway.snapshot is the Compose status. The bridge posts it with
 * x-ingest-token. GET /system reads that row only when MC_COMPOSE=1 and
 * OPENCLAW_GATEWAY_HOST is blank.
 */

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

describe('GET /system gateway report', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    delete process.env.INGEST_TOKEN;
    jest.resetModules();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    process.env.NODE_ENV = 'development';
    process.env.INGEST_TOKEN = 'gateway-secret';
    process.env.MC_COMPOSE = '1';
    delete process.env.OPENCLAW_GATEWAY_HOST;
    delete process.env.OPENCLAW_GATEWAY_PORT;
    delete process.env.GATEWAY_STATUS_MAX_AGE_MS;
    await prisma.activityEvent.deleteMany({
      where: { type: 'gateway.snapshot' },
    });
  });

  afterAll(async () => {
    await prisma.activityEvent.deleteMany({
      where: { type: 'gateway.snapshot' },
    });
    process.env = { ...savedEnv };
    await app.close();
  });

  async function post(
    payload: Record<string, unknown>,
    token = 'gateway-secret',
  ) {
    const req = request(app.getHttpServer())
      .post('/events')
      .send({ type: 'gateway.snapshot', payload });
    if (token) req.set('x-ingest-token', token);
    return req;
  }

  it('requires x-ingest-token and rejects a payload that is not a real check', async () => {
    const missing = await request(app.getHttpServer())
      .post('/events')
      .send({
        type: 'gateway.snapshot',
        payload: { up: true, checkedAt: Date.now() },
      });
    expect(missing.status).toBe(401);

    const bad = await post({ up: false });
    expect(bad.status).toBe(400);

    const rows = await prisma.activityEvent.count({
      where: { type: 'gateway.snapshot' },
    });
    expect(rows).toBe(0);

    const system = await request(app.getHttpServer()).get('/system');
    expect(system.status).toBe(200);
    const unknown = responseJson<GatewayBody>(system).gateway;
    expect(unknown.state).toBe('unknown');
    expect(unknown.up).toBe(false);
    expect(unknown.source).toBe('bridge');
  });

  it('shows Up, Down, then Unknown as the bridge report ages', async () => {
    const now = Date.now();
    const up = await post({
      up: true,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: now,
      latencyMs: 5,
      version: 'OpenClaw 9',
    });
    expect(up.status).toBe(202);

    const fresh = await request(app.getHttpServer()).get('/system');
    expect(responseJson<GatewayBody>(fresh).gateway).toMatchObject({
      state: 'up',
      up: true,
      source: 'bridge',
      host: '127.0.0.1',
      port: 18789,
      version: 'OpenClaw 9',
    });

    const down = await post({
      up: false,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: now,
      latencyMs: null,
    });
    expect(down.status).toBe(202);
    const stopped = await request(app.getHttpServer()).get('/system');
    const stoppedGateway = responseJson<GatewayBody>(stopped).gateway;
    expect(stoppedGateway.state).toBe('down');
    expect(stoppedGateway.up).toBe(false);
    expect(stoppedGateway.source).toBe('bridge');

    process.env.GATEWAY_STATUS_MAX_AGE_MS = '1000';
    const stale = await post({
      up: true,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: now - 5000,
    });
    expect(stale.status).toBe(202);
    const aged = await request(app.getHttpServer()).get('/system');
    const agedGateway = responseJson<GatewayBody>(aged).gateway;
    expect(agedGateway.state).toBe('unknown');
    expect(agedGateway.up).toBe(false);
  });

  it('ages a future dated report from the time it was stored and leaves a normal report up', async () => {
    process.env.GATEWAY_STATUS_MAX_AGE_MS = '60000';
    const now = Date.now();
    const normal = await post({
      up: true,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: now - 1000,
      latencyMs: 3,
    });
    expect(normal.status).toBe(202);
    const fresh = await request(app.getHttpServer()).get('/system');
    expect(responseJson<GatewayBody>(fresh).gateway).toMatchObject({
      state: 'up',
      up: true,
      source: 'bridge',
    });

    await prisma.activityEvent.deleteMany({
      where: { type: 'gateway.snapshot' },
    });
    const future = await post({
      up: true,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: now + 24 * 60 * 60 * 1000,
      latencyMs: 3,
    });
    expect(future.status).toBe(202);
    const skewed = await request(app.getHttpServer()).get('/system');
    expect(responseJson<GatewayBody>(skewed).gateway.state).toBe('up');

    await prisma.activityEvent.updateMany({
      where: { type: 'gateway.snapshot' },
      data: { ts: new Date(Date.now() - 120_000) },
    });
    const aged = await request(app.getHttpServer()).get('/system');
    const agedGateway = responseJson<GatewayBody>(aged).gateway;
    expect(agedGateway.state).toBe('unknown');
    expect(agedGateway.up).toBe(false);
  });

  it('treats a max age of 0 as 10 minutes and keeps an explicit port on the bridge report', async () => {
    process.env.GATEWAY_STATUS_MAX_AGE_MS = '0';
    process.env.OPENCLAW_GATEWAY_PORT = '19001';
    const now = Date.now();
    await post({
      up: true,
      host: '127.0.0.1',
      port: 19001,
      checkedAt: now - 60_000,
      latencyMs: 1,
    });
    const body = await request(app.getHttpServer()).get('/system');
    const reported = responseJson<GatewayBody>(body).gateway;
    expect(reported.state).toBe('up');
    expect(reported.port).toBe(19001);
    expect(reported.source).toBe('bridge');
  });

  it('probes an explicit host directly and ignores the bridge report', async () => {
    const server = createServer((socket) => {
      socket.end();
    });
    const port = await listen(server);
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1';
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    await post({
      up: false,
      host: '127.0.0.1',
      port: 1,
      checkedAt: Date.now(),
    });
    try {
      const body = await request(app.getHttpServer()).get('/system');
      const probed = responseJson<GatewayBody>(body).gateway;
      expect(probed.state).toBe('up');
      expect(probed.source).toBe('probe');
      expect(probed.host).toBe('127.0.0.1');
      expect(probed.port).toBe(port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('probes directly on a native install even when a bridge report exists', async () => {
    delete process.env.MC_COMPOSE;
    const server = createServer();
    const port = await listen(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1';
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    await post({
      up: true,
      host: '127.0.0.1',
      port: 18789,
      checkedAt: Date.now(),
    });
    const body = await request(app.getHttpServer()).get('/system');
    const probed = responseJson<GatewayBody>(body).gateway;
    expect(probed.state).toBe('down');
    expect(probed.source).toBe('probe');
    expect(probed.port).toBe(port);
  });
});
