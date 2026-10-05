/**
 * API_URL — the ONE place the web app decides where the API lives
 * (QA-1 polish item 7 / QA-3).
 *
 * Every consumer — REST (useApi/apiSend), the Socket.IO live feed, the
 * top-bar heartbeat, search, the Connect probe — reads it from here, so a
 * stack moved to another port (compose `MC_API_PORT=3200`, which bakes
 * `VITE_API_URL=http://localhost:3200` into the bundle) is honoured
 * everywhere at once. Before this, the sidebar still advertised a hardcoded
 * `ws://…:3000` while the app was talking to :3200.
 *
 * Vite inlines `import.meta.env.VITE_API_URL` at BUILD time. Local dev falls
 * back to the NestJS default port. A trailing slash is trimmed so
 * `${API_URL}/tickets` never becomes `//tickets`.
 */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

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
