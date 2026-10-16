import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { Client } from 'pg';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DEMO_DOCS } from '../src/docs/demo-docs';
import { calendarDay } from '../src/usage/aggregate-usage';
import { usageTimeZone } from '../src/usage/zone-time';
import {
  DEMO_ACTIVITY_IDS,
  DEMO_AGENT_IDS,
  DEMO_APPROVAL_IDS,
  DEMO_CRON_IDS,
  DEMO_CUSTOM_TOOL_ID,
  DEMO_DEVICE_IDS,
  DEMO_PROJECT_IDS,
  DEMO_RUN_IDS,
  DEMO_TICKET_IDS,
} from '../src/seed/demo-ids';
import { DEMO_MISSION } from '../src/team/demo-team';
import { SETTING_ID } from '../src/team/mission';
import { isUntouchedDemoUsage } from '../src/usage/demo-usage';
import { PrismaService } from '../src/prisma/prisma.service';
import { applyWriteToken } from './write-token';

/**
 * seed:demo then seed:clear.
 *
 * Uses its own database so the suite does not wipe mission_control.
 * A registered bot and a ticket created through the API survive.
 * seed:clear exits 0 the first time and the second time.
 */

jest.setTimeout(180000);

const DB_NAME = 'mission_control_seed_clear';
const API_ROOT = path.resolve(__dirname, '..');
const TOKEN = 'seed-clear-test';

const saved = {
  DATABASE_URL: process.env.DATABASE_URL,
  DOCS_ROOT: process.env.DOCS_ROOT,
  INGEST_TOKEN: process.env.INGEST_TOKEN,
};

function withDatabase(raw: string, database: string): string {
  const normalized = raw
    .replace(/^postgresql:/i, 'http:')
    .replace(/^postgres:/i, 'http:');
  const url = new URL(normalized);
  url.pathname = `/${database}`;
  const protocol = raw.toLowerCase().startsWith('postgres://')
    ? 'postgres:'
    : 'postgresql:';
  return url.toString().replace(/^http:/i, protocol);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: API_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function recreateDatabase(adminUrl: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [DB_NAME],
    );
    await client.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
    await client.query(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await client.end();
  }
}

