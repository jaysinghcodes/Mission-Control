import { LiveActivityGateway } from './live-activity.gateway';
import { Server, Socket } from 'socket.io';

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

  /** Build a fake socket with the pieces handleConnection touches. */
  function fakeSocket(overrides: Partial<Socket> = {}): {
    client: Socket;
    emit: jest.Mock;
    disconnect: jest.Mock;
  } {
    const emit = jest.fn();
    const disconnect = jest.fn();
    const client = {
      id: `socket-${Math.random()}`,
      handshake: { auth: {} },
      emit,
      disconnect,
      ...overrides,
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

  it('rejects unauthenticated connections in production', () => {
    process.env.NODE_ENV = 'production';
    const { client, disconnect } = fakeSocket();

    gateway.handleConnection(client);

    expect(disconnect).toHaveBeenCalledWith(true);
    expect(gateway.clientCount).toBe(0);
  });

  it('accepts connections with a valid token in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SOCKET_TOKEN = 'secret-token';
    const { client, disconnect } = fakeSocket({
      handshake: { auth: { token: 'secret-token' } },
    });

    gateway.handleConnection(client);

    expect(disconnect).not.toHaveBeenCalled();
    expect(gateway.clientCount).toBe(1);
    delete process.env.SOCKET_TOKEN;
  });
});
