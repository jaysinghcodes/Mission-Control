import { OnModuleDestroy } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { mkdirSync, watch, type FSWatcher } from 'fs';
import { dirname } from 'path';
import { Server, Socket } from 'socket.io';
import { webOrigins } from '../cors-origins';
import { requestLoopback, validSession } from '../auth/session';
import { sessionStatePath } from '../auth/session-state';

/**
 * Event types the gateway may broadcast. Union type so callers can't
 * invent arbitrary event names (GLM review 🟡 #4).
 *
 * v2 additions: run.queued / run.progress (task lifecycle), approval.*
 * (review & gate), and the * .snapshot events the OpenClaw bridge pushes
 * to sync real state (agents, sessions, calendar, usage, approvals).
 *
 * v3 additions (MC-212, real-time bridge): message.sent / message.received
 * (chat), session.patch (session edits), command.new (slash commands), and
 * run.running / run.done aliases so hooks using the documented MC-212 names
 * are accepted alongside the legacy run.started / run.completed.
 */
export type ActivityEventType =
  | 'run.started'
  | 'run.queued'
  | 'run.running'
  | 'run.progress'
  | 'run.completed'
  | 'run.done'
  | 'run.failed'
  | 'health.tick'
  | 'hello'
  | 'message.sent'
  | 'message.received'
  | 'session.patch'
  | 'command.new'
  | 'approval.new'
  | 'approval.decided'
  | 'agents.snapshot'
  | 'sessions.snapshot'
  | 'calendar.snapshot'
  | 'usage.snapshot'
  | 'approvals.snapshot'
  | 'memory.snapshot'
  | 'models.snapshot'
  | 'devices.snapshot'
  | 'gateway.snapshot'
  | 'agent.status';

/**
 * LiveActivityGateway — realtime event bus for Mission Control.
 *
 * Clients (the web dashboard) connect over Socket.IO and receive activity
 * events (scheduled run status, agent state changes, health ticks) without
 * polling. This is the transport PR 3 wires the frontend into.
 *
 * Security:
 *  - Off loopback, the handshake must carry the dashboard session cookie.
 *    Loopback is the socket address. A forwarded header does not count.
 *    The tunnel listener tag from bundled nginx is never loopback.
 *    The web bundle does not contain a socket token.
 *  - The gateway only emits server-authored events; it never echoes
 *    client-supplied payloads.
 */
@WebSocketGateway({
  cors: {
    origin: webOrigins(),
    credentials: true,
  },
})
export class LiveActivityGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  /** Socket.IO server instance — used to broadcast to all connected clients. */
  @WebSocketServer()
  server!: Server;

  /** Connected client ids — a Set is enough; per-client state comes later. */
  private readonly connectedClients = new Set<string>();

  /** Closes remote sockets when password:reset replaces the session file. */
  private sessionWatch: FSWatcher | null = null;

  afterInit(): void {
    this.watchSessionState();
  }

  onModuleDestroy(): void {
    this.sessionWatch?.close();
    this.sessionWatch = null;
  }

  /**
   * password:reset writes the session file from another process.
   * A change drops remote sockets the same way a password change does.
   */
  private watchSessionState(): void {
    const file = sessionStatePath();
    const dir = dirname(file);
    try {
      mkdirSync(dir, { recursive: true });
      const watcher = watch(dir, () => {
        try {
          this.dropRevokedSockets();
        } catch {
          // The next request still reads the new version from the file.
        }
      });
      watcher.on('error', () => {
        watcher.close();
        if (this.sessionWatch === watcher) this.sessionWatch = null;
      });
      watcher.unref();
      this.sessionWatch = watcher;
    } catch {
      this.sessionWatch = null;
    }
  }

  /**
   * Fired on every new socket connection. Rejects unauthenticated clients in
   * production; otherwise registers and greets the client.
   * @param client the connecting socket
   */
  handleConnection(client: Socket): void {
    if (!socketAllowed(client)) {
      console.warn('[socket] rejected unauthenticated connection');
      client.disconnect(true);
      return;
    }

    this.connectedClients.add(client.id);
    // Tell the new client we're alive; heartbeat pattern for the UI's status dot.
    client.emit('hello', {
      ts: Date.now(),
      message: 'mission-control api connected',
    });
  }

  /**
   * Fired on disconnect; cleans up the client registry.
   * @param client the disconnecting socket
   */
  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
  }

  /**
   * Broadcast an activity event to every connected dashboard.
   * @param type   one of the typed event names (no arbitrary strings)
   * @param payload event payload (must be JSON-serializable)
   */
  broadcast(type: ActivityEventType, payload: Record<string, unknown>): void {
    // init() can broadcast before the socket server is attached. A throw
    // here would reset the HTTP socket of the write that already committed.
    if (!this.server) return;
    try {
      this.server.emit(type, { ...payload, ts: Date.now() });
    } catch {
      // The ticket or run is already stored. A dead socket is not a 500.
    }
  }

  /**
   * Drop sockets whose cookie no longer matches the session version.
   * Loopback stays connected. A revoked remote socket is closed the same
   * way as a handshake with no cookie.
   */
  dropRevokedSockets(): void {
    const sockets = this.server?.sockets?.sockets;
    if (!sockets) return;
    for (const client of sockets.values()) {
      if (socketAllowed(client)) continue;
      client.disconnect(true);
      this.connectedClients.delete(client.id);
    }
  }

  /** Number of currently connected dashboard clients (for /health). */
  get clientCount(): number {
    return this.connectedClients.size;
  }
}

function socketAllowed(client: Socket): boolean {
  const headers = client.handshake?.headers ?? {};
  const cookie = headers.cookie;
  const forwarded = headers['x-forwarded-for'];
  const realIp = headers['x-real-ip'];
  const remote = headers['x-mc-remote'];
  const connecting = headers['cf-connecting-ip'];
  if (
    requestLoopback({
      socket: { remoteAddress: client.handshake?.address },
      headers: {
        cookie,
        'x-forwarded-for': forwarded,
        'x-real-ip': realIp,
        'x-mc-remote': remote,
        'cf-connecting-ip': connecting,
      },
    })
  ) {
    return true;
  }
  return validSession(cookie);
}
