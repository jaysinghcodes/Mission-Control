import { aggregateUsage, partialUsageNote } from './aggregate-usage';

function point(at: string, cost: number, tokensIn = 10, tokensOut = 4) {
  return {
    at,
    totalCost: cost,
    tokensIn,
    tokensOut,
    providers: [
      {
        name: 'zai',
        model: 'glm-5.2',
        cost,
        tokensIn,
        tokensOut,
        agents: ['Speedy'],
      },
    ],
  };
}

describe('partialUsageNote', () => {
  it('uses the plain sentence for a short range', () => {
    expect(partialUsageNote(3, 7)).toBe('Showing 3 days of data so far');
    expect(partialUsageNote(1, 9)).toBe('Showing 1 day of data so far');
  });

  it('is silent when the range is empty or complete', () => {
    expect(partialUsageNote(0, 7)).toBeNull();
    expect(partialUsageNote(7, 7)).toBeNull();
  });
});

describe('aggregateUsage boundaries', () => {
  // 2026-10-09 17:00 UTC is 12:00 CDT. Seven Chicago days are Oct 3 through Oct 9.
  const now = Date.parse('2026-10-09T17:00:00.000Z');

  it('splits a 7 day window on the Chicago midnight and on UTC midnight', () => {
    const beforeChicago = point('2026-10-03T04:30:00.000Z', 1);
    const onChicago = point('2026-10-03T05:00:00.000Z', 2);
    const rows = [beforeChicago, onChicago];

    const chicago = aggregateUsage(rows, '7d', now, 'America/Chicago');
    expect(chicago.usage?.totalCost).toBe(2);
    expect(chicago.days.map((d) => d.day)).toEqual(['2026-10-03']);

    const utc = aggregateUsage(rows, '7d', now, 'UTC');
    expect(utc.usage?.totalCost).toBe(3);
    expect(utc.days.map((d) => d.day)).toEqual(['2026-10-03']);
  });

  it('keeps Oct 1 00:30 CDT in the Chicago month and Sep 30 23:30 CDT out', () => {
    const stillSeptember = point('2026-10-01T04:30:00.000Z', 4);
    const octoberChicago = point('2026-10-01T05:00:00.000Z', 8);
    const rows = [stillSeptember, octoberChicago];

    const chicago = aggregateUsage(rows, 'month', now, 'America/Chicago');
    expect(chicago.usage?.totalCost).toBe(8);
    expect(chicago.windowStart).toBe(Date.parse('2026-10-01T05:00:00.000Z'));

    const utc = aggregateUsage(rows, 'month', now, 'UTC');
    expect(utc.usage?.totalCost).toBe(12);
    expect(new Date(utc.windowStart).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('splits November on the Chicago month start while UTC already counts it', () => {
    // 2026-11-01 05:30 UTC is 00:30 CDT. DST ends later that morning.
    const novemberNow = Date.parse('2026-11-01T05:30:00.000Z');
    const octoberChicago = point('2026-11-01T04:30:00.000Z', 5);
    const novemberBoth = point('2026-11-01T05:00:00.000Z', 7);
    const rows = [octoberChicago, novemberBoth];

    const chicago = aggregateUsage(
      rows,
      'month',
      novemberNow,
      'America/Chicago',
    );
    expect(chicago.usage?.totalCost).toBe(7);
    expect(chicago.days.map((d) => d.day)).toEqual(['2026-11-01']);

    const utc = aggregateUsage(rows, 'month', novemberNow, 'UTC');
    expect(utc.usage?.totalCost).toBe(12);
    expect(utc.days.map((d) => d.day)).toEqual(['2026-11-01']);
  });

  it('splits January on the Chicago month start during standard time', () => {
    const januaryNow = Date.parse('2026-01-15T18:00:00.000Z');
    const decemberChicago = point('2026-01-01T05:30:00.000Z', 3);
    const januaryBoth = point('2026-01-01T06:00:00.000Z', 9);
    const rows = [decemberChicago, januaryBoth];

    const chicago = aggregateUsage(
      rows,
      'month',
      januaryNow,
      'America/Chicago',
    );
    expect(chicago.usage?.totalCost).toBe(9);
    expect(chicago.days[0].day).toBe('2026-01-01');

    const utc = aggregateUsage(rows, 'month', januaryNow, 'UTC');
    expect(utc.usage?.totalCost).toBe(12);
  });

  it('counts Today as the calendar day in Chicago and in UTC', () => {
    const morning = Date.parse('2026-10-10T12:58:00.000Z');
    const evening = Date.parse('2026-10-11T04:30:00.000Z');
    const rows = [
      point('2026-10-10T04:30:00.000Z', 10),
      point('2026-10-10T05:00:00.000Z', 0.65),
      point('2026-10-10T12:58:00.000Z', 1),
    ];

    const early = aggregateUsage(rows, '24h', morning, 'America/Chicago');
    expect(early.usage?.totalCost).toBe(1.65);
    expect(early.days.map((d) => d.day)).toEqual(['2026-10-10']);
    expect(early.daysCovered).toBe(1);
    expect(early.daysExpected).toBe(1);
    expect(early.note).toBeNull();
    expect(early.windowStart).toBe(Date.parse('2026-10-10T05:00:00.000Z'));

    const late = aggregateUsage(rows, '24h', evening, 'America/Chicago');
    expect(late.usage?.totalCost).toBe(1.65);
    expect(late.daysCovered).toBe(1);
    expect(late.daysExpected).toBe(1);

    const utc = aggregateUsage(
      [
        point('2026-10-09T23:59:00.000Z', 4),
        point('2026-10-10T00:00:00.000Z', 6),
      ],
      '24h',
      morning,
      'UTC',
    );
    expect(utc.usage?.totalCost).toBe(6);
    expect(utc.days.map((d) => d.day)).toEqual(['2026-10-10']);
    expect(utc.windowStart).toBe(Date.parse('2026-10-10T00:00:00.000Z'));
    expect(utc.daysCovered).toBe(1);
    expect(utc.daysExpected).toBe(1);

    const chicagoFromUtcMidnight = aggregateUsage(
      [
        point('2026-10-09T23:59:00.000Z', 4),
        point('2026-10-10T00:00:00.000Z', 6),
      ],
      '24h',
      morning,
      'America/Chicago',
    );
    expect(chicagoFromUtcMidnight.usage).toBeNull();
    expect(chicagoFromUtcMidnight.daysCovered).toBe(0);
    expect(chicagoFromUtcMidnight.daysExpected).toBe(1);
  });

  it('says how many days it has and does not zero fill the gap', () => {
    const rows = [
      point('2026-10-07T17:00:00.000Z', 1, 10, 1),
      point('2026-10-08T17:00:00.000Z', 2, 20, 2),
      point('2026-10-09T17:00:00.000Z', 4, 40, 4),
    ];
    const view = aggregateUsage(rows, '7d', now, 'America/Chicago');
    expect(view.note).toBe('Showing 3 days of data so far');
    expect(view.usage?.totalCost).toBe(7);
    expect(view.usage?.tokensIn).toBe(70);
    expect(view.days).toHaveLength(3);
    expect(view.daysCovered).toBe(3);
    expect(view.daysExpected).toBe(7);
    expect(view.usage?.providers[0].cost).toBe(7);
  });

  it('returns no usage when the range has no points', () => {
    const view = aggregateUsage(
      [point('2026-09-01T17:00:00.000Z', 5)],
      '7d',
      now,
      'America/Chicago',
    );
    expect(view.usage).toBeNull();
    expect(view.days).toEqual([]);
    expect(view.note).toBeNull();
    expect(view.daysCovered).toBe(0);
  });

  it('leaves an unknown period empty', () => {
    const view = aggregateUsage(
      [point('2026-10-09T17:00:00.000Z', 5)],
      '30d',
      now,
      'UTC',
    );
    expect(view.usage).toBeNull();
  });
});
