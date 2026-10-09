import { aggregateUsage } from './aggregate-usage';
import { demoUsageBuckets } from './demo-usage';

/**
 * Fixed afternoon so "today" at noon Central is inside the rolling 24 hours
 * and yesterday at noon is not. 2026-10-09T21:00:00Z is 16:00 CDT.
 */
const NOW = new Date('2026-10-09T21:00:00.000Z');

describe('demoUsageBuckets', () => {
  const buckets = demoUsageBuckets(NOW);

  it('writes 30 Chicago days ending today', () => {
    expect(buckets).toHaveLength(30);
    expect(buckets[0].day).toBe('2026-10-09');
    expect(buckets[29].day).toBe('2026-09-10');
    expect(new Set(buckets.map((b) => b.day)).size).toBe(30);
  });

  it('matches the 24h, 7 day, and month sums of those days', () => {
    const points = buckets.map((b) => ({
      at: b.at,
      totalCost: b.totalCost,
      tokensIn: b.tokensIn,
      tokensOut: b.tokensOut,
      providers: b.providers,
    }));

    const day = aggregateUsage(points, '24h', NOW.getTime(), 'America/Chicago');
    const week = aggregateUsage(points, '7d', NOW.getTime(), 'America/Chicago');
    const month = aggregateUsage(points, 'month', NOW.getTime(), 'America/Chicago');

    const since = NOW.getTime() - 86_400_000;
    const expectedDay = buckets.filter((b) => b.at.getTime() >= since).reduce((s, b) => s + b.totalCost, 0);
    const weekDays = new Set(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    const expectedWeek = buckets.filter((b) => weekDays.has(b.day)).reduce((s, b) => s + b.totalCost, 0);
    const expectedMonth = buckets.filter((b) => b.day.startsWith('2026-10-')).reduce((s, b) => s + b.totalCost, 0);

    expect(day.usage).not.toBeNull();
    expect(week.usage).not.toBeNull();
    expect(month.usage).not.toBeNull();
    expect(day.usage!.totalCost).toBeCloseTo(expectedDay, 4);
    expect(week.usage!.totalCost).toBeCloseTo(expectedWeek, 4);
    expect(month.usage!.totalCost).toBeCloseTo(expectedMonth, 4);
    expect(day.days).toHaveLength(1);
    expect(week.days).toHaveLength(7);
    expect(month.days).toHaveLength(9);
    expect(week.note).toBeNull();
    expect(month.note).toBeNull();
    expect(week.usage!.tokensIn).toBe(
      buckets.filter((b) => weekDays.has(b.day)).reduce((s, b) => s + b.tokensIn, 0),
    );
  });
});
