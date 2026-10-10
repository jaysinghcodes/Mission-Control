import { chicagoDay, shiftChicagoDay } from '../memory/chicago-day';
import { aggregateUsage } from './aggregate-usage';
import { demoUsageBuckets } from './demo-usage';

/** 07:58 and 23:30 America/Chicago on 2026-10-10 (CDT). */
const MORNING = new Date('2026-10-10T12:58:00.000Z');
const EVENING = new Date('2026-10-11T04:30:00.000Z');

function expectWindows(now: Date) {
  const buckets = demoUsageBuckets(now);
  const today = chicagoDay(now);
  expect(buckets).toHaveLength(30);
  expect(new Set(buckets.map((b) => b.day)).size).toBe(30);
  expect(buckets[0].day).toBe(today);
  expect(buckets[29].day).toBe(shiftChicagoDay(today, -29));

  const todayBucket = buckets.find((b) => b.day === today);
  expect(todayBucket).toBeDefined();
  expect(todayBucket!.at.getTime()).toBe(now.getTime());
  expect(buckets.filter((b) => chicagoDay(b.at) === today)).toHaveLength(1);

  const points = buckets.map((b) => ({
    at: b.at,
    totalCost: b.totalCost,
    tokensIn: b.tokensIn,
    tokensOut: b.tokensOut,
    providers: b.providers,
  }));

  const day = aggregateUsage(points, '24h', now.getTime(), 'America/Chicago');
  const week = aggregateUsage(points, '7d', now.getTime(), 'America/Chicago');
  const month = aggregateUsage(
    points,
    'month',
    now.getTime(),
    'America/Chicago',
  );

  const weekDays = new Set(
    Array.from({ length: 7 }, (_, i) => shiftChicagoDay(today, -i)),
  );
  const monthPrefix = today.slice(0, 7);
  const expectedWeek = buckets
    .filter((b) => weekDays.has(b.day))
    .reduce((s, b) => s + b.totalCost, 0);
  const expectedMonth = buckets
    .filter((b) => b.day.startsWith(monthPrefix))
    .reduce((s, b) => s + b.totalCost, 0);

  expect(day.usage).not.toBeNull();
  expect(week.usage).not.toBeNull();
  expect(month.usage).not.toBeNull();
  expect(day.usage!.totalCost).toBeCloseTo(todayBucket!.totalCost, 4);
  expect(day.usage!.tokensIn).toBe(todayBucket!.tokensIn);
  expect(day.usage!.tokensOut).toBe(todayBucket!.tokensOut);
  expect(day.days).toEqual([{ day: today, totalCost: todayBucket!.totalCost }]);
  expect(day.daysCovered).toBe(1);
  expect(day.daysExpected).toBe(1);
  expect(day.note).toBeNull();
  expect(week.usage!.totalCost).toBeCloseTo(expectedWeek, 4);
  expect(week.days).toHaveLength(7);
  expect(week.note).toBeNull();
  expect(month.usage!.totalCost).toBeCloseTo(expectedMonth, 4);
  expect(month.days).toHaveLength(Number(today.slice(8, 10)));
  expect(month.note).toBeNull();
}

describe('demoUsageBuckets', () => {
  it('at 07:58 local, Today equals today and 7d and month equal the seeded sums', () => {
    expect(chicagoDay(MORNING)).toBe('2026-10-10');
    expectWindows(MORNING);
  });

  it('at 23:30 local, Today equals today and 7d and month equal the seeded sums', () => {
    expect(chicagoDay(EVENING)).toBe('2026-10-10');
    expectWindows(EVENING);
  });
});
