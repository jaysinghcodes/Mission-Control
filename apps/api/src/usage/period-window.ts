/**
 * UTC month start. Aggregation tests use this for the UTC window.
 * The System page displays America/Chicago, not this instant.
 */
export function monthStartUtc(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** Human label for a usage period. `24h` is a rolling day, not the calendar date. */
export function usagePeriodLabel(period: string): string {
  if (period === '24h') return 'Last 24 hours'
  if (period === '7d') return 'Last 7 days'
  if (period === 'month') return 'Month to date'
  return period
}
