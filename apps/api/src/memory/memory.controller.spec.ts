import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemoryController, memorySnippet } from './memory.controller';
import type { PrismaService } from '../prisma/prisma.service';

type Row = {
  id: string;
  title: string;
  body: string;
  agent: string;
  createdAt: Date;
  kind: string;
  source: string | null;
  ref: string | null;
};

function row(partial: Partial<Row> & Pick<Row, 'id' | 'createdAt'>): Row {
  return {
    title: partial.title ?? partial.id,
    body: partial.body ?? `body ${partial.id}`,
    agent: partial.agent ?? 'Forge',
    kind: partial.kind ?? 'daily',
    source: partial.source ?? 'demo',
    ref: partial.ref ?? null,
    ...partial,
  };
}

function makePrisma(rows: Row[]) {
  const calls: unknown[] = [];
  const memoryEntry = {
    findMany: jest.fn(async ({ where, take, skip }: { where?: Record<string, unknown>; take?: number; skip?: number }) => {
      calls.push(where);
      const matched = rows
        .filter((item) => matches(item, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const start = skip ?? 0;
      return take == null ? matched.slice(start) : matched.slice(start, start + take);
    }),
    count: jest.fn(async () => rows.length),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      return rows.find((item) => item.id === where.id) ?? null;
    }),
  };
  return { prisma: { memoryEntry } as unknown as PrismaService, calls };
}

function matches(item: Row, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  if (typeof where.kind === 'string' && item.kind !== where.kind) return false;
  const created = where.createdAt as { gte?: Date; lt?: Date } | undefined;
  if (created) {
    const t = item.createdAt.getTime();
    if (created.gte && t < created.gte.getTime()) return false;
    if (created.lt && t >= created.lt.getTime()) return false;
  }
  const or = where.OR as { title: { contains: string } }[] | undefined;
  if (or) {
    const pattern = or[0].title.contains;
    const needle = pattern.replace(/\\([\\%_])/g, '$1').toLowerCase();
    const blob = `${item.title}\n${item.body}\n${item.agent}`.toLowerCase();
    if (!blob.includes(needle)) return false;
  }
  return true;
}

describe('MemoryController', () => {
  const rows = [
    row({ id: 'late-cst', createdAt: new Date('2026-01-16T05:58:00.000Z'), title: 'Before midnight', agent: 'Speedy' }),
    row({ id: 'early-cst', createdAt: new Date('2026-01-16T06:02:00.000Z'), title: 'After midnight', agent: 'Speedy' }),
    row({ id: 'late-cdt', createdAt: new Date('2026-07-16T04:58:00.000Z'), title: 'Summer late', kind: 'long-term' }),
    row({ id: 'early-cdt', createdAt: new Date('2026-07-16T05:02:00.000Z'), title: 'Summer early', body: 'percent 100% done' }),
  ];

  it('buckets 23:58 and 00:02 onto the Chicago day, in CST and CDT', async () => {
    const { prisma } = makePrisma(rows);
    const controller = new MemoryController(prisma);

    const jan15 = await controller.list('2026-01-15');
    expect(jan15.entries.map((entry) => entry.id)).toEqual(['late-cst']);
    expect(jan15.entries[0].day).toBe('2026-01-15');

    const jan16 = await controller.list('2026-01-16');
    expect(jan16.entries.map((entry) => entry.id)).toEqual(['early-cst']);
    expect(jan16.entries[0].day).toBe('2026-01-16');

    const jul15 = await controller.list('2026-07-15');
    expect(jul15.entries.map((entry) => entry.id)).toEqual(['late-cdt']);
    const jul16 = await controller.list('2026-07-16');
    expect(jul16.entries.map((entry) => entry.id)).toEqual(['early-cdt']);
  });

  it('rejects a bad day or kind and a missing id', async () => {
    const { prisma } = makePrisma(rows);
    const controller = new MemoryController(prisma);
    await expect(controller.list('2026-02-31')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list('yesterday')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(undefined, 'weekly')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.one('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 200 with an empty list when nothing is stored', async () => {
    const { prisma } = makePrisma([]);
    const controller = new MemoryController(prisma);
    const res = await controller.list();
    expect(res.entries).toEqual([]);
    expect(res.total).toBe(0);
    expect(res).not.toHaveProperty('error');
  });

  it('lists a snippet and loads the full body by id', async () => {
    const long = 'line\n'.repeat(80);
    const { prisma } = makePrisma([
      row({ id: 'long', createdAt: new Date('2026-10-06T15:04:00.000Z'), body: long, kind: 'long-term' }),
    ]);
    const controller = new MemoryController(prisma);
    const list = await controller.list();
    expect(list.entries[0]).not.toHaveProperty('body');
    expect(list.entries[0].snippet.length).toBeLessThan(long.length);
    expect(list.entries[0].snippet.includes('\n')).toBe(false);
    const one = await controller.one('long');
    expect(one.entry.body).toBe(long);
    expect(memorySnippet(long).length).toBeLessThanOrEqual(180);
  });

  it('escapes LIKE wildcards in search', async () => {
    const { prisma, calls } = makePrisma(rows);
    const controller = new MemoryController(prisma);
    const res = await controller.list(undefined, undefined, '100%');
    expect(res.entries.map((entry) => entry.id)).toEqual(['early-cdt']);
    const where = calls[0] as { OR: { title: { contains: string } }[] };
    expect(where.OR[0].title.contains).toBe('100\\%');
  });

  it('honors limit and offset without changing the unfiltered total', async () => {
    const { prisma } = makePrisma(rows);
    const controller = new MemoryController(prisma);
    const page = await controller.list(undefined, undefined, undefined, '1', '1');
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].id).toBe('late-cdt');
    expect(page.total).toBe(rows.length);
    await expect(controller.list(undefined, undefined, undefined, '500')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(undefined, undefined, undefined, 'nope')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(undefined, undefined, undefined, undefined, '-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters kind without hiding the unfiltered total', async () => {
    const { prisma } = makePrisma(rows);
    const controller = new MemoryController(prisma);
    const res = await controller.list(undefined, 'long-term');
    expect(res.entries.map((entry) => entry.id)).toEqual(['late-cdt']);
    expect(res.total).toBe(rows.length);
  });
});
