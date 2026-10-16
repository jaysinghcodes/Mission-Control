import { promiseFn } from '../../test/lint-helpers';
import { calendarDay } from './aggregate-usage';
import { UsageController } from './usage.controller';
import { PrismaService } from '../prisma/prisma.service';
import { usageTimeZone, zoneWallTime } from './zone-time';

describe('UsageController', () => {
  const now = Date.parse('2026-10-09T21:00:00.000Z');

  function controller(
    rows: {
      at: Date;
      totalCost: number;
      tokensIn: number;
      tokensOut: number;
      providers: unknown;
    }[],
  ) {
    const prisma = {
      usageBucket: { findMany: jest.fn(promiseFn(() => rows)) },
    };
    return new UsageController(prisma as unknown as PrismaService);
  }

  it('sums stored days for the month and reports a partial range', async () => {
    const res = await controller([
      {
        at: new Date('2026-10-07T17:00:00.000Z'),
        totalCost: 1,
        tokensIn: 10,
        tokensOut: 1,
        providers: [],
      },
      {
        at: new Date('2026-10-08T17:00:00.000Z'),
        totalCost: 2,
        tokensIn: 20,
        tokensOut: 2,
        providers: [],
      },
      {
        at: new Date('2026-10-09T17:00:00.000Z'),
        totalCost: 4,
        tokensIn: 40,
        tokensOut: 4,
        providers: [],
      },
    ]).read('month', now);
    const zone = usageTimeZone();
    const today = calendarDay(new Date(now), zone);
    expect(res.usage?.totalCost).toBe(7);
    expect(res.note).toBe('Showing 3 days of data so far');
    expect(res.days).toHaveLength(3);
    expect(res.label).toBe('Month to date');
    expect(res.daysExpected).toBe(Number(today.slice(8, 10)));
    expect(res.timeZone).toBe(zone);
    expect(res.windowStart).toBe(
      zoneWallTime(`${today.slice(0, 7)}-01`, 0, 0, zone).getTime(),
    );
  });

  it('does not invent a zero for a period with no rows', async () => {
    const res = await controller([]).read('7d', now);
    expect(res.usage).toBeNull();
    expect(res.note).toBeNull();
    expect(res.days).toEqual([]);
    expect(res.label).toBe('Last 7 days');
  });

  it('labels the calendar day Today and leaves the previous server day out', async () => {
    const zone = usageTimeZone();
    const morning = Date.parse('2026-10-10T12:58:00.000Z');
    const today = calendarDay(new Date(morning), zone);
    const start = zoneWallTime(today, 0, 0, zone).getTime();
    const res = await controller([
      {
        at: new Date(start - 60_000),
        totalCost: 10,
        tokensIn: 1,
        tokensOut: 1,
        providers: [],
      },
      {
        at: new Date(morning),
        totalCost: 0.65,
        tokensIn: 2,
        tokensOut: 1,
        providers: [],
      },
    ]).read('24h', morning);
    expect(res.label).toBe('Today');
    expect(res.usage?.totalCost).toBe(0.65);
    expect(res.days).toEqual([{ day: today, totalCost: 0.65 }]);
    expect(res.daysCovered).toBe(1);
    expect(res.daysExpected).toBe(1);
    expect(res.note).toBeNull();
  });

  it('keeps period=30d empty', async () => {
    const res = await controller([
      {
        at: new Date('2026-10-09T17:00:00.000Z'),
        totalCost: 1,
        tokensIn: 1,
        tokensOut: 1,
        providers: [],
      },
    ]).read('30d', now);
    expect(res.usage).toBeNull();
  });
});
