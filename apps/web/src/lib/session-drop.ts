/**
 * Socket drop rules for a signed in tab (issue 115).
 */

/**
 * Reason socket.io gives when the API closed this socket on purpose.
 * The gateway does that when a revoke makes the cookie stale. An API
 * restart or a network drop gives a transport reason instead, and the
 * client reconnects on its own.
 */
export const SERVER_DROP_REASON = 'io server disconnect'

/**
 * What a signed in tab does after a socket event.
 * recheck: ask GET /auth/session again. A stale cookie then shows the
 * sign in form. Any other reason leaves the tab alone.
 */
export function sessionDropAction(reason: string): 'recheck' | 'ignore' {
  return reason === SERVER_DROP_REASON ? 'recheck' : 'ignore'
}
