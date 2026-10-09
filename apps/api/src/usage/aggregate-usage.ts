import { chicagoWallTime } from '../memory/chicago-day';
import { monthStartUtc } from './period-window';

/** Operator-facing calendar. Memory and Approvals use the same zone. */
export const USAGE_DISPLAY_TZ = 'America/Chicago';

const DAY_MS = 86_400_000;

export interface UsageProvider {
  name?: string;
  model?: string;
  cost?: number;
  tokensIn?: number;
  tokensOut?: number;
  agents?: string[];
}

export interface UsagePoint {
  at: Date | string | number;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers?: UsageProvider[] | Record<string, UsageProvider> | null;
}

export interface UsageDayTotal {
  day: string;
  totalCost: number;
}

export interface AggregatedUsage {
  period: string;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: UsageProvider[];
}

export interface AggregateResult {
  usage: AggregatedUsage | null;
  days: UsageDayTotal[];
  note: string | null;
  daysCovered: number;
  daysExpected: number;
  windowStart: number;
}

export function calendarDay(input: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(input);
}

/** Shift a YYYY-MM-DD label by whole calendar days. */
export function shiftCalendarDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next.toISOString().slice(0, 10);
}

/**
 * Copy when a window is missing days. Zero covered days is not a sentence:
 * the caller shows an empty range instead of a zero.
 */
export function partialUsageNote(covered: number, expected: number): string | null {
  if (covered <= 0 || expected <= 0 || covered >= expected) return null;
  const unit = covered === 1 ? 'day' : 'days';
  return `Showing ${covered} ${unit} of data so far`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function providerList(value: UsagePoint['providers']): UsageProvider[] {
  if (Array.isArray(value)) return value.filter((p) => p && typeof p === 'object');
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

export function mergeProviders(groups: UsageProvider[][]): UsageProvider[] {
  const byKey = new Map<string, UsageProvider>();
  for (const group of groups) {
    for (const raw of group) {
      const model = raw.model || raw.name || 'model';
      const prev = byKey.get(model) ?? {
        name: raw.name,
        model: raw.model ?? model,
        cost: 0,
        tokensIn: 0,
        tokensOut: 0,
        agents: [] as string[],
      };
      prev.cost = round4(num(prev.cost) + num(raw.cost));
      prev.tokensIn = Math.round(num(prev.tokensIn) + num(raw.tokensIn));
      prev.tokensOut = Math.round(num(prev.tokensOut) + num(raw.tokensOut));
      const agents = new Set([...(prev.agents ?? []), ...(raw.agents ?? [])]);
      prev.agents = [...agents];
      if (!prev.name && raw.name) prev.name = raw.name;
      byKey.set(model, prev);
    }
  }
  return [...byKey.values()].sort((a, b) => (a.model || '').localeCompare(b.model || ''));
}

function expectedDays(period: string, now: Date, timeZone: string): string[] {
  const today = calendarDay(now, timeZone);
  if (period === '7d') {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) days.push(shiftCalendarDay(today, -i));
    return days;
  }
  if (period === 'month') {
    const month = today.slice(0, 7);
    const days: string[] = [];
    let cursor = `${month}-01`;
    while (cursor <= today) {
      days.push(cursor);
      cursor = shiftCalendarDay(cursor, 1);
    }
    return days;
  }
  return [today];
}

function startOfDay(day: string, timeZone: string): number {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') {
    return Date.parse(`${day}T00:00:00.000Z`);
  }
  return chicagoWallTime(day, 0, 0).getTime();
}

function blank(nowMs: number): AggregateResult {
  return {
    usage: null,
    days: [],
    note: null,
    daysCovered: 0,
    daysExpected: 0,
    windowStart: nowMs,
  };
}

/**
 * Sum timestamped points into a System window.
 *
 * `24h` is a rolling day (inclusive of the instant 24h ago). `7d` is the
 * last 7 calendar days through today in `timeZone`. `month` is that
 * timezone's calendar month to date. A day with no point is absent, not zero.
 */
export function aggregateUsage(
  points: UsagePoint[],
  period: string,
  nowMs: number,
  timeZone: string,
): AggregateResult {
  if (period !== '24h' && period !== '7d' && period !== 'month') return blank(nowMs);
  const now = new Date(nowMs);
  const calendar = expectedDays(period, now, timeZone);
  const windowStart = period === '24h'
    ? nowMs - DAY_MS
    : period === 'month' && (timeZone === 'UTC' || timeZone === 'Etc/UTC')
      ? monthStartUtc(nowMs)
      : startOfDay(calendar[0], timeZone);
  const allowed = new Set(calendar);

  const included = points.filter((point) => {
    const at = new Date(point.at).getTime();
    if (!Number.isFinite(at) || at > nowMs) return false;
    if (period === '24h') return at >= windowStart;
    return allowed.has(calendarDay(new Date(at), timeZone));
  });

  const daysExpected = period === '24h' ? 1 : calendar.length;
  if (included.length === 0) {
    return {
      usage: null,
      days: [],
      note: null,
      daysCovered: 0,
      daysExpected,
      windowStart,
    };
  }

  const byDay = new Map<string, { totalCost: number; tokensIn: number; tokensOut: number; providers: UsageProvider[] }>();
  for (const point of included) {
    const day = calendarDay(new Date(point.at), timeZone);
    const providers = providerList(point.providers);
    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, {
        totalCost: num(point.totalCost),
        tokensIn: Math.round(num(point.tokensIn)),
        tokensOut: Math.round(num(point.tokensOut)),
        providers,
      });
    } else {
      prev.totalCost += num(point.totalCost);
      prev.tokensIn += Math.round(num(point.tokensIn));
      prev.tokensOut += Math.round(num(point.tokensOut));
      prev.providers = mergeProviders([prev.providers, providers]);
    }
  }

  const ordered = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const days = ordered.map(([day, row]) => ({ day, totalCost: round4(row.totalCost) }));
  const daysCovered = byDay.size;
  return {
    usage: {
      period,
      totalCost: round4([...byDay.values()].reduce((sum, row) => sum + row.totalCost, 0)),
      tokensIn: [...byDay.values()].reduce((sum, row) => sum + row.tokensIn, 0),
      tokensOut: [...byDay.values()].reduce((sum, row) => sum + row.tokensOut, 0),
      providers: mergeProviders(ordered.map(([, row]) => row.providers)),
    },
    days,
    note: period === '24h' ? null : partialUsageNote(daysCovered, daysExpected),
    daysCovered,
    daysExpected,
    windowStart,
  };
}
