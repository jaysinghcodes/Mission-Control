/**
 * Calendar columns are dates in the timezone saved on the server.
 *
 * The page has no week-start setting. The grid starts on Monday, and
 * CronJob.day stays 0=Monday … 6=Sunday (the bridge already stores it
 * that way). Labels are the weekday of each column's date, so a
 * Sunday-start week, covered by tests and not a setting, still names
 * the column for that date.
 *
 * A clock time is wall time in that zone. 23:30 stays on that calendar
 * day when the UTC date has already moved on, including across a fall-back.
 */

import { activeTimeZone, zoneDay } from './zone-day'

export { setActiveTimeZone } from './zone-day'

const LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

type DayLabel = (typeof LABELS)[number]
/** 0 = Sunday, 1 = Monday. The calendar page uses Monday. */
type WeekStart = 0 | 1

/** No week-start control. Monday matches CronJob.day and the bridge. */
export const WEEK_STARTS_ON: WeekStart = 1

export interface CalendarDay {
  /** YYYY-MM-DD in the saved timezone. */
  key: string
  label: DayLabel
  /** Day of month, 1–31. */
  date: number
  /** Month, 1–12. */
  month: number
  year: number
  /** Visual column 0–6 for the chosen week start. */
  column: number
  /** CronJob.day for this date: 0=Mon … 6=Sun. Independent of week start. */
  cronDay: number
}

interface WallClock {
  hour: number
  minute: number
}

export function parseClock(time: string | null): WallClock | null {
  if (!time) return null
  const match = time.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** Weekday of a Gregorian calendar date. 0=Sun … 6=Sat. Not an instant conversion. */
function weekdayOf(dayKey: string): number {
  const [year, month, date] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay()
}

/** Shift a YYYY-MM-DD label by whole days. Not an instant conversion. */
function shiftDay(dayKey: string, deltaDays: number): string {
  const [year, month, date] = dayKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date))
  next.setUTCDate(next.getUTCDate() + deltaDays)
  return next.toISOString().slice(0, 10)
}

function cronDayOf(dayKey: string): number {
  return (weekdayOf(dayKey) + 6) % 7
}

function columnOf(dayKey: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): number {
  const weekday = weekdayOf(dayKey)
  return weekStartsOn === 0 ? weekday : (weekday + 6) % 7
}

export function startOfWeekKey(dayKey: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): string {
  return shiftDay(dayKey, -columnOf(dayKey, weekStartsOn))
}

export function calendarDay(dayKey: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): CalendarDay {
  const [year, month, date] = dayKey.split('-').map(Number)
  return {
    key: dayKey,
    label: LABELS[weekdayOf(dayKey)],
    date,
    month,
    year,
    column: columnOf(dayKey, weekStartsOn),
    cronDay: cronDayOf(dayKey),
  }
}

/** Seven columns for the saved-timezone week that contains `anchor`. */
export function weekDays(anchor: Date | string, weekStartsOn: WeekStart = WEEK_STARTS_ON, timeZone: string = activeTimeZone()): CalendarDay[] {
  const key = typeof anchor === 'string' ? anchor : zoneDay(anchor, timeZone)
  const start = startOfWeekKey(key, weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => calendarDay(shiftDay(start, i), weekStartsOn))
}

export function shiftWeek(startKey: string, dir: number): string {
  return shiftDay(startKey, dir * 7)
}

function utcNoon(dayKey: string): Date {
  const [year, month, date] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date, 12))
}

function formatKey(dayKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(utcNoon(dayKey))
}

