import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { hashPassword } from '../auth/password';
import { signSession } from '../auth/session';
import { revokeSessions } from '../auth/session-state';
import type { PrismaService } from '../prisma/prisma.service';
import { SettingsController } from '../settings/settings.controller';
import { LiveActivityGateway } from './live-activity.gateway';

/**
 * Issue 115 over a real Socket.IO server and real clients.
 * The peer address is set to a remote one, as a browser behind the
 * Compose network or a tunnel would be. Loopback is never dropped.
 */
describe('live tabs', () => {
  const saved = { ...process.env };
  let stateDir: string;
  let http: HttpServer;
  let ioServer: Server;
  let gateway: LiveActivityGateway;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'mc-live-tabs-'));
    process.env.SESSION_STATE_PATH = join(stateDir, 'state.json');
    process.env.SESSION_SECRET = 'live-tabs-secret';
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword('pw');
    process.env.NODE_ENV = 'test';
    http = createServer();
    ioServer = new Server(http, { transports: ['websocket'] });
    ioServer.use((socket, next) => {
      const peer = socket.handshake.headers['x-test-peer'];
      socket.handshake.address =
        typeof peer === 'string' ? peer : '203.0.113.10';
      next();
    });
    gateway = new LiveActivityGateway();
    gateway.server = ioServer;
    ioServer.on('connection', (client) => gateway.handleConnection(client));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    await new Promise<void>((resolve) => {
      void ioServer.close(() => resolve());
    });
    rmSync(stateDir, { recursive: true, force: true });
    process.env = { ...saved };
  });

  function cookie(): string {
    return `mc_session=${encodeURIComponent(signSession('live-tabs-secret', 3600))}`;
  }

  function open(
    sessionCookie: string | null,
    peer = '203.0.113.10',
  ): ClientSocket {
    const headers: Record<string, string> = { 'x-test-peer': peer };
    if (sessionCookie) headers.cookie = sessionCookie;
    const client = connect(url, {
      transports: ['websocket'],
      extraHeaders: headers,
      reconnection: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  function connected(client: ClientSocket): Promise<void> {
    return new Promise((resolve) => client.once('hello', () => resolve()));
  }

  async function within<T>(ms: number, promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`not within ${ms} ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  it('a settings save reaches the other tab within 2 s', async () => {
    const shared = cookie();
    const saver = open(shared);
    const other = open(shared);
    await Promise.all([connected(saver), connected(other)]);
    let row: Record<string, unknown> | null = null;
    const prisma = {
      agent: { findMany: jest.fn(() => [{ id: 'main', name: 'main' }]) },
      setting: {
        findUnique: jest.fn(() => row),
        upsert: jest.fn((args: { create: Record<string, unknown> }) => {
          row = { ...args.create };
          return row;
        }),
      },
    } as unknown as PrismaService;
    const settings = new SettingsController(prisma, gateway);
    const heard = new Promise<{ fields: string[]; ts: number }>((resolve) =>
      other.once('settings.changed', resolve),
    );
    const started = Date.now();
    await settings.put({ namingMode: 'crew', crewMap: { main: 'forge' } });
    const event = await within(2000, heard);
    expect(event.fields).toEqual(['namingMode', 'crewMap']);
    expect(typeof event.ts).toBe('number');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a revoke drops every remote tab within 2 s and a stale cookie cannot rejoin', async () => {
    const first = cookie();
    const second = cookie();
    const browserA = open(first);
    const browserB = open(second);
    const local = open(null, '127.0.0.1');
    await Promise.all([
      connected(browserA),
      connected(browserB),
      connected(local),
    ]);
    const reasons = Promise.all(
      [browserA, browserB].map(
        (client) =>
          new Promise<string>((resolve) =>
            client.once('disconnect', (reason) => resolve(reason)),
          ),
      ),
    );
    let localDropped = false;
    local.once('disconnect', () => {
      localDropped = true;
    });

    revokeSessions();
    gateway.dropRevokedSockets();

    // The web treats this reason as a revoke and reads the session again.
    expect(await within(2000, reasons)).toEqual([
      'io server disconnect',
      'io server disconnect',
    ]);
    expect(localDropped).toBe(false);
    expect(local.connected).toBe(true);

    const stale = open(first);
    const staleReason = await within(
      2000,
      new Promise<string>((resolve) =>
        stale.once('disconnect', (reason) => resolve(reason)),
      ),
    );
    expect(staleReason).toBe('io server disconnect');

    const fresh = open(cookie());
    await within(2000, connected(fresh));
    expect(fresh.connected).toBe(true);
  });
});
