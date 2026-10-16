import { promiseFn } from '../../test/lint-helpers';
import { modelRowsFromPayload, SnapshotsService } from './snapshots.service';
import type { PrismaService } from '../prisma/prisma.service';

type ModelRow = {
  provider: string;
  model: string;
  agentName: string | null;
  createdAt: Date;
};

function makePrisma() {
  const models: ModelRow[] = [];
  let openclawVersion: string | null = null;
  const tx = {
    modelConfig: {
      deleteMany: jest.fn(
        promiseFn(() => {
          models.splice(0, models.length);
          return { count: 0 };
        }),
      ),
      createMany: jest.fn(
        promiseFn(({ data }: { data: ModelRow[] }) => {
          models.push(...data);
          return { count: data.length };
        }),
      ),
    },
    setting: {
      upsert: jest.fn(
        promiseFn(
          ({
            create,
            update,
          }: {
            create: { openclawVersion?: string };
            update: { openclawVersion?: string };
          }) => {
            openclawVersion =
              update.openclawVersion ?? create.openclawVersion ?? null;
            return { id: 'default', openclawVersion };
          },
        ),
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      promiseFn((fn: (client: typeof tx) => Promise<void>) => fn(tx)),
    ),
  } as unknown as PrismaService;
  return {
    prisma,
    models,
    version: () => openclawVersion,
  };
}

const FIXTURE = {
  openclawVersion: '2026.10.15',
  agents: [
    { id: 'quill', name: 'Quill', provider: 'openai', model: 'gpt-4.1' },
    {
      id: 'sage',
      name: 'Sage',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
    { id: 'nova', name: 'Nova', provider: 'deepseek', model: 'deepseek-chat' },
    {
      id: 'router',
      name: 'Router',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4-6',
    },
    { id: 'lens', name: 'Lens', provider: 'google', model: 'gemini-2.5-flash' },
    { id: 'local', name: 'Local', provider: 'ollama', model: 'llama3.1' },
  ],
  models: [],
};

describe('applyModels', () => {
  it('stores one row per agent and the OpenClaw version', async () => {
    const { prisma, models, version } = makePrisma();
    await new SnapshotsService(prisma).applyModels(FIXTURE);
    expect(models.map((row) => row.provider)).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'openrouter',
      'google',
      'ollama',
    ]);
    expect(models.map((row) => row.agentName)).toEqual([
      'Quill',
      'Sage',
      'Nova',
      'Router',
      'Lens',
      'Local',
    ]);
    expect(version()).toBe('2026.10.15');
  });

  it('ignores a payload that is not a models snapshot', async () => {
    const { prisma, models } = makePrisma();
    await new SnapshotsService(prisma).applyModels({ period: '7d' });
    expect(models).toEqual([]);
    expect(modelRowsFromPayload({ period: '7d' })).toBeNull();
  });

  it('clears rows when the bridge reports an empty reading', async () => {
    const { prisma, models } = makePrisma();
    const svc = new SnapshotsService(prisma);
    await svc.applyModels(FIXTURE);
    await svc.applyModels({ agents: [], models: [] });
    expect(models).toEqual([]);
  });

  it('keeps a catalog row when no agent uses that model', () => {
    const rows = modelRowsFromPayload({
      agents: [
        { id: 'quill', name: 'Quill', provider: 'openai', model: 'gpt-4.1' },
      ],
      models: [
        { provider: 'openai', model: 'gpt-4.1' },
        { provider: 'ollama', model: 'llama3.1' },
      ],
    });
    expect(rows).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4.1',
        label: 'Quill',
        agentId: 'quill',
        agentName: 'Quill',
        local: false,
      },
      {
        provider: 'ollama',
        model: 'llama3.1',
        label: null,
        agentId: null,
        agentName: null,
        local: true,
      },
    ]);
  });
});
