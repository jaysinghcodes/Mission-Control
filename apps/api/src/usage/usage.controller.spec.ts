import { UsageController } from './usage.controller';
import { PrismaService } from '../prisma/prisma.service';

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
    const prisma = { usageBucket: { findMany: jest.fn(async () => rows) } };
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
    expect(res.usage?.totalCost).toBe(7);
    expect(res.note).toBe('Showing 3 days of data so far');
    expect(res.days).toHaveLength(3);
    expect(res.label).toBe('Month to date');
    expect(res.daysExpected).toBe(9);
    const start = new Date(res.windowStart);
    expect(start.toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('does not invent a zero for a period with no rows', async () => {
    const res = await controller([]).read('7d', now);
    expect(res.usage).toBeNull();
    expect(res.note).toBeNull();
    expect(res.days).toEqual([]);
    expect(res.label).toBe('Last 7 days');
  });

  it('labels the calendar day Today and leaves yesterday out', async () => {
    const morning = Date.parse('2026-10-10T12:58:00.000Z');
    const res = await controller([
      {
        at: new Date('2026-10-10T03:30:00.000Z'),
        totalCost: 10,
        tokensIn: 1,
        tokensOut: 1,
        providers: [],
      },
      {
        at: new Date('2026-10-10T12:58:00.000Z'),
        totalCost: 0.65,
        tokensIn: 2,
        tokensOut: 1,
        providers: [],
      },
    ]).read('24h', morning);
    expect(res.label).toBe('Today');
    expect(res.usage?.totalCost).toBe(0.65);
    expect(res.days).toEqual([{ day: '2026-10-10', totalCost: 0.65 }]);
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
