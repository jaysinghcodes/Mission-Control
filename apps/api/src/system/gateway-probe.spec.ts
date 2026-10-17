import { createServer, type Server } from 'net';
import { PrismaService } from '../prisma/prisma.service';
import { gatewayTarget, probeGateway } from './gateway-probe';
import { SystemController } from './system.controller';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('gateway probe', () => {
  const savedHost = process.env.OPENCLAW_GATEWAY_HOST;
  const savedPort = process.env.OPENCLAW_GATEWAY_PORT;
  const savedCompose = process.env.MC_COMPOSE;

  afterEach(() => {
    if (savedHost === undefined) delete process.env.OPENCLAW_GATEWAY_HOST;
    else process.env.OPENCLAW_GATEWAY_HOST = savedHost;
    if (savedPort === undefined) delete process.env.OPENCLAW_GATEWAY_PORT;
    else process.env.OPENCLAW_GATEWAY_PORT = savedPort;
    if (savedCompose === undefined) delete process.env.MC_COMPOSE;
    else process.env.MC_COMPOSE = savedCompose;
  });

  it('defaults to 127.0.0.1 port 18789', () => {
    delete process.env.OPENCLAW_GATEWAY_HOST;
    delete process.env.OPENCLAW_GATEWAY_PORT;
    expect(gatewayTarget()).toEqual({ host: '127.0.0.1', port: 18789 });
  });

  it('uses a configured host and port', () => {
    process.env.OPENCLAW_GATEWAY_HOST = 'localhost';
    process.env.OPENCLAW_GATEWAY_PORT = '19001';
    expect(gatewayTarget()).toEqual({ host: 'localhost', port: 19001 });
    process.env.OPENCLAW_GATEWAY_HOST = 'not a host';
    process.env.OPENCLAW_GATEWAY_PORT = '0';
    expect(gatewayTarget()).toEqual({ host: '127.0.0.1', port: 18789 });
  });

  it('accepts the Compose default host', () => {
    process.env.OPENCLAW_GATEWAY_HOST = 'host.docker.internal';
    process.env.OPENCLAW_GATEWAY_PORT = '18789';
    expect(gatewayTarget()).toEqual({
      host: 'host.docker.internal',
      port: 18789,
    });
  });

  it('reports up when a stub gateway accepts the connection', async () => {
    const server = createServer((socket) => {
      socket.end();
    });
    const port = await listen(server);
    delete process.env.MC_COMPOSE;
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1';
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    try {
      const body = await new SystemController().system();
      expect(body.gateway.host).toBe('127.0.0.1');
      expect(body.gateway.port).toBe(port);
      expect(body.gateway.up).toBe(true);
      expect(body.gateway.state).toBe('up');
      expect(body.gateway.source).toBe('probe');
      expect(typeof body.gateway.latencyMs).toBe('number');
    } finally {
      await close(server);
    }
  });

  it('reports down when nothing is listening', async () => {
    const server = createServer();
    const port = await listen(server);
    await close(server);
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1';
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    const result = await probeGateway();
    expect(result.up).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.host).toBe('127.0.0.1');
    expect(result.port).toBe(port);
  });

  it('under Compose uses the bridge report and does not probe the container', async () => {
    process.env.MC_COMPOSE = '1';
    delete process.env.OPENCLAW_GATEWAY_HOST;
    const checkedAt = Date.now();
    const findFirst = jest.fn().mockResolvedValue({
      ts: new Date(checkedAt),
      payload: {
        up: true,
        host: '127.0.0.1',
        port: 18789,
        checkedAt,
        latencyMs: 2,
        version: 'OpenClaw 1',
      },
    });
    const body = await new SystemController({
      activityEvent: { findFirst },
    } as unknown as PrismaService).system();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { payload: true, ts: true },
      }),
    );
    expect(body.gateway).toMatchObject({
      state: 'up',
      source: 'bridge',
      host: '127.0.0.1',
      port: 18789,
      version: 'OpenClaw 1',
    });
  });

  it('under Compose with no report is Unknown, not Down', async () => {
    process.env.MC_COMPOSE = '1';
    delete process.env.OPENCLAW_GATEWAY_HOST;
    const body = await new SystemController({
      activityEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService).system();
    expect(body.gateway.state).toBe('unknown');
    expect(body.gateway.up).toBe(false);
    expect(body.gateway.source).toBe('bridge');
  });

  it('an explicit host under Compose probes that host and ignores the report', async () => {
    const server = createServer((socket) => {
      socket.end();
    });
    const port = await listen(server);
    process.env.MC_COMPOSE = '1';
    process.env.OPENCLAW_GATEWAY_HOST = '127.0.0.1';
    process.env.OPENCLAW_GATEWAY_PORT = String(port);
    const findFirst = jest.fn().mockResolvedValue({
      payload: { up: false, host: '127.0.0.1', port: 1, checkedAt: Date.now() },
    });
    try {
      const body = await new SystemController({
        activityEvent: { findFirst },
      } as unknown as PrismaService).system();
      expect(findFirst).not.toHaveBeenCalled();
      expect(body.gateway.state).toBe('up');
      expect(body.gateway.source).toBe('probe');
      expect(body.gateway.port).toBe(port);
    } finally {
      await close(server);
    }
  });
});
