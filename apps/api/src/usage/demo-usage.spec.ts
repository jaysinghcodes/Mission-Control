import { chicagoDay, shiftChicagoDay } from '../memory/chicago-day';
import { aggregateUsage, calendarDay } from './aggregate-usage';
import {
  demoUsageBuckets,
  demoUsageId,
  isUntouchedDemoUsage,
} from './demo-usage';
import { applyUsagePrices } from './price-usage';
import { loadPriceTable } from './prices';
import { usageTimeZone } from './zone-time';

/** 07:58 and 23:30 America/Chicago on 2026-10-10 (CDT). */
const MORNING = new Date('2026-10-10T12:58:00.000Z');
const EVENING = new Date('2026-10-11T04:30:00.000Z');
const CHICAGO = 'America/Chicago';

function expectWindows(now: Date) {
  const buckets = demoUsageBuckets(now, CHICAGO);
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

describe('demo usage marker', () => {
  it('tags each provider and keeps a stable id', () => {
    const buckets = demoUsageBuckets(MORNING);
    for (const bucket of buckets) {
      expect(demoUsageId(bucket.day)).toBe(`demo-usage-${bucket.day}`);
      expect(
        isUntouchedDemoUsage({
          id: demoUsageId(bucket.day),
          providers: bucket.providers,
        }),
      ).toBe(true);
    }
  });

  it('does not treat a bridge overwrite as sample data', () => {
    expect(
      isUntouchedDemoUsage({
        id: 'demo-usage-2026-10-10',
        providers: [{ name: 'zai', model: 'glm-5.2', cost: 1.25 }],
      }),
    ).toBe(false);
    expect(
      isUntouchedDemoUsage({
        id: 'cuid-real',
        providers: [{ name: 'zai', demo: true }],
      }),
    ).toBe(false);
  });
});

describe('demoUsageBuckets', () => {
  it('at 07:58 Chicago, Today equals today and 7d and month equal the seeded sums', () => {
    expect(chicagoDay(MORNING)).toBe('2026-10-10');
    expectWindows(MORNING);
  });

  it('at 23:30 Chicago, Today equals today and 7d and month equal the seeded sums', () => {
    expect(chicagoDay(EVENING)).toBe('2026-10-10');
    expectWindows(EVENING);
  });

  it('defaults to the server timezone', () => {
    const zone = usageTimeZone();
    const buckets = demoUsageBuckets(MORNING);
    expect(buckets[0].day).toBe(calendarDay(MORNING, zone));
    expect(buckets[0].at.getTime()).toBe(MORNING.getTime());
  });

  it('prices seeded tokens from the table and leaves Ollama at zero', () => {
    const buckets = demoUsageBuckets(MORNING, CHICAGO);
    const today = buckets[0];
    const agg = aggregateUsage(
      [
        {
          at: today.at,
          totalCost: today.totalCost,
          tokensIn: today.tokensIn,
          tokensOut: today.tokensOut,
          providers: today.providers,
        },
      ],
      '24h',
      MORNING.getTime(),
      CHICAGO,
    );
    const priced = applyUsagePrices(agg, loadPriceTable(), new Set());
    expect(priced.usage?.priceLabel ?? null).toBeNull();
    expect(priced.usage?.totalCost).toBeGreaterThan(0);
    const local = priced.usage?.groups?.find(
      (line) => line.provider === 'ollama',
    );
    expect(local?.cost).toBe(0);
    expect(local?.priceLabel).toBeNull();
    expect(local?.tokensIn).toBeGreaterThan(0);
    const quill = priced.usage?.groups?.find((line) => line.bot === 'Quill');
    expect(quill?.cost).toBeGreaterThan(0);
    expect(priced.usage?.groups?.map((line) => line.bot).sort()).toEqual([
      'Lens',
      'Local',
      'Nova',
      'Quill',
      'Sage',
    ]);
  });
});
