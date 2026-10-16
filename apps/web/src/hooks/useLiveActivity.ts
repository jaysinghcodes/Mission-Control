import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { socketUrl } from '../lib/apiBase';

/**
 * Live activity event shape pushed by the API gateway.
 * Mirrors the broadcast payloads from apps/api (live-activity.gateway.ts).
 */
export interface ActivityEvent {
  type: string; // e.g. 'run.started' | 'run.completed' | 'hello'
  ts: number; // server timestamp (ms epoch) — client falls back to Date.now()
  [key: string]: unknown; // event-specific fields
}

/**
 * useLiveActivity — subscribes to the Mission Control Socket.IO feed.
 *
 * Connection lifecycle:
 * connects to the API (VITE_API_URL, or this page when that is unset) on mount
 *  - auto-reconnects on drop (socket.io built-in)
 *  - surfaces connection state so the UI can show an honest status dot
 *    (green = connected, red = disconnected — no fake "online")
 *
 * QA-1 polish item 5 — no StrictMode websocket warning:
 *  React 18+ StrictMode (main.tsx) mounts → unmounts → re-mounts every effect
 *  in dev. Opening the socket synchronously meant the first mount's socket
 *  was torn down while its WebSocket handshake was still CONNECTING, which
 *  the browser reports on every load as "WebSocket is closed before the
 *  connection is established". Fix: create the socket with
 *  `autoConnect: false` and start it on a 0 ms timer. StrictMode's
 *  throw-away mount is cleaned up synchronously, before that timer fires, so
 *  its socket never touches the network; only the real mount connects.
 *  Cleanup is idempotent: cancel the timer if pending, else disconnect.
 *
 * GLM review fixes (🟡 #5, #6):
 *  - Server ts is preserved (payload.ts wins; Date.now() is only a fallback)
 *  - maxEvents is read via ref so the socket never reconnects on re-render
 *
 * @returns { events, connected } — recent activity events + connection state
 */
export function useLiveActivity(maxEvents = 50): { events: ActivityEvent[]; connected: boolean } {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);

  // Ref keeps the cap stable without re-triggering the effect on re-renders.
  const maxEventsRef = useRef(maxEvents);
  maxEventsRef.current = maxEvents;

  useEffect(() => {
    // Same origin by default (nginx or Vite proxies /socket.io). An explicit
    // VITE_API_URL connects there instead (lib/apiBase).
    const socketOptions = {
      transports: ['websocket'] as ('websocket')[],
      // Item 5: do NOT dial in the constructor. See the deferred connect below.
      autoConnect: false,
      withCredentials: true,
    };
    const explicit = socketUrl();
    const socket: Socket = explicit ? io(explicit, socketOptions) : io(socketOptions);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Any server-authored event type lands here; keep the most recent N.
    // Shape: prefer the server's ts if present (it is authoritative), only
    // fall back to the client clock for events without one.
    socket.onAny((type: string, payload: unknown) => {
      const data =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      const ts = typeof data.ts === 'number' ? data.ts : Date.now();
      setEvents((prev) => [{ type, ts, ...data }, ...prev].slice(0, maxEventsRef.current));
    });

    // Item 5: dial on the next macrotask. If this effect is StrictMode's
    // throw-away mount, the cleanup below runs first and cancels the timer, so
    // no half-open WebSocket is ever created (and none is closed mid-handshake).
    const connectTimer = setTimeout(() => socket.connect(), 0);

    return () => {
      clearTimeout(connectTimer);
      // Listeners off first so a late 'disconnect' can't setState after unmount.
      socket.removeAllListeners();
      socket.offAny();
      // Safe whether or not connect() ever ran (no-op on a never-opened socket).
      socket.disconnect();
    };
  }, []);

  return { events, connected };
}
