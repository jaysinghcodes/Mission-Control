import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LiveActivityGateway } from './live-activity.gateway';
import { Server, Socket } from 'socket.io';
import { resetBundledPeerCache } from '../auth/bundled-proxy';
import { hashPassword } from '../auth/password';
import { signSession } from '../auth/session';
import { revokeSessions } from '../auth/session-state';

/**
 * Unit tests for LiveActivityGateway (GLM review 🟡 #11 — zero coverage).
 * Uses a minimal fake socket; no real network involved.
 */
describe('LiveActivityGateway', () => {
  let gateway: LiveActivityGateway;
  let stateDir: string;
  let savedStatePath: string | undefined;

  beforeAll(() => {
    savedStatePath = process.env.SESSION_STATE_PATH;
    stateDir = mkdtempSync(join(tmpdir(), 'mc-socket-'));
  });

  afterAll(() => {
    if (savedStatePath === undefined) delete process.env.SESSION_STATE_PATH;
    else process.env.SESSION_STATE_PATH = savedStatePath;
    rmSync(stateDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    gateway = new LiveActivityGateway();
    gateway.server = { emit: jest.fn() } as unknown as Server;
    process.env.NODE_ENV = 'test';
    process.env.SESSION_STATE_PATH = join(stateDir, 'state.json');
    rmSync(process.env.SESSION_STATE_PATH, { force: true });
  });

  function fakeSocket(
    address = '127.0.0.1',
    cookie?: string,
  ): {
    client: Socket;
    emit: jest.Mock;
    disconnect: jest.Mock;
  } {
    const emit = jest.fn();
    const disconnect = jest.fn();
    const client = {
      id: `socket-${Math.random()}`,
      handshake: {
        auth: {},
        address,
        headers: cookie ? { cookie } : {},
      },
      emit,
      disconnect,
    } as unknown as Socket;
    return { client, emit, disconnect };
  }

  it('registers a client on connection and greets it', () => {
    const { client, emit } = fakeSocket();
    gateway.handleConnection(client);

    expect(gateway.clientCount).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ message: 'mission-control api connected' }),
    );
  });

  it('removes the client on disconnect', () => {
    const { client } = fakeSocket();
    gateway.handleConnection(client);
    expect(gateway.clientCount).toBe(1);

    gateway.handleDisconnect(client);
    expect(gateway.clientCount).toBe(0);
  });

  it('broadcast before the socket server exists does not throw', () => {
    expect(() =>
      gateway.broadcast('run.queued', { name: 'early' }),
    ).not.toThrow();
  });

  it('broadcasts typed events with a server timestamp', () => {
    const emit = jest.fn(
      (_event: string, _payload: { name: string; ts: number }) => {
        void _event;
        void _payload;
      },
    );
    gateway.server = { emit } as unknown as Server;
    gateway.broadcast('run.started', { name: 'Trend Radar' });

    expect(emit).toHaveBeenCalledTimes(1);
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe('run.started');
    expect(payload.name).toBe('Trend Radar');
    expect(typeof payload.ts).toBe('number');
  });

  it('does not treat the tunnel listener as loopback', () => {
    process.env.BUNDLED_PROXY = '127.0.0.1';
    resetBundledPeerCache();
    const { client, disconnect } = fakeSocket('127.0.0.1');
    client.handshake.headers['x-mc-remote'] = '1';
    gateway.handleConnection(client);
    expect(disconnect).toHaveBeenCalledWith(true);
    expect(gateway.clientCount).toBe(0);
    delete process.env.BUNDLED_PROXY;
    resetBundledPeerCache();
  });

  it('rejects a remote socket without a session cookie', () => {
    const { client, disconnect } = fakeSocket('203.0.113.10');

    gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(gateway.clientCount).toBe(0);
  });

  it('accepts a remote socket that presents the session cookie', () => {
    process.env.SESSION_SECRET = 'socket-secret';
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword('pw');
    const cookie = `mc_session=${encodeURIComponent(signSession('socket-secret', 3600))}`;
    const { client, disconnect } = fakeSocket('203.0.113.10', cookie);

    gateway.handleConnection(client);

    expect(disconnect).not.toHaveBeenCalled();
    expect(gateway.clientCount).toBe(1);
    delete process.env.SESSION_SECRET;
    delete process.env.DASHBOARD_PASSWORD_HASH;
  });

  it('disconnects a remote socket when the session version changes', () => {
    process.env.SESSION_SECRET = 'socket-secret';
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword('pw');
    const oldCookie = `mc_session=${encodeURIComponent(signSession('socket-secret', 3600))}`;
    const remote = fakeSocket('203.0.113.10', oldCookie);
    const local = fakeSocket('127.0.0.1');
    gateway.handleConnection(remote.client);
    gateway.handleConnection(local.client);

    revokeSessions();
    const sockets = new Map<string, Socket>([
      [remote.client.id, remote.client],
      [local.client.id, local.client],
    ]);
    gateway.server = { sockets: { sockets } } as unknown as Server;
    gateway.dropRevokedSockets();

    expect(remote.disconnect).toHaveBeenCalledWith(true);
    expect(local.disconnect).not.toHaveBeenCalled();
    expect(gateway.clientCount).toBe(1);

    const fresh = `mc_session=${encodeURIComponent(signSession('socket-secret', 3600))}`;
    const again = fakeSocket('203.0.113.10', fresh);
    gateway.handleConnection(again.client);
    expect(again.disconnect).not.toHaveBeenCalled();

    const stale = fakeSocket('203.0.113.10', oldCookie);
    gateway.handleConnection(stale.client);
    expect(stale.disconnect).toHaveBeenCalledWith(true);

    delete process.env.SESSION_SECRET;
    delete process.env.DASHBOARD_PASSWORD_HASH;
  });
});
