import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useApi — tiny fetch hook for the Mission Control API.
 * - data/loading/error states, refetch()
 * - optional pollMs for auto-refresh (logs, sessions, …)
 * - mutate(updater) to apply a server response locally right away (e.g. the
 *   ticket a PATCH returned) without waiting for the next poll
 * - never throws: on failure it surfaces `error: true` plus a readable
 *   `errorMessage` so pages can say WHY instead of rendering a blank page.
 *
 * QA-1 polish item 1 ("empty board after ↺ Backlog + reload") — the rules:
 *   1. `data` is ONLY ever replaced by a successful (2xx, JSON object, no
 *      legacy `{ error }` body) response from the LATEST request. A failed,
 *      aborted or superseded request never touches `data`, so a hiccup can
 *      never wipe a loaded board to "empty".
 *   2. Every new fetch ABORTS the previous in-flight one (its answer would be
 *      stale anyway), and unmount aborts whatever is left — no setState on an
 *      unmounted page, no late response painting over a newer one.
 *   3. Load failures are surfaced (`error` / `errorMessage`) and the last good
 *      `data` is kept, so pages can show "couldn't refresh" over the old data
 *      instead of silently pretending it is current.
 */
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function useApi<T>(path: string, opts: { pollMs?: number } = {}): {
  data: T | null
  loading: boolean
  error: boolean
  /** Readable reason for the latest load failure; null after a good load. */
  errorMessage: string | null
  refetch: () => void
  mutate: (updater: (prev: T | null) => T | null) => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  // One piece of state for both `error` and `errorMessage` so they can never
  // disagree (null = last load succeeded).
  const [loadError, setLoadError] = useState<string | null>(null)
  const pollMs = opts.pollMs ?? 0
  const pathRef = useRef(path)
  pathRef.current = path

  // Stale-response guard (PR #20 QA finding B, UI half): every fetch and every
  // local mutate bumps `generation`. A fetch only applies its result if no
  // newer fetch/mutate happened while it was in flight — so a slow poll that
  // left BEFORE a ticket move can never paint the pre-move state over the
  // server's post-move answer. The board therefore always converges on what
  // the server last said, and a browser refresh shows the same thing.
  const generation = useRef(0)
  // The in-flight GET, so the next refetch (or unmount) can abort it.
  const inflight = useRef<AbortController | null>(null)
  // False between unmount and (StrictMode) remount — guards every setState.
  const mounted = useRef(false)

  const refetch = useCallback(async () => {
    const mine = ++generation.current
    // Rule 2: a newer request supersedes the older one — cancel it outright.
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    // Only the latest, still-mounted request may write state.
    const current = () => mounted.current && mine === generation.current
    try {
      const res = await fetch(`${API}${pathRef.current}`, { signal: ctrl.signal })
      // Parse defensively: proxies/502 pages are often not JSON at all.
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      if (!res.ok) throw new Error(errorMessage(json, res.status))
      // Rule 1: a 2xx that is not a JSON object, or that carries the legacy
      // `{ error }` shape, is a FAILURE — never something to render as data.
      if (!json || typeof json !== 'object') throw new Error('Unexpected response from the API')
      const legacy = (json as { error?: unknown }).error
      if (typeof legacy === 'string' && legacy) throw new Error(legacy)
      if (!current()) return // superseded — drop stale data
      setData(json as T)
      setLoadError(null)
    } catch (err) {
      // Aborted = superseded or unmounted: not an error, and never a reason
      // to touch `data`. (fetch rejects with AbortError in that case.)
      if (ctrl.signal.aborted) return
      // Network failure (fetch rejected) or one of the throws above. Keep the
      // last good `data` (rule 1) and surface why (rule 3).
      if (current()) {
        const msg = err instanceof TypeError ? errorMessage(null, 0) : err instanceof Error ? err.message : String(err)
        setLoadError(msg)
      }
    } finally {
      if (inflight.current === ctrl) inflight.current = null
      // Only the request that actually settled the latest generation ends
      // the initial "loading" state; an aborted one leaves that to its
      // successor (otherwise pages would flash "empty" before data arrives).
      if (current() && !ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  const mutate = useCallback((updater: (prev: T | null) => T | null) => {
    ++generation.current // invalidate any in-flight (older) fetch
    setData((prev) => updater(prev))
  }, [])

  useEffect(() => {
    // Set in the effect body (not at declaration) so React StrictMode's
    // mount → unmount → mount dev cycle ends with mounted = true.
    mounted.current = true
    void refetch()
    const t = pollMs > 0 ? setInterval(() => void refetch(), pollMs) : null
    return () => {
      mounted.current = false
      if (t) clearInterval(t)
      // Rule 2: nothing may land after unmount.
      inflight.current?.abort()
      inflight.current = null
    }
  }, [refetch, pollMs])

  return { data, loading, error: loadError !== null, errorMessage: loadError, refetch, mutate }
}

/**
 * Result of a write request. Never thrown — always returned — so pages keep
 * the "API calls never crash the page" contract while still being able to
 * tell the user WHY something failed (QA finding E on PR #20).
 *
 * - ok: true  → 2xx; `data` is the parsed JSON body, `error` is null
 * - ok: false → `data` is null, `status` is the HTTP status (0 = network/
 *               CORS/offline) and `error` is a human-readable message from
 *               the server when it sent one (Nest HttpException `message`),
 *               else a generic one.
 *
 * A flat shape (not a discriminated union) on purpose: the web tsconfig is
 * not `strict`, and without strictNullChecks TS cannot narrow a union on a
 * boolean `ok` — so callers just check `r.ok` and read the fields.
 */
export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

/**
 * Pull a readable message out of an error body.
 * Nest HttpExceptions serialize as `{ statusCode, message, error }` where
 * `message` may be a string or (for validation pipes) a string[]. Older
 * endpoints still return `{ error: '…' }`.
 */
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown }
    if (Array.isArray(b.message)) return b.message.map(String).join('; ')
    if (typeof b.message === 'string' && b.message) return b.message
    if (typeof b.error === 'string' && b.error) return b.error
  }
  return status ? `Request failed (HTTP ${status})` : 'API unreachable — is the server running?'
}

/**
 * Core write helper: send JSON with any method and get an ApiResult back.
 *
 * Non-2xx responses are failures (obviously), and so is a 2xx whose body is a
 * bare `{ error }` — that legacy shape is what some controllers returned
 * before they adopted HttpExceptions (tickets did until PR #20; runs and
 * approvals still do), and treating it as success hid real failures.
 */
export async function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects on network-level failures (offline, CORS, DNS).
    return { ok: false, status: 0, data: null, error: errorMessage(null, 0) }
  }
  // Parse defensively — error pages (proxies, 502s) may not be JSON at all.
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) return { ok: false, status: res.status, data: null, error: errorMessage(json, res.status) }
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return { ok: false, status: res.status, data: null, error: errorMessage(json, res.status) }
  }
  return { ok: true, status: res.status, data: json as T, error: null }
}

