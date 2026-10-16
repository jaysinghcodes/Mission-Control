import { LiveActivityGateway } from './live-activity.gateway';
import { Server, Socket } from 'socket.io';
import { hashPassword } from '../auth/password';
import { signSession } from '../auth/session';

/**
 * Unit tests for LiveActivityGateway (GLM review 🟡 #11 — zero coverage).
 * Uses a minimal fake socket; no real network involved.
 */
describe('LiveActivityGateway', () => {
  let gateway: LiveActivityGateway;

  beforeEach(() => {
    gateway = new LiveActivityGateway();
    gateway.server = { emit: jest.fn() } as unknown as Server;
    process.env.NODE_ENV = 'test';
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
});
