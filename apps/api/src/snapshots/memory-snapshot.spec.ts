import { SnapshotsService } from './snapshots.service';
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

function makePrisma() {
  const rows = new Map<string, Row>();
  const memoryEntry = {
    deleteMany: jest.fn(async ({ where }: {
      where?: {
        source?: { in?: string[] };
        agent?: { in?: string[] };
        id?: { notIn?: string[] };
      };
    } = {}) => {
      const sources = where?.source?.in;
      const agents = where?.agent?.in;
      const notIn = where?.id?.notIn;
      for (const [id, row] of [...rows.entries()]) {
        if (sources && (row.source == null || !sources.includes(row.source))) continue;
        if (agents && !agents.includes(row.agent)) continue;
        if (notIn && notIn.includes(id)) continue;
        rows.delete(id);
      }
      return { count: 0 };
    }),
    upsert: jest.fn(async ({ where, create, update }: { where: { id: string }; create: Row; update: Omit<Row, 'id'> }) => {
      const prev = rows.get(where.id);
      const next = prev ? { ...prev, ...update, id: where.id } : create;
      rows.set(where.id, next);
      return next;
    }),
  };
  const prisma = {
    memoryEntry,
    $transaction: jest.fn(async (fn: (tx: typeof memoryEntry & { memoryEntry: typeof memoryEntry }) => Promise<void>) => {
      await fn({ memoryEntry } as unknown as typeof memoryEntry & { memoryEntry: typeof memoryEntry });
    }),
  };
  // The service calls tx.memoryEntry.*, and tx is the transaction client.
  // Pass a client whose memoryEntry is the same store, and whose
  // $transaction invokes the callback with that client.
  const client = {
    memoryEntry,
    $transaction: async (fn: (tx: { memoryEntry: typeof memoryEntry }) => Promise<void>) => {
      await fn({ memoryEntry });
    },
  };
  return { client: client as unknown as PrismaService, rows, prisma };
}

const entry = (id: string, body: string, agent = 'Forge') => ({
  id,
  title: `Title ${id}`,
  body,
  agent,
  createdAt: '2026-10-05T15:00:00.000Z',
  kind: 'daily',
  source: 'openclaw',
  ref: 'memory/2026-10-05.md',
});

function demoRow(id: string): Row {
  return {
    id,
    title: 'Seed note',
    body: 'from seed:demo',
    agent: 'Forge',
    createdAt: new Date('2026-10-05T15:00:00.000Z'),
    kind: 'daily',
    source: 'demo',
    ref: null,
  };
}

describe('SnapshotsService.applyMemory', () => {
  it('upserts stable ids and does not duplicate on a second sync', async () => {
    const { client, rows } = makePrisma();
    const service = new SnapshotsService(client);
    await service.applyMemory({ entries: [entry('mem-1', 'first'), entry('mem-2', 'second')] });
    await service.applyMemory({ entries: [entry('mem-1', 'updated'), entry('mem-2', 'second')] });
    expect(rows.size).toBe(2);
    expect(rows.get('mem-1')?.body).toBe('updated');
    expect(rows.get('mem-2')?.body).toBe('second');
  });

  it('drops ids missing from the snapshot and ignores a payload with no entries array', async () => {
    const { client, rows } = makePrisma();
    const service = new SnapshotsService(client);
    await service.applyMemory({ entries: [entry('mem-1', 'keep'), entry('mem-2', 'gone')] });
    await service.applyMemory({ entries: [entry('mem-1', 'keep')] });
    expect([...rows.keys()]).toEqual(['mem-1']);
    await service.applyMemory({ note: 'malformed' });
    expect(rows.size).toBe(1);
  });

  it('clears bridge rows on an empty snapshot and leaves demo rows', async () => {
    const { client, rows } = makePrisma();
    rows.set('demo-1', demoRow('demo-1'));
    const service = new SnapshotsService(client);
    await service.applyMemory({ entries: [entry('mem-1', 'bye')] });
    await service.applyMemory({ entries: [] });
    expect([...rows.keys()]).toEqual(['demo-1']);
    expect(rows.get('demo-1')?.source).toBe('demo');
  });

  it('replaces bridge rows only for agents in the snapshot', async () => {
    const { client, rows } = makePrisma();
    rows.set('demo-forge', demoRow('demo-forge'));
    const service = new SnapshotsService(client);
    await service.applyMemory({
      entries: [entry('forge-1', 'old', 'Forge'), entry('aegis-1', 'keep', 'Aegis')],
    });
    await service.applyMemory({ entries: [entry('forge-2', 'new', 'Forge')] });
    expect(rows.has('forge-1')).toBe(false);
    expect(rows.has('forge-2')).toBe(true);
    expect(rows.get('aegis-1')?.body).toBe('keep');
    expect(rows.get('demo-forge')?.source).toBe('demo');
    expect(rows.get('forge-2')?.source).toBe('bridge');
  });

  it('skips an entry that has no id and stores an unknown kind as other', async () => {
    const { client, rows } = makePrisma();
    const service = new SnapshotsService(client);
    await service.applyMemory({
      entries: [
        { title: 'no id', body: 'x', createdAt: '2026-10-05T15:00:00.000Z' },
        { ...entry('mem-9', 'ok'), kind: 'scratch' },
      ],
    });
    expect([...rows.keys()]).toEqual(['mem-9']);
    expect(rows.get('mem-9')?.kind).toBe('other');
  });
});
