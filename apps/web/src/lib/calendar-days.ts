/**
 * Calendar columns are America/Chicago dates, not the host zone.
 *
 * The page has no week-start setting. The grid starts on Monday, and
 * CronJob.day stays 0=Monday … 6=Sunday (the bridge already stores it
 * that way). Labels are the weekday of each column's date, so a
 * Sunday-start week — covered by tests, not a setting — still names
 * the column for that date.
 *
 * A clock time is Chicago wall time. 23:30 on a Chicago day stays on
 * that day when the UTC date has already moved on, including across
 * the November fall-back.
 */

import { chicagoDay } from './chicago-day'

const CHICAGO = 'America/Chicago'
const LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

export type DayLabel = (typeof LABELS)[number]
/** 0 = Sunday, 1 = Monday. The calendar page uses Monday. */
export type WeekStart = 0 | 1

/** No week-start control. Monday matches CronJob.day and the bridge. */
export const WEEK_STARTS_ON: WeekStart = 1

export interface CalendarDay {
  /** YYYY-MM-DD in America/Chicago. */
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

export interface WallClock {
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
export function weekdayOf(dayKey: string): number {
  const [year, month, date] = dayKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay()
}

/** Shift a YYYY-MM-DD label by whole days. Not an instant conversion. */
export function shiftDay(dayKey: string, deltaDays: number): string {
  const [year, month, date] = dayKey.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date))
  next.setUTCDate(next.getUTCDate() + deltaDays)
  return next.toISOString().slice(0, 10)
}

export function cronDayOf(dayKey: string): number {
  return (weekdayOf(dayKey) + 6) % 7
}

export function columnOf(dayKey: string, weekStartsOn: WeekStart = WEEK_STARTS_ON): number {
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

/** Seven columns for the Chicago week that contains `anchor`. */
export function weekDays(anchor: Date | string, weekStartsOn: WeekStart = WEEK_STARTS_ON): CalendarDay[] {
  const key = typeof anchor === 'string' ? anchor : chicagoDay(anchor)
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
  return `${left} – ${right}`
}

export function formatMonthTitle(dayKey: string): string {
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

function chicagoOffsetMs(instant: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
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

/** UTC instant of a clock time on a YYYY-MM-DD America/Chicago day. */
export function chicagoWallTime(dayKey: string, hour: number, minute: number): Date {
  const [year, month, date] = dayKey.split('-').map(Number)
  let utc = Date.UTC(year, month - 1, date, hour + 6, minute, 0)
  for (let i = 0; i < 4; i++) {
    const offset = chicagoOffsetMs(new Date(utc))
    const next = Date.UTC(year, month - 1, date, hour, minute, 0) - offset
    if (next === utc) return new Date(utc)
    utc = next
  }
  return new Date(utc)
}

/**
 * Chicago calendar day a wall-clock job occupies.
 * 23:30 stays on `dayKey` even when that instant's UTC date is the next day.
 */
export function placedDay(dayKey: string, time: string): string | null {
  const clock = parseClock(time)
  if (!clock) return null
  return chicagoDay(chicagoWallTime(dayKey, clock.hour, clock.minute))
}

export function chicagoClock(now: Date): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
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
): { dayKey: string; hour: number; minute: number } | null {
  const clock = parseClock(job.time)
  if (!clock) return null
  const today = chicagoDay(now)
  for (let i = 0; i < 14; i++) {
    const dayKey = shiftDay(today, i)
    if (!jobOccursOn(job, dayKey)) continue
    const at = chicagoWallTime(dayKey, clock.hour, clock.minute)
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
