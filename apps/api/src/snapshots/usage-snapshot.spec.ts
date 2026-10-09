import { SnapshotsService } from './snapshots.service';
import type { PrismaService } from '../prisma/prisma.service';
import { aggregateUsage } from '../usage/aggregate-usage';

type Bucket = {
  day: string;
  at: Date;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: unknown;
};

function makePrisma() {
  const rows = new Map<string, Bucket>();
  const usageBucket = {
    upsert: jest.fn(async ({ where, create, update }: {
      where: { day: string };
      create: Bucket;
      update: Omit<Bucket, 'day'>;
    }) => {
      const prev = rows.get(where.day);
      const next = prev ? { ...prev, ...update, day: where.day } : create;
      rows.set(where.day, next);
      return next;
    }),
    findMany: jest.fn(async () => [...rows.values()]),
  };
  return { prisma: { usageBucket } as unknown as PrismaService, rows };
}

describe('applyUsage', () => {
  it('ignores a period total that has no timestamp', async () => {
    const { prisma, rows } = makePrisma();
    await new SnapshotsService(prisma).applyUsage({ period: '7d', totalCost: 9, tokensIn: 1, tokensOut: 1 });
    await new SnapshotsService(prisma).applyUsage({ period: 'month', totalCost: 30 });
    expect(rows.size).toBe(0);
  });

  it('keeps both days when the bridge posts a second simulated day', async () => {
    const { prisma, rows } = makePrisma();
    const svc = new SnapshotsService(prisma);
    await svc.applyUsage({
      points: [{
        at: '2026-10-08T18:00:00.000Z',
        totalCost: 1,
        tokensIn: 10,
        tokensOut: 5,
        providers: [{ name: 'zai', model: 'glm-5.2', cost: 1, tokensIn: 10, tokensOut: 5 }],
      }],
    });
    await svc.applyUsage({
      points: [{
        at: '2026-10-09T18:00:00.000Z',
        totalCost: 2,
        tokensIn: 20,
        tokensOut: 6,
        providers: [{ name: 'deepseek', model: 'deepseek-v4-flash', cost: 2, tokensIn: 20, tokensOut: 6 }],
      }],
    });
    expect([...rows.keys()].sort()).toEqual(['2026-10-08', '2026-10-09']);
    const view = aggregateUsage([...rows.values()], '7d', Date.parse('2026-10-09T21:00:00.000Z'), 'America/Chicago');
    expect(view.usage?.totalCost).toBe(3);
    expect(view.usage?.tokensIn).toBe(30);
    expect(view.days.map((d) => d.day)).toEqual(['2026-10-08', '2026-10-09']);
    expect(view.note).toBe('Showing 2 days of data so far');
  });

  it('replaces the same Chicago day and sums two points that share it', async () => {
    const { prisma, rows } = makePrisma();
    const svc = new SnapshotsService(prisma);
    await svc.applyUsage({
      points: [
        { at: '2026-10-09T15:00:00.000Z', totalCost: 1, tokensIn: 4, tokensOut: 1, providers: [] },
        { at: '2026-10-09T18:00:00.000Z', totalCost: 2, tokensIn: 6, tokensOut: 1, providers: [] },
      ],
    });
    expect(rows.size).toBe(1);
    expect(rows.get('2026-10-09')?.totalCost).toBe(3);
    await svc.applyUsage({
      points: [{ at: '2026-10-09T20:00:00.000Z', totalCost: 0.5, tokensIn: 1, tokensOut: 1, providers: [] }],
    });
    expect(rows.get('2026-10-09')?.totalCost).toBe(0.5);
  });
});
