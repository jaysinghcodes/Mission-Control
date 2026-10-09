import { usageBucketsFromPayload } from './usage-points';

describe('usageBucketsFromPayload', () => {
  it('drops a 7d total and keeps timestamped points', () => {
    expect(usageBucketsFromPayload({ period: '7d', totalCost: 3 })).toEqual([]);
    const rows = usageBucketsFromPayload({
      points: [{ at: '2026-10-09T18:00:00.000Z', totalCost: 1.5, tokensIn: 8, tokensOut: 2, providers: [] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe('2026-10-09');
    expect(rows[0].totalCost).toBe(1.5);
  });

  it('keeps only the newest 30 days in one payload', () => {
    const points = [];
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 9, 9 - i, 18, 0, 0));
      points.push({ at: day.toISOString(), totalCost: 1, tokensIn: 1, tokensOut: 1, providers: [] });
    }
    const rows = usageBucketsFromPayload({ points });
    expect(rows).toHaveLength(30);
    expect(rows[0].day < rows[rows.length - 1].day).toBe(true);
    expect(rows[rows.length - 1].day).toBe('2026-10-09');
  });
});