/** Log a failed write once, so failures are visible in devtools even for
 *  callers that only look at the null return value. */
function warnFailure(method: string, path: string, r: ApiResult<unknown>): void {
  console.warn(`[api] ${method} ${path} failed (${r.status || 'network'}): ${r.error ?? 'unknown error'}`)
}

/**
 * POST helper for creating resources (tasks, tickets, decisions).
 *
 * Back-compat wrapper over apiSend: still never throws and still returns the
 * body or null, so existing callers (Approvals, Tasks, Usage) are unchanged.
 * Failures are now console.warn-ed with the server's message, and callers
 * that want to SHOW the reason can pass `onError` (or use apiSend directly).
 */
export async function apiPost<T>(path: string, body: unknown, opts: { onError?: (error: string, status: number) => void } = {}): Promise<T | null> {
  const r = await apiSend<T>('POST', path, body)
  if (r.ok) return r.data
  warnFailure('POST', path, r)
  opts.onError?.(r.error ?? 'unknown error', r.status)
  return null
}

/**
 * PATCH helper for partial updates (ticket status moves, etc.).
 *
 * Why a separate helper (not reusing apiPost):
 * - The Nest tickets controller only exposes `@Patch(':id')` for updates —
 *   there is no POST /tickets/:id. Calling apiPost here 404s and the kanban
 *   board silently fails to move cards (ONBOARDING Step 8 ticket loop).
 * - Keeping method-specific helpers makes the HTTP verb obvious at the call
 *   site and mirrors how browsers/devtools show the request.
 * - Same never-throw contract as apiPost: callers treat null as failure, and
 *   can pass `onError` to surface the server's message (400/404/…).
 */
export async function apiPatch<T>(path: string, body: unknown, opts: { onError?: (error: string, status: number) => void } = {}): Promise<T | null> {
  const r = await apiSend<T>('PATCH', path, body)
  if (r.ok) return r.data
  warnFailure('PATCH', path, r)
  opts.onError?.(r.error ?? 'unknown error', r.status)
  return null
}
