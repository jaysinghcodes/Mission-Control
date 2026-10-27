import { wireText } from '../wire-text';
import {
  calendarDay,
  mergeProviders,
  providerList,
  shiftCalendarDay,
  type UsageProvider,
} from './aggregate-usage';
import { usageRetentionDays } from '../time/runtime';
import { usageTimeZone } from './zone-time';

export interface UsageBucketWrite {
  day: string;
  at: Date;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: UsageProvider[];
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function readPoint(value: unknown): {
  at: Date;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: UsageProvider[];
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const at = new Date(wireText(raw.at ?? ''));
  if (Number.isNaN(at.getTime())) return null;
  return {
    at,
    totalCost: num(raw.totalCost),
    tokensIn: Math.round(num(raw.tokensIn)),
    tokensOut: Math.round(num(raw.tokensOut)),
    providers: providerList(raw.providers as UsageProvider[] | null),
  };
}

/**
 * Points from a `usage.snapshot` payload.
 *
 * A `points` array, or one object with `at`, is stored. A period total
 * (`period: "7d"` and no timestamp) is ignored so the bridge cannot post
 * a separate 7 day or month number.
 */
function pointsFromPayload(payload: Record<string, unknown>) {
  if (Array.isArray(payload.points)) {
    return payload.points
      .map(readPoint)
      .filter((point): point is NonNullable<typeof point> => point !== null);
  }
  if (payload.at != null) {
    const one = readPoint(payload);
    return one ? [one] : [];
  }
  return [];
}

/**
 * Group points onto calendar days in `timeZone` (the saved zone, or the server zone).
 * Only the last `USAGE_RETENTION_DAYS` days through today are kept (default 30).
 * A point after `now` is dropped.
 */
export function usageBucketsFromPayload(
  payload: Record<string, unknown>,
  now: Date = new Date(),
  timeZone: string = usageTimeZone(),
): UsageBucketWrite[] {
  const nowMs = now.getTime();
  const today = calendarDay(now, timeZone);
  const oldest = shiftCalendarDay(today, -(usageRetentionDays() - 1));
  const byDay = new Map<string, UsageBucketWrite>();
  for (const point of pointsFromPayload(payload)) {
    if (point.at.getTime() > nowMs) continue;
    const day = calendarDay(point.at, timeZone);
    if (day < oldest || day > today) continue;
    const prev = byDay.get(day);
    if (!prev) {
      byDay.set(day, { day, ...point, totalCost: round4(point.totalCost) });
      continue;
    }
    const at = point.at.getTime() >= prev.at.getTime() ? point.at : prev.at;
    byDay.set(day, {
      day,
      at,
      totalCost: round4(prev.totalCost + point.totalCost),
      tokensIn: prev.tokensIn + point.tokensIn,
      tokensOut: prev.tokensOut + point.tokensOut,
      providers: mergeProviders([prev.providers, point.providers]),
    });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
