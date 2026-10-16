/**
 * API_URL is where reads, the top bar heartbeat, search, and the Connect
 * probe reach the API.
 *
 * Writes do not use this URL. They use writeUrl() so the browser stays on
 * the same origin and the dev proxy or nginx attaches the write token.
 * The token is not read here and is not stored in the browser.
 *
 * Vite inlines `import.meta.env.VITE_API_URL` at build time. A blank or
 * missing value means same origin: reads use `/api`, which the Vite dev
 * server and nginx both proxy to the API. Set VITE_API_URL only when the
 * browser should call a different origin. A trailing slash is trimmed so
 * `${API_URL}/tickets` never becomes `//tickets`.
 */
function explicitApiOrigin(): string {
  const raw = import.meta.env.VITE_API_URL
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\/+$/, '')
}

const EXPLICIT_ORIGIN = explicitApiOrigin()

/** REST base. Explicit origin, or same origin `/api`. */
export const API_URL: string = EXPLICIT_ORIGIN || '/api'

/**
 * Socket.IO manager URL. An explicit origin connects there. The default
 * returns undefined so the client uses this page and the `/socket.io` path.
 */
export function socketUrl(): string | undefined {
  return EXPLICIT_ORIGIN || undefined
}

/** Short label for status text. Same origin uses the page origin when known. */
export function apiLabel(): string {
  if (EXPLICIT_ORIGIN) return EXPLICIT_ORIGIN
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return 'this origin'
}

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
 * Short label for the live feed endpoint. Same origin has no host here.
 * An absolute URL keeps its scheme and port.
 */
export function socketLabel(url: string = socketUrl() ?? ''): string {
  if (!url) return 'ws://this origin'
  try {
    const u = new URL(url)
    const scheme = u.protocol === 'https:' ? 'wss' : 'ws'
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    return `${scheme}://…:${port}`
  } catch {
    return url
  }
}
