import { usageBucketsFromPayload } from './usage-points';

const NOW = new Date('2026-10-09T21:00:00.000Z');

describe('usageBucketsFromPayload', () => {
  it('drops a 7d total and keeps timestamped points', () => {
    expect(
      usageBucketsFromPayload({ period: '7d', totalCost: 3 }, NOW),
    ).toEqual([]);
    const rows = usageBucketsFromPayload(
      {
        points: [
          {
            at: '2026-10-09T18:00:00.000Z',
            totalCost: 1.5,
            tokensIn: 8,
            tokensOut: 2,
            providers: [],
          },
        ],
      },
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe('2026-10-09');
    expect(rows[0].totalCost).toBe(1.5);
  });

  it('keeps only the last 30 days through today', () => {
    const points = [];
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 9, 9 - i, 18, 0, 0));
      points.push({
        at: day.toISOString(),
        totalCost: 1,
        tokensIn: 1,
        tokensOut: 1,
        providers: [],
      });
    }
    const rows = usageBucketsFromPayload({ points }, NOW);
    expect(rows).toHaveLength(30);
    expect(rows[0].day).toBe('2026-09-10');
    expect(rows[rows.length - 1].day).toBe('2026-10-09');
  });

  it('drops a payload that is entirely older than 30 days and drops a future point', () => {
    const now = new Date('2026-10-10T12:58:00.000Z');
    const points = [];
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 7, 1 + i, 18, 0, 0));
      points.push({
        at: day.toISOString(),
        totalCost: 1,
        tokensIn: 1,
        tokensOut: 1,
        providers: [],
      });
    }
    points.push({
      at: '2027-01-01T00:00:00.000Z',
      totalCost: 9,
      tokensIn: 1,
      tokensOut: 1,
      providers: [],
    });
    points.push({
      at: '2026-10-10T20:00:00.000Z',
      totalCost: 3,
      tokensIn: 1,
      tokensOut: 1,
      providers: [],
    });
    expect(usageBucketsFromPayload({ points }, now)).toEqual([]);
  });
});