export function formatWeekRange(startKey: string): string {
  const endKey = shiftDay(startKey, 6)
  const left = formatKey(startKey, { month: 'short', day: 'numeric' })
  const right = formatKey(endKey, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${left} to ${right}`
}

function formatMonthTitle(dayKey: string): string {
  return formatKey(dayKey, { month: 'long', year: 'numeric' })
}

export function formatDayHeading(dayKey: string): string {
  return formatKey(dayKey, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function formatWeekdayLong(dayKey: string): string {
  return formatKey(dayKey, { weekday: 'long' })
}

export function formatWeekdayShort(dayKey: string): string {
  return formatKey(dayKey, { weekday: 'short' })
}

export function formatSideDate(dayKey: string): string {
  return formatKey(dayKey, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function jobOccursOn(job: { day: number | null }, dayKey: string): boolean {
  return job.day == null || job.day === cronDayOf(dayKey)
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = fmt.formatToParts(instant)
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  let year = pick('year')
  let month = pick('month')
  let day = pick('day')
  let hour = pick('hour')
  if (hour === 24) {
    hour = 0
    const bumped = new Date(Date.UTC(year, month - 1, day))
    bumped.setUTCDate(bumped.getUTCDate() + 1)
    year = bumped.getUTCFullYear()
    month = bumped.getUTCMonth() + 1
    day = bumped.getUTCDate()
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, pick('minute'), pick('second'))
  return asUtc - instant.getTime()
}

/** UTC instant of a clock time on a YYYY-MM-DD day in `timeZone`. */
export function zoneWallTime(dayKey: string, hour: number, minute: number, timeZone: string = activeTimeZone()): Date {
  const [year, month, date] = dayKey.split('-').map(Number)
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') {
    return new Date(Date.UTC(year, month - 1, date, hour, minute, 0, 0))
  }
  let utc = Date.UTC(year, month - 1, date, hour, minute, 0)
  for (let i = 0; i < 4; i++) {
    const offset = zoneOffsetMs(new Date(utc), timeZone)
    const next = Date.UTC(year, month - 1, date, hour, minute, 0) - offset
    if (next === utc) return new Date(utc)
    utc = next
  }
  return new Date(utc)
}

/**
 * Calendar day a wall-clock job occupies in the saved timezone.
 * 23:30 stays on `dayKey` even when that instant's UTC date is the next day.
 */
export function placedDay(dayKey: string, time: string, timeZone: string = activeTimeZone()): string | null {
  const clock = parseClock(time)
  if (!clock) return null
  return zoneDay(zoneWallTime(dayKey, clock.hour, clock.minute, timeZone), timeZone)
}

export function zoneClock(now: Date, timeZone: string = activeTimeZone()): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  let hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  if (hour === 24) hour = 0
  return { hour, minute }
}

export function nextOccurrence(
  job: { day: number | null; time: string | null },
  now: Date,
  timeZone: string = activeTimeZone(),
): { dayKey: string; hour: number; minute: number } | null {
  const clock = parseClock(job.time)
  if (!clock) return null
  const today = zoneDay(now, timeZone)
  for (let i = 0; i < 14; i++) {
    const dayKey = shiftDay(today, i)
    if (!jobOccursOn(job, dayKey)) continue
    const at = zoneWallTime(dayKey, clock.hour, clock.minute, timeZone)
    if (at.getTime() > now.getTime()) return { dayKey, hour: clock.hour, minute: clock.minute }
  }
  return null
}

export function monthGrid(weekStartKey: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): {
  title: string
  header: DayLabel[]
  cells: { day: CalendarDay; inMonth: boolean }[]
} {
  const year = Number(weekStartKey.slice(0, 4))
  const month = Number(weekStartKey.slice(5, 7))
  const first = `${weekStartKey.slice(0, 7)}-01`
  const start = startOfWeekKey(first, weekStartsOn)
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = calendarDay(shiftDay(start, i), weekStartsOn)
    return { day, inMonth: day.month === month && day.year === year }
  })
  return {
    title: formatMonthTitle(first),
    header: cells.slice(0, 7).map((cell) => cell.day.label),
    cells,
  }
}

/** True when every column's weekday label is the weekday of that column's date. */
export function labelsMatchDates(days: CalendarDay[]): boolean {
  return days.every((day) => {
    const [year, month, date] = day.key.split('-').map(Number)
    return day.label === LABELS[weekdayOf(day.key)] && day.year === year && day.month === month && day.date === date
  })
}
