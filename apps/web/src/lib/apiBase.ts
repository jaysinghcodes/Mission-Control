/**
 * API_URL is where reads, the socket, the top bar heartbeat, search, and
 * the Connect probe reach the API.
 *
 * Writes do not use this URL. They use writeUrl() so the browser stays on
 * the same origin and the dev proxy or nginx attaches the write token.
 * The token is not read here and is not stored in the browser.
 *
 * Vite inlines `import.meta.env.VITE_API_URL` at build time. Local dev falls
 * back to the NestJS default port. A trailing slash is trimmed so
 * `${API_URL}/tickets` never becomes `//tickets`.
 *
 * A stack moved to another port (compose `MC_API_PORT=3200`, which bakes
 * `VITE_API_URL=http://localhost:3200` into the bundle) is honoured by
 * every read and by the socket.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/**
 * Same origin path for POST, PUT, PATCH, and DELETE.
 * Dev: Vite proxies `/api` and sets `x-ingest-token` from the server env.
 * Compose: nginx does the same. The page never sees the token.
 */
export function writeUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `/api${suffix}`
}

/**
 * Short, honest label for the live-feed endpoint, e.g. `ws://…:3200`
 * (scheme follows http→ws / https→wss; host elided to keep the narrow
 * sidebar readable). Falls back to the raw URL if it cannot be parsed.
 */
export function socketLabel(url: string = API_URL): string {
  try {
    const u = new URL(url)
    const scheme = u.protocol === 'https:' ? 'wss' : 'ws'
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return `${scheme}://…:${port}`
  } catch {
    return url
  }
}
