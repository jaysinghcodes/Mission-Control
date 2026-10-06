import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { webOrigins } from '../cors-origins';

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
  | 'memory.snapshot';

/**
 * LiveActivityGateway — realtime event bus for Mission Control.
 *
 * Clients (the web dashboard) connect over Socket.IO and receive activity
 * events (scheduled run status, agent state changes, health ticks) without
 * polling. This is the transport PR 3 wires the frontend into.
 *
 * Security (vibe-dev-workflow red lines — GLM review 🔴 #2):
 *  - In production (NODE_ENV=production), connections WITHOUT a valid
 *    SOCKET_TOKEN in the handshake are rejected at connect time. This guard
 *    makes it impossible to accidentally ship an open socket.
 *  - In dev, connections are allowed freely (localhost only by default).
 *  - The gateway only emits server-authored events; it never echoes
 *    client-supplied payloads.
 */
@WebSocketGateway({
  cors: {
    origin: webOrigins(),
    credentials: false,
  },
})
export class LiveActivityGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** Socket.IO server instance — used to broadcast to all connected clients. */
  @WebSocketServer()
  server!: Server;

  /** Connected client ids — a Set is enough; per-client state comes later. */
  private readonly connectedClients = new Set<string>();

  /**
   * Fired on every new socket connection. Rejects unauthenticated clients in
   * production; otherwise registers and greets the client.
   * @param client the connecting socket
   */
  handleConnection(client: Socket): void {
    // Production guard: require SOCKET_TOKEN in the handshake auth payload.
    if (process.env.NODE_ENV === 'production') {
      const token = client.handshake.auth?.token;
      if (!token || token !== process.env.SOCKET_TOKEN) {
        // eslint-disable-next-line no-console
        console.warn('[socket] rejected unauthenticated connection in production');
        client.disconnect(true);
        return;
      }
    }

    this.connectedClients.add(client.id);
    // Tell the new client we're alive; heartbeat pattern for the UI's status dot.
    client.emit('hello', { ts: Date.now(), message: 'mission-control api connected' });
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
    this.server.emit(type, { ...payload, ts: Date.now() });
  }

  /** Number of currently connected dashboard clients (for /health). */
  get clientCount(): number {
    return this.connectedClients.size;
  }
}