describe('seed:clear (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService;
  let docsRoot = '';
  let childEnv: NodeJS.ProcessEnv = process.env;

  function call() {
    const base = request(app!.getHttpServer());
    const wrap = (
      method: 'post' | 'put' | 'patch' | 'delete',
      original: (url: string) => request.Test,
    ) => {
      base[method] = (url: string) => applyWriteToken(original(url));
    };
    wrap('post', base.post.bind(base));
    wrap('put', base.put.bind(base));
    wrap('patch', base.patch.bind(base));
    wrap('delete', base.delete.bind(base));
    return base;
  }

  beforeAll(async () => {
    if (!saved.DATABASE_URL?.trim()) {
      throw new Error('seed:clear e2e needs DATABASE_URL');
    }
    docsRoot = await mkdtemp(path.join(tmpdir(), 'mc-seed-clear-docs-'));
    const adminUrl = withDatabase(saved.DATABASE_URL, 'postgres');
    const isolatedUrl = withDatabase(saved.DATABASE_URL, DB_NAME);
    await recreateDatabase(adminUrl);
    childEnv = {
      ...process.env,
      DATABASE_URL: isolatedUrl,
      DOCS_ROOT: docsRoot,
      NODE_ENV: 'test',
    };
    delete childEnv.SEED_DEMO_ALLOW_PROD;

    const migrated = await run(
      'npx',
      ['prisma', 'migrate', 'deploy'],
      childEnv,
    );
    if (migrated.code !== 0) {
      throw new Error(
        `prisma migrate deploy exited ${migrated.code}\n${migrated.stdout}\n${migrated.stderr}`,
      );
    }

    const firstEmpty = await run('npm', ['run', 'seed:clear'], childEnv);
    if (firstEmpty.code !== 0) {
      throw new Error(
        `seed:clear on an empty database exited ${firstEmpty.code}\n${firstEmpty.stdout}\n${firstEmpty.stderr}`,
      );
    }

    const seeded = await run('npm', ['run', 'seed:demo'], childEnv);
    if (seeded.code !== 0) {
      throw new Error(
        `seed:demo exited ${seeded.code}\n${seeded.stdout}\n${seeded.stderr}`,
      );
    }

    process.env.DATABASE_URL = isolatedUrl;
    process.env.DOCS_ROOT = docsRoot;
    process.env.INGEST_TOKEN = TOKEN;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    if (!prisma.dbReady) {
      throw new Error(
        'seed:clear e2e could not connect to the isolated database',
      );
    }
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.DATABASE_URL;
      if (saved.DOCS_ROOT === undefined) delete process.env.DOCS_ROOT;
      else process.env.DOCS_ROOT = saved.DOCS_ROOT;
      if (saved.INGEST_TOKEN === undefined) delete process.env.INGEST_TOKEN;
      else process.env.INGEST_TOKEN = saved.INGEST_TOKEN;
      if (saved.DATABASE_URL) {
        const client = new Client({
          connectionString: withDatabase(saved.DATABASE_URL, 'postgres'),
        });
        try {
          await client.connect();
          await client.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [DB_NAME],
          );
          await client.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
        } catch {
          // The isolated database is only for this file.
        } finally {
          await client.end().catch(() => undefined);
        }
      }
      if (docsRoot) await rm(docsRoot, { recursive: true, force: true });
    }
  });

  it('clears demo rows, keeps API rows, and exits 0 twice', async () => {
    expect(
      await prisma.ticket.count({
        where: { id: { in: [...DEMO_TICKET_IDS] } },
      }),
    ).toBe(DEMO_TICKET_IDS.length);
    expect(
      await prisma.agent.count({
        where: { id: { in: [...DEMO_AGENT_IDS] }, source: 'default' },
      }),
    ).toBe(DEMO_AGENT_IDS.length);

    const registered = await call().post('/agents/register').send({
      id: 'keeper_bot',
      name: 'Keeper',
      role: 'scout',
    });
    expect(registered.status).toBe(201);

    const created = await call().post('/tickets').send({
      title: 'API ticket that must stay',
      projectId: 'demo-project-ideas',
    });
    expect(created.status).toBe(201);
    const ticketId = (created.body as { ticket: { id: string } }).ticket.id;
    expect(ticketId.startsWith('demo-')).toBe(false);

    const snap = await call()
      .post('/events')
      .send({
        type: 'agents.snapshot',
        payload: { agents: [{ id: 'ribbon', name: 'Ribbon', role: 'scout' }] },
      });
    expect(snap.status).toBe(202);

    const today = new Date().toISOString();
    const usage = await call()
      .post('/events')
      .send({
        type: 'usage.snapshot',
        payload: {
          points: [
            {
              at: today,
              totalCost: 42.25,
              tokensIn: 11,
              tokensOut: 7,
              providers: [{ name: 'zai', model: 'glm-5.2', cost: 42.25 }],
            },
          ],
        },
      });
    expect(usage.status).toBe(202);

    await prisma.session.create({
      data: {
        id: 'user-session-keep',
        name: 'Keeper session',
        agent: 'Keeper',
      },
    });
    await prisma.cronJob.create({
      data: {
        id: 'user-cron-keep',
        name: 'Keeper job',
        schedule: '0 9 * * *',
        day: 0,
        time: '09:00',
      },
    });
    await prisma.agent.create({
      data: { id: 'kept_default', name: 'Kept Default', source: 'default' },
    });

    const edited = DEMO_DOCS[0];
    await writeFile(
      path.join(docsRoot, ...edited.relative.split('/')),
      'edited by a person\n',
      'utf8',
    );
    const removedDoc = DEMO_DOCS.find(
      (doc) => doc.relative !== edited.relative,
    );
    expect(removedDoc).toBeTruthy();

    const missionBefore = await prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    expect(missionBefore?.mission).toBe(DEMO_MISSION);

    const first = await run('npm', ['run', 'seed:clear'], childEnv);
    expect(first.code).toBe(0);

    expect(
      await prisma.ticket.count({
        where: { id: { in: [...DEMO_TICKET_IDS] } },
      }),
    ).toBe(0);
    expect(
      await prisma.project.count({ where: { id: { in: DEMO_PROJECT_IDS } } }),
    ).toBe(0);
    expect(
      await prisma.run.count({ where: { id: { in: [...DEMO_RUN_IDS] } } }),
    ).toBe(0);
    expect(
      await prisma.activityEvent.count({
        where: { id: { in: [...DEMO_ACTIVITY_IDS] } },
      }),
    ).toBe(0);
    expect(
      await prisma.approval.count({
        where: { id: { in: [...DEMO_APPROVAL_IDS] } },
      }),
    ).toBe(0);
    expect(
      await prisma.cronJob.count({ where: { id: { in: [...DEMO_CRON_IDS] } } }),
    ).toBe(0);
    expect(
      await prisma.device.count({ where: { id: { in: DEMO_DEVICE_IDS } } }),
    ).toBe(0);
    expect(
      await prisma.memoryEntry.count({
        where: { id: { startsWith: 'demo-' } },
      }),
    ).toBe(0);
    expect(
      await prisma.customTool.count({ where: { id: DEMO_CUSTOM_TOOL_ID } }),
    ).toBe(0);
    expect(
      await prisma.agent.count({
        where: { id: { in: [...DEMO_AGENT_IDS] }, source: 'default' },
      }),
    ).toBe(0);
    expect(
      await prisma.setting.findUnique({ where: { id: SETTING_ID } }),
    ).toBeNull();

    const usageRows = await prisma.usageBucket.findMany({
      select: { id: true, providers: true, totalCost: true, day: true },
    });
    expect(usageRows.filter((row) => isUntouchedDemoUsage(row))).toHaveLength(
      0,
    );
    const usageDay = calendarDay(new Date(today), usageTimeZone());
    const overwritten = usageRows.find((row) => row.day === usageDay);
    expect(overwritten).toBeTruthy();
    expect(overwritten?.id.startsWith('demo-usage-')).toBe(true);
    expect(overwritten?.totalCost).toBeCloseTo(42.25, 4);

    const keptTicket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    expect(keptTicket?.title).toBe('API ticket that must stay');
    expect(keptTicket?.projectId).toBeNull();

    const keeper = await prisma.agent.findUnique({
      where: { id: 'keeper_bot' },
    });
    expect(keeper?.source).toBe('registered');
    const ribbon = await prisma.agent.findUnique({ where: { id: 'ribbon' } });
    expect(ribbon?.source).toBe('snapshot');
    const keptDefault = await prisma.agent.findUnique({
      where: { id: 'kept_default' },
    });
    expect(keptDefault?.source).toBe('default');
    expect(
      await prisma.session.findUnique({ where: { id: 'user-session-keep' } }),
    ).toBeTruthy();
    expect(
      await prisma.cronJob.findUnique({ where: { id: 'user-cron-keep' } }),
    ).toBeTruthy();

    expect(
      await readFile(
        path.join(docsRoot, ...edited.relative.split('/')),
        'utf8',
      ),
    ).toBe('edited by a person\n');
    await expect(
      readFile(path.join(docsRoot, ...removedDoc!.relative.split('/')), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const mission = await call()
      .put('/mission')
      .send({ mission: 'Operator mission' });
    expect(mission.status).toBe(200);

    const second = await run('npm', ['run', 'seed:clear'], childEnv);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('agents=0');
    expect(second.stdout).toContain('tickets=0');

    expect(
      (await prisma.agent.findUnique({ where: { id: 'keeper_bot' } }))?.source,
    ).toBe('registered');
    expect(
      await prisma.ticket.findUnique({ where: { id: ticketId } }),
    ).toBeTruthy();
    expect(
      (await prisma.agent.findUnique({ where: { id: 'ribbon' } }))?.source,
    ).toBe('snapshot');
    expect(
      (await prisma.setting.findUnique({ where: { id: SETTING_ID } }))?.mission,
    ).toBe('Operator mission');
    expect(
      await prisma.usageBucket.findUnique({
        where: { day: usageDay },
      }),
    ).toBeTruthy();
  });
});
