/**
 * Calendar day in the timezone saved on the server.
 * Memory labels, Approvals "Decided today", and the calendar
 * use this zone. The API buckets memory on the same zone.
 * The provider sets it from GET /settings before pages render.
 */

let activeZone = 'UTC'

export function setActiveTimeZone(zone: string) {
  const text = zone.trim()
  if (text) activeZone = text
}

export function activeTimeZone(): string {
  return activeZone
}

export function zoneDay(input: Date | string | number, timeZone: string = activeTimeZone()): string {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** How many rows fall on today's calendar day in the active timezone. */
export function countOnZoneDay(
  rows: { createdAt: string }[],
  now: Date = new Date(),
  timeZone: string = activeTimeZone(),
): number {
  const today = zoneDay(now, timeZone)
  if (!today) return 0
  let count = 0
  for (const row of rows) {
    if (zoneDay(row.createdAt, timeZone) === today) count += 1
  }
  return count
}

export function formatZoneClock(iso: string, timeZone: string = activeTimeZone()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** Reader line. The zone abbreviation separates the two 1:30 AM instants on a fall-back night. */
export function formatZoneSaved(iso: string, timeZone: string = activeTimeZone()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

export function formatZoneDayHeading(day: string, now: Date = new Date(), timeZone: string = activeTimeZone()): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)))
  return day === zoneDay(now, timeZone) ? `Today · ${label}` : label
}

export function timeZoneNames(current: string): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const names = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : []
  const unique = new Set(names)
  if (current) unique.add(current)
  return [...unique].sort((a, b) => a.localeCompare(b))
}
