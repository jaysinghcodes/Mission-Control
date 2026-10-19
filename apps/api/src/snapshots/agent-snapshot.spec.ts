import { SnapshotsService } from './snapshots.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RosterAgent } from '../agents/agent-merge';

/**
 * Criterion 3 at the service boundary. The in memory table records the
 * writes applyAgents actually makes.
 */
function memory(seed: RosterAgent[]) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const agent = {
    findMany: () => Promise.resolve([...rows.values()]),
    deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
      for (const id of where.id.in) rows.delete(id);
      return Promise.resolve({ count: where.id.in.length });
    },
    create: ({ data }: { data: RosterAgent }) => {
      const row = {
        ...data,
        personalityTags: Array.isArray(data.personalityTags)
          ? data.personalityTags
          : null,
      };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<RosterAgent>;
    }) => {
      const prev = rows.get(where.id);
      if (!prev) return Promise.reject(new Error(`missing ${where.id}`));
      const next = { ...prev, ...data };
      if (
        data.personalityTags &&
        typeof data.personalityTags === 'object' &&
        !Array.isArray(data.personalityTags)
      ) {
        next.personalityTags = null;
      }
      rows.set(where.id, next);
      return Promise.resolve(next);
    },
  };
  const settings: {
    row: { namingMode: string | null; crewMap: unknown } | null;
  } = { row: null };
  const prisma = {
    agent,
    setting: {
      findUnique: () => Promise.resolve(settings.row),
      update: ({ data }: { data: { crewMap: Record<string, string> } }) => {
        settings.row = {
          namingMode: settings.row?.namingMode ?? 'crew',
          crewMap: data.crewMap,
        };
        return Promise.resolve(settings.row);
      },
    },
    $transaction: (fn: (tx: { agent: typeof agent }) => Promise<void>) =>
      fn({ agent }),
  };
  return {
    rows,
    settings,
    service: new SnapshotsService(prisma as unknown as PrismaService),
  };
}

function row(
  partial: Partial<RosterAgent> & Pick<RosterAgent, 'id' | 'name' | 'source'>,
): RosterAgent {
  return {
    color: '#58A6FF',
    role: null,
    status: 'idle',
    parentId: null,
    emoji: null,
    personalityTags: null,
    currentTask: null,
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: null,
    channel: null,
    model: null,
    avatar: null,
    position: 0,
    lastSeenAt: null,
    ...partial,
  };
}

describe('applyAgents source merge', () => {
  it('criterion 3: omits protected rows and changes only status on a registered id', async () => {
    const { rows, service } = memory([
      row({
        id: 'speedy',
        name: 'Speedy',
        source: 'default',
        position: 0,
        role: 'chief of staff',
        color: '#8d5bff',
      }),
      row({
        id: 'forge_helper',
        name: 'Forge Helper',
        source: 'registered',
        position: 12,
        role: 'engineer',
        color: '#9bd434',
        emoji: '🔧',
        model: 'local',
        avatar: 'kept',
      }),
      row({
        id: 'old_snap',
        name: 'Old Snap',
        source: 'snapshot',
        position: 3,
      }),
    ]);

    await service.applyAgents({
      agents: [
        {
          id: 'forge_helper',
          name: 'Renamed',
          role: 'other',
          color: '#000000',
          status: 'working',
          currentTask: 'Shipping',
        },
        {
          name: 'Nova',
          role: 'development',
          status: 'idle',
          parent: 'Speedy',
        },
      ],
    });

    expect(rows.has('old_snap')).toBe(false);
    expect(rows.get('speedy')).toMatchObject({
      source: 'default',
      name: 'Speedy',
      role: 'chief of staff',
      color: '#8d5bff',
      position: 0,
    });
    expect(rows.get('forge_helper')).toMatchObject({
      source: 'registered',
      name: 'Forge Helper',
      role: 'engineer',
      color: '#9bd434',
      emoji: '🔧',
      model: 'local',
      avatar: 'kept',
      position: 12,
      status: 'working',
      currentTask: 'Shipping',
    });
    const nova = rows.get('nova');
    expect(nova?.source).toBe('snapshot');
    expect(nova?.parentId).toBe('speedy');
  });

  it('a removed snapshot agent stays gone until a later snapshot includes it', async () => {
    const { rows, service } = memory([
      row({ id: 'speedy', name: 'Speedy', source: 'default', position: 0 }),
      row({
        id: 'forge_2',
        name: 'Forge 2',
        source: 'snapshot',
        position: 4,
      }),
    ]);
    rows.delete('forge_2');

    await service.applyAgents({
      agents: [{ id: 'speedy', name: 'Speedy', status: 'idle' }],
    });
    expect(rows.has('forge_2')).toBe(false);

    await service.applyAgents({
      agents: [
        { id: 'speedy', name: 'Speedy', status: 'idle' },
        { id: 'forge_2', name: 'Forge 2', status: 'working' },
      ],
    });
    expect(rows.get('forge_2')).toMatchObject({
      source: 'snapshot',
      name: 'Forge 2',
      status: 'working',
    });
    expect(rows.get('speedy')?.source).toBe('default');
  });

  it('crew mode seats pixel and quill by id and does not use the display name', async () => {
    const { settings, service } = memory([]);
    settings.row = { namingMode: 'crew', crewMap: {} };
    await service.applyAgents({
      agents: [
        { id: 'helper', name: 'Pixel', role: 'designer', position: 0 },
        { id: 'pixel', name: 'Quill', role: 'writer' },
        { id: 'quill', name: 'Ada', role: 'notes' },
      ],
    });
    expect(settings.row?.crewMap).toEqual({
      pixel: 'pixel',
      quill: 'quill',
      helper: 'speedy',
    });
  });
});
