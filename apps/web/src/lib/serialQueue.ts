/**
 * createSerialQueue — run async jobs one at a time, in submit order, and
 * NEVER drop one (QA-1 #1, Atlas blocker on PR #20).
 *
 * Why this exists:
 *   The Tickets and Backlog "+ New ticket" handlers used to start with
 *   `if (!title || busy) return`. When a create was still in flight (any POST
 *   slower than the gap between two clicks — QA saw it with creates ~1 s
 *   apart) the second submit hit that guard and silently returned: no
 *   request, no error. Worse, when the FIRST request then finished it ran
 *   `setTitle('')`, wiping the second title the user had just typed. Net
 *   effect: the second ticket was never saved and nothing told the user.
 *
 * The fix is to QUEUE instead of IGNORE:
 *   - `run(job)` always accepts the job. It starts once every earlier job has
 *     settled (resolved OR rejected), so creates still reach the API one at a
 *     time, in the order the user submitted them. (Sequential on purpose:
 *     keys come out in the order the user typed the tickets. Key UNIQUENESS
 *     is the server's job — since QA-1 polish item 4 POST /tickets allocates
 *     MAX(MC-N)+1 under a Postgres advisory lock — so this queue is now an
 *     ordering/UX guarantee that complements that lock, not the only thing
 *     standing between parallel creates and duplicate keys.)
 *   - A failing job rejects only its own caller; the queue keeps going.
 *   - The returned promise settles with that job's own result, so the caller
 *     can report success/failure for exactly that title.
 *
 * Dependency-free on purpose so it can be unit-tested with plain `node
 * --test` (see apps/web/test/serialQueue.test.mjs) — the web app has no test
 * framework yet.
 */
export interface SerialQueue {
  /** Queue `job` behind all earlier jobs; resolves/rejects with its result. */
  run<T>(job: () => Promise<T>): Promise<T>
  /** Jobs queued or running right now (0 when idle). */
  readonly pending: number
}

export function createSerialQueue(): SerialQueue {
  // Tail of the chain: settles when the most recently queued job settles.
  // It never rejects (errors are swallowed HERE only, not for the caller),
  // so one failed job can never stall everything queued behind it.
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0

  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      pending++
      const result = tail.then(job)
      tail = result.catch(() => undefined)
      return result.finally(() => {
        pending--
      })
    },
    get pending() {
      return pending
    },
  }
}

/**
 * ticketCreateQueue — the ONE queue every "+ New ticket" handler shares.
 *
 * Module-level (not a per-page useRef) on purpose: Tickets and Backlog both
 * create tickets, and if the user submits on Backlog then jumps to Tickets
 * and submits again, a per-page queue would let those two POSTs overlap and
 * land in either order. One shared queue keeps every create from this tab
 * strictly one-at-a-time, in submit order.
 *
 * Division of labour with the API (QA-1 polish item 4): the server now
 * allocates `MC-<max+1>` inside a transaction holding a Postgres advisory
 * lock (apps/api/src/tickets/tickets.controller.ts allocateKeyAndCreate), so
 * keys stay unique across tabs and api replicas (anything taking the same
 * lock). This queue adds what the lock cannot: predictable order and one
 * request at a time from this tab. (A DB unique constraint on "Ticket"."key" is proposed separately.)
 */
export const ticketCreateQueue: SerialQueue = createSerialQueue()
