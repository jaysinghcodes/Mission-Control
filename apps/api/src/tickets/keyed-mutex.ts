/**
 * KeyedMutex — a tiny in-process FIFO lock, one queue per key (ticket id).
 *
 * Why this exists (QA finding B on PR #20):
 *   Two PATCHes for the same ticket fired in parallel (e.g. → build and
 *   → done) both returned 200, but a re-GET showed `build` in 3/10 runs: the
 *   request the server received FIRST sometimes committed LAST, because each
 *   handler did its own async read-then-write with nothing ordering them.
 *
 * Product acceptance (Atlas): "the last write must win, and the UI must match
 * the server after a refresh". So writes to one ticket are serialized in the
 * order the handler is entered:
 *
 *   - `run(key, fn)` is called SYNCHRONOUSLY at the top of the handler (no
 *     `await` before it), so queue position == order Nest dispatched the
 *     requests == order the server received them.
 *   - Each `fn` only starts after the previous `fn` for the same key has fully
 *     settled (resolved OR rejected), so the last-received write is always the
 *     last one committed.
 *   - Different keys never wait on each other.
 *
 * Scope / limits (documented, not hidden):
 *   - IN-PROCESS ONLY. The queue lives in this Node process's memory, so the
 *     "last-received write wins" guarantee holds for ONE api instance — which
 *     is exactly what docker-compose.yml runs today (a single `api` service).
 *   - Multiple api instances (replicas / horizontal scaling) would each have
 *     their own queue, so requests landing on different instances are NOT
 *     ordered by receive time. That setup would need a DB-level ordering lock
 *     instead (e.g. a Postgres advisory lock per ticket, or an optimistic
 *     `version` column compare-and-set — the latter is a schema change).
 *   - The controller's `SELECT … FOR UPDATE` row lock is a safety net, not a
 *     replacement: it stops two transactions interleaving a read-modify-write
 *     on the same row, but across instances "last" then means "last to get
 *     the row lock", not "last received".
 *   - No schema change needed for the single-instance fix — see PR #20 body.
 */
export class KeyedMutex {
  /** Tail of each key's queue: resolves when the most recently queued job is done. */
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Queue `fn` behind every earlier job for `key` and return its result.
   * Errors from `fn` propagate to THIS caller only; they never poison the
   * queue for the next job.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Whatever was last in line for this key (or an already-settled promise).
    const previous = this.tails.get(key) ?? Promise.resolve();

    // `done` settles when OUR job finishes; it becomes the new tail so the
    // next caller waits for us. It never rejects, so the chain stays alive.
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => done);
    this.tails.set(key, tail);

    return previous.then(fn).finally(() => {
      release();
      // Drop the map entry once the queue drains so the map does not grow
      // with every ticket id ever touched. Only delete if nobody queued
      // behind us in the meantime (their tail would have replaced ours).
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }

  /** Number of keys with work queued or running (exposed for tests). */
  get activeKeys(): number {
    return this.tails.size;
  }
}
