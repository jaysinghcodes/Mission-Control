/**
 * Usage windows. `month` is the calendar month to date in UTC, not the
 * trailing 30 days. The bridge uses the same cutoff when it posts
 * usage.snapshot.
 */
export function monthStartUtc(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
