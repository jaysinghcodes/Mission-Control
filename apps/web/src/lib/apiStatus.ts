/**
 * apiStatus — one shared, app-wide answer to "can we reach the API right
 * now, and how fast?" (QA-1 polish item 7, "API-down mid-session").
 *
 * The problem it fixes: when the API died mid-session every page kept
 * showing its last data with no hint it was stale, and the top bar kept
 * saying "Connected · 74ms" — a hardcoded string. Now:
 *
 *  - Every request made through useApi / apiSend reports its OUTCOME here
 *    (reportReachable / reportUnreachable). So the first request that fails
 *    because the API is gone flips the whole app to "offline", whichever
 *    page made it, and the first one that succeeds flips it back.
 *  - AppLayout's heartbeat (GET /health every few seconds) is the only
 *    source of LATENCY (reportLatency) — a tiny, constant request is a fair
 *    round-trip measure; a /logs poll that reads files is not.
 *  - Aborted requests report NOTHING. An abort is our own doing (StrictMode's
 *    dev double-mount, a superseded refetch, leaving the page) — never
 *    evidence that the API is down. (QA-3: StrictMode aborts showed up as
 *    failures / ERR_ABORTED noise.)
 *
 * What counts as "unreachable": the fetch itself rejected (offline, refused,
 * DNS, CORS) or a gateway said the upstream is gone (502/503/504). Any
 * other HTTP answer — even a 400/404/500 — proves the API is up; those are
 * per-request errors that the page shows itself.
 *
 * Tiny external store (no context/provider needed) read through React's
 * useSyncExternalStore, so every subscriber re-renders on change.
 */
import { useSyncExternalStore } from 'react'

export type ApiReachability = 'unknown' | 'online' | 'offline'

export interface ApiStatus {
  /** 'unknown' until the first request settles. */
  state: ApiReachability
  /** Last heartbeat round-trip in ms (null until measured). */
  latencyMs: number | null
  /** Epoch ms of the last successful contact (any request). */
  lastOkAt: number | null
  /** Why the latest failure happened, when offline. */
  lastError: string | null
}

let status: ApiStatus = { state: 'unknown', latencyMs: null, lastOkAt: null, lastError: null }
const listeners = new Set<() => void>()

/** Replace the snapshot (new object = React sees the change) and notify. */
function set(patch: Partial<ApiStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

/** HTTP statuses that mean "a proxy answered, the API behind it did not". */
export function isGatewayDown(httpStatus: number): boolean {
  return httpStatus === 502 || httpStatus === 503 || httpStatus === 504
}

/** Any request got a genuine answer from the API. */
export function reportReachable(): void {
  // Avoid a notify storm: only touch the store when something changes, or
  // at most once a second for the "last contact" timestamp.
  const now = Date.now()
  if (status.state === 'online' && status.lastOkAt && now - status.lastOkAt < 1000) return
  set({ state: 'online', lastOkAt: now, lastError: null })
}

/** A request could not reach the API (NOT for aborts — see header). */
export function reportUnreachable(reason: string): void {
  if (status.state === 'offline' && status.lastError === reason) return
  set({ state: 'offline', lastError: reason })
}

/** Heartbeat round-trip (implies reachable). */
export function reportLatency(ms: number): void {
  set({ state: 'online', latencyMs: Math.round(ms), lastOkAt: Date.now(), lastError: null })
}

/**
 * Classify a finished fetch for the store. `httpStatus` 0 = the fetch
 * rejected. Callers must skip this entirely for aborted requests.
 */
export function reportOutcome(httpStatus: number, reason: string): void {
  if (httpStatus === 0 || isGatewayDown(httpStatus)) reportUnreachable(reason)
  else reportReachable()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook: the current shared API status; re-renders on change. */
export function useApiStatus(): ApiStatus {
  return useSyncExternalStore(subscribe, () => status)
}

/** True when a fetch rejection was our own abort, not a network failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
