/**
 * Agent ingest keeps x-ingest-token. Everything else the dashboard can call
 * is a session route when the peer is not loopback, except ticket create
 * and ticket update, which also accept the ingest token.
 *
 * Ingest is register, heartbeat, run create and update, and bridge sync
 * (POST /events). Delete of an agent is a dashboard write. There is no
 * ticket delete route.
 */

export function requestPath(url: string | undefined): string {
  const raw = typeof url === 'string' && url.length > 0 ? url : '/';
  const path = raw.split('?')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path.startsWith('/') ? path : `/${path}`;
}

export function isIngestWrite(
  method: string,
  url: string | undefined,
): boolean {
  const m = method.toUpperCase();
  const path = requestPath(url);
  if (m === 'POST' && path === '/events') return true;
  if (m === 'POST' && path === '/agents/register') return true;
  if (m === 'POST' && /^\/agents\/[^/]+\/heartbeat$/.test(path)) return true;
  if (m === 'POST' && path === '/runs') return true;
  if (m === 'PATCH' && /^\/runs\/[^/]+$/.test(path)) return true;
  return false;
}

/**
 * Ticket create and a single ticket update. There is no DELETE /tickets
 * route. These are not ingest writes: loopback and a session cookie still
 * open them without the header.
 */
export function isAgentTicketWrite(
  method: string,
  url: string | undefined,
): boolean {
  const m = method.toUpperCase();
  const path = requestPath(url);
  if (m === 'POST' && path === '/tickets') return true;
  if (m === 'PATCH' && /^\/tickets\/[^/]+$/.test(path)) return true;
  return false;
}

export function isAuthRoute(method: string, url: string | undefined): boolean {
  const m = method.toUpperCase();
  const path = requestPath(url);
  if (m === 'POST' && path === '/auth/login') return true;
  if (m === 'POST' && path === '/auth/logout') return true;
  if (m === 'POST' && path === '/auth/login-reset') return true;
  if (m === 'GET' && path === '/auth/session') return true;
  return false;
}

/** Session cookie does not apply. These routes use their own rules. */
export function skipsSession(method: string, url: string | undefined): boolean {
  return isAuthRoute(method, url) || isIngestWrite(method, url);
}
