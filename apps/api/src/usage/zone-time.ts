/**
 * Calendar helpers for whatever zone the caller names.
 * The stored settings timezone wins. When it is empty, the server
 * timezone is `TZ` if that name is in config/timezones.json, otherwise the host zone.
 * Legacy names (Asia/Calcutta, Europe/Kiev) convert to the current name first.
 * Offsets and abbreviations such as +02:00 and CST are not in that file.
 */

import { canonicalTimeZone } from '../time/timezones';

export function isValidTimeZone(zone: string): boolean {
  return canonicalTimeZone(zone) !== null;
}

/** Process timezone. `TZ=Europe/Berlin` wins when that name is in the list. */
export function serverTimeZone(): string {
  const fromEnv = canonicalTimeZone(process.env.TZ ?? '');
  if (fromEnv) return fromEnv;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const host = zone ? canonicalTimeZone(zone) : null;
    if (host) return host;
  } catch {
    // Intl can throw if the zone database is missing. UTC is the fallback.
  }
  return 'UTC';
}

/** Saved name converted to the current zone, or the server timezone when nothing is stored. */
export function resolveTimeZone(stored: string | null | undefined): string {
  return canonicalTimeZone(stored ?? '') ?? serverTimeZone();
}

export function usageTimeZone(): string {
  return serverTimeZone();
}

export function zoneDay(
  input: Date | string | number,
  timeZone: string,
): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Shift a YYYY-MM-DD label by whole calendar days. Not an instant conversion. */
export function shiftZoneDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next.toISOString().slice(0, 10);
}

/** UTC instants of [midnight, next midnight) for a YYYY-MM-DD day in `timeZone`. */
export function zoneDayBounds(
  day: string,
  timeZone: string,
): { start: Date; end: Date } {
  const start = zoneWallTime(day, 0, 0, timeZone);
  return { start, end: zoneWallTime(shiftZoneDay(day, 1), 0, 0, timeZone) };
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
  });
  const parts = fmt.formatToParts(instant);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  let year = pick('year');
  let month = pick('month');
  let day = pick('day');
  let hour = pick('hour');
  if (hour === 24) {
    hour = 0;
    const bumped = new Date(Date.UTC(year, month - 1, day));
    bumped.setUTCDate(bumped.getUTCDate() + 1);
    year = bumped.getUTCFullYear();
    month = bumped.getUTCMonth() + 1;
    day = bumped.getUTCDate();
  }
  const asUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    pick('minute'),
    pick('second'),
  );
  return asUtc - instant.getTime();
}

/** UTC instant of a clock time on a YYYY-MM-DD day in `timeZone`. */
export function zoneWallTime(
  day: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = day.split('-').map(Number);
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') {
    return new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  }
  let utc = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  for (let i = 0; i < 4; i++) {
    const offset = zoneOffsetMs(new Date(utc), timeZone);
    const next = Date.UTC(y, m - 1, d, hour, minute, 0, 0) - offset;
    if (next === utc) return new Date(utc);
    utc = next;
  }
  return new Date(utc);
}

export function zoneClock(
  now: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  return { hour, minute: pick('minute') };
}
