/**
 * America/Chicago calendar day. Memory day labels and Approvals
 * "Decided today" use this, not a rolling 24 hours and not the browser zone
 * when the two disagree. The memory list itself buckets on the API, which
 * uses the same zone.
 */

const CHICAGO = 'America/Chicago'

export function chicagoDay(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** How many rows fall on today's Chicago calendar day. */
export function countOnChicagoDay(rows: { createdAt: string }[], now: Date = new Date()): number {
  const today = chicagoDay(now)
  if (!today) return 0
  let count = 0
  for (const row of rows) {
    if (chicagoDay(row.createdAt) === today) count += 1
  }
  return count
}

export function formatChicagoClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatChicagoDayHeading(day: string, now: Date = new Date()): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)))
  return day === chicagoDay(now) ? `Today · ${label}` : label
}
