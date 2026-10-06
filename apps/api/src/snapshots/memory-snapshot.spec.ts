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
    deleteMany: jest.fn(async ({ where }: { where?: { id?: { notIn?: string[] } } } = {}) => {
      const notIn = where?.id?.notIn;
      if (!notIn) {
        rows.clear();
        return { count: 0 };
      }
      for (const id of [...rows.keys()]) {
        if (!notIn.includes(id)) rows.delete(id);
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

const entry = (id: string, body: string) => ({
  id,
  title: `Title ${id}`,
  body,
  agent: 'Forge',
  createdAt: '2026-10-05T15:00:00.000Z',
  kind: 'daily',
  source: 'openclaw',
  ref: 'memory/2026-10-05.md',
});

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

  it('clears the table when the snapshot is a real empty list', async () => {
    const { client, rows } = makePrisma();
    const service = new SnapshotsService(client);
    await service.applyMemory({ entries: [entry('mem-1', 'bye')] });
    await service.applyMemory({ entries: [] });
    expect(rows.size).toBe(0);
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
