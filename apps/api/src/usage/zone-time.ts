/**
 * Calendar helpers for whatever zone the caller names.
 * Usage days use the API process zone until Launch 8 stores a setting.
 */

export function usageTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // Intl can throw if the zone database is missing. UTC is the fallback.
  }
  return 'UTC';
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
