/**
 * America/Chicago calendar days.
 *
 * Memory groups and the Approvals "Decided today" count use a calendar day
 * in this zone, not the server's local zone and not a rolling 24 hours.
 * 23:58 and 00:02 stay on their own days, including when Central is on CDT.
 */

const CHICAGO = 'America/Chicago';

export function chicagoDay(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * UTC instants of [midnight, next midnight) for a YYYY-MM-DD Chicago day.
 * The caller has already rejected dates that are not real calendar days.
 */
export function chicagoDayBounds(day: string): { start: Date; end: Date } {
  const start = chicagoMidnightUtc(day);
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);
  return { start, end: chicagoMidnightUtc(nextDay) };
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
  });
  const parts = fmt.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let year = pick('year');
  let month = pick('month');
  let day = pick('day');
  let hour = pick('hour');
  // A few engines report midnight as 24:00 on the previous date.
  if (hour === 24) {
    hour = 0;
    const bumped = new Date(Date.UTC(year, month - 1, day));
    bumped.setUTCDate(bumped.getUTCDate() + 1);
    year = bumped.getUTCFullYear();
    month = bumped.getUTCMonth() + 1;
    day = bumped.getUTCDate();
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, pick('minute'), pick('second'));
  return asUtc - instant.getTime();
}

/** UTC instant of a clock time on a YYYY-MM-DD America/Chicago day. */
export function chicagoWallTime(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  let utc = Date.UTC(y, m - 1, d, hour + 6, minute, 0);
  for (let i = 0; i < 4; i++) {
    const offset = chicagoOffsetMs(new Date(utc));
    const next = Date.UTC(y, m - 1, d, hour, minute, 0) - offset;
    if (next === utc) return new Date(utc);
    utc = next;
  }
  return new Date(utc);
}

/** Shift a YYYY-MM-DD calendar label by whole days. Not an instant conversion. */
export function shiftChicagoDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next.toISOString().slice(0, 10);
}

/** UTC instant of 00:00:00.000 in America/Chicago on `day` (YYYY-MM-DD). */
function chicagoMidnightUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  // 06:00 UTC is midnight CST or 1:00 AM CDT — close enough to iterate once.
  let utc = Date.UTC(y, m - 1, d, 6, 0, 0);
  for (let i = 0; i < 4; i++) {
    const offset = chicagoOffsetMs(new Date(utc));
    const next = Date.UTC(y, m - 1, d, 0, 0, 0) - offset;
    if (next === utc) return new Date(utc);
    utc = next;
  }
  return new Date(utc);
}
