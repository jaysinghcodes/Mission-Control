import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  type INestApplication,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { bodyMessage, promiseFn, responseJson } from '../../test/lint-helpers';
import { hashPassword } from '../auth/password';
import { resetBundledPeerCache } from '../auth/bundled-proxy';
import { SessionAuthMiddleware } from '../auth/session-auth.middleware';
import { signSession } from '../auth/session';
import { WriteAuthMiddleware } from '../auth/write-auth.middleware';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsController } from './tickets.controller';

/**
 * Compose is not loopback. The bundled proxy peer is the nginx address.
 * An agent token may create a ticket and patch status, assignee, title,
 * and description. Delete and every other write stay 401.
 */
const TOKEN = 'ticket-compose-token';
const NGINX = '172.18.0.4';
const ACTOR = 'forge_helper';
const SECRET = 'ticket-token-session-secret';

type TicketRow = {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  assignee: string | null;
  tags: string[];
  projectId: string | null;
  description: string;
};

type AgentRow = { id: string; name: string; source: string };

function makePrisma() {
  const tickets = new Map<string, TicketRow>();
  const agents = new Map<string, AgentRow>([
    [ACTOR, { id: ACTOR, name: 'Forge Helper', source: 'registered' }],
    ['snap_bot', { id: 'snap_bot', name: 'Snap', source: 'snapshot' }],
  ]);
  const activity: { type: string; payload: Record<string, unknown> }[] = [];
  let nextId = 1;
  const ticket = {
    create: promiseFn(({ data }: { data: Omit<TicketRow, 'id'> }) => {
      const row: TicketRow = {
        ...data,
        id: `id-${nextId++}`,
        projectId: data.projectId ?? null,
        description: data.description ?? '',
      };
      tickets.set(row.id, row);
      return row;
    }),
    update: promiseFn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<TicketRow>;
      }) => {
        const row = tickets.get(where.id);
        if (!row) throw new Error('missing');
        Object.assign(row, data);
        return { ...row };
      },
    ),
  };
  const tx = {
    $queryRaw: promiseFn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('MAX(')) {
          const nums = [...tickets.values()]
            .map((row) => /^MC-([0-9]+)$/.exec(row.key)?.[1])
            .filter((n): n is string => n !== undefined)
            .map((n) => BigInt(n));
          const max = nums.length
            ? nums.reduce((a, b) => (a > b ? a : b))
            : null;
          return [{ max }];
        }
        const row = tickets.get(values[0] as string);
        return row
          ? [
              {
                id: row.id,
                status: row.status,
                assignee: row.assignee,
                priority: row.priority,
                projectId: row.projectId,
                title: row.title,
                description: row.description,
              },
            ]
          : [];
      },
    ),
    $executeRaw: promiseFn(() => 1),
    ticket,
  };
  const prisma = {
    ticket,
    agent: {
      findUnique: promiseFn(
        ({ where }: { where: { id: string } }) => agents.get(where.id) ?? null,
      ),
      findMany: promiseFn(() =>
        [...agents.values()].map((agent) => ({
          id: agent.id,
          name: agent.name,
        })),
      ),
    },
    activityEvent: {
      create: promiseFn(
        ({
          data,
        }: {
          data: { type: string; payload: Record<string, unknown> };
        }) => {
          activity.push({ type: data.type, payload: data.payload });
          return {};
        },
      ),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { prisma, tickets, activity };
}

@Module({
  controllers: [TicketsController],
  providers: [
    SessionAuthMiddleware,
    WriteAuthMiddleware,
    { provide: PrismaService, useValue: {} },
    { provide: LiveActivityGateway, useValue: { broadcast: () => undefined } },
  ],
})
class TicketTokenModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionAuthMiddleware, WriteAuthMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

describe('agent ticket token on the compose path', () => {
  let app: INestApplication;
  let stateDir = '';
  let tickets: Map<string, TicketRow>;
  let activity: { type: string; payload: Record<string, unknown> }[];
  const saved = { ...process.env };
  const broadcasts: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const fake = makePrisma();
    tickets = fake.tickets;
    activity = fake.activity;
    process.env.INGEST_TOKEN = TOKEN;
    process.env.NODE_ENV = 'test';
    process.env.MC_COMPOSE = '1';
    process.env.BUNDLED_PROXY = NGINX;
    delete process.env.TRUSTED_PROXY;
    process.env.SESSION_SECRET = SECRET;
    process.env.DASHBOARD_PASSWORD_HASH = hashPassword('ticket-token-password');
    stateDir = mkdtempSync(join(tmpdir(), 'mc-ticket-token-'));
    process.env.SESSION_STATE_PATH = join(stateDir, 'state.json');
    resetBundledPeerCache();
    const moduleRef = await Test.createTestingModule({
      imports: [TicketTokenModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fake.prisma)
      .overrideProvider(LiveActivityGateway)
      .useValue({
        broadcast: (_type: string, payload: Record<string, unknown>) => {
          broadcasts.push(payload);
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const peer = req.header('x-test-peer');
      if (peer) {
        Object.defineProperty(req.socket, 'remoteAddress', {
          configurable: true,
          value: peer,
        });
      }
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    if (stateDir) rmSync(stateDir, { recursive: true, force: true });
    process.env = { ...saved };
    resetBundledPeerCache();
    if (app) await app.close();
  });

  function compose(method: 'post' | 'patch' | 'delete' | 'put', path: string) {
    return request(app.getHttpServer())[method](path).set('x-test-peer', NGINX);
  }

  it('creates a ticket with the ingest token and records the actor', async () => {
    const res = await compose('post', '/tickets')
      .set('x-ingest-token', TOKEN)
      .set('x-actor-id', ACTOR)
      .send({ title: 'Compose ticket', description: 'from the agent' });
    expect(res.status).toBe(201);
    const created = responseJson<{
      ticket: { key: string; description: string };
    }>(res);
    expect(created.ticket.key).toBe('MC-150');
    expect(created.ticket.description).toBe('from the agent');
    const payload = activity.at(-1)?.payload;
    expect(payload).toMatchObject({
      name: 'MC-150 created',
      ticket: 'MC-150',
      agent: ACTOR,
      actor: ACTOR,
    });
    expect(JSON.stringify(payload)).not.toMatch(/[→←⇒\u2010-\u2015]/);
    expect(broadcasts.at(-1)).toMatchObject({ actor: ACTOR, agent: ACTOR });
  });

  it('patches status, assignee, title, and description with the token', async () => {
    const id = [...tickets.values()][0].id;
    const moved = await compose('patch', `/tickets/${id}`)
      .set('x-ingest-token', TOKEN)
      .set('x-actor-id', ACTOR)
      .send({ status: 'build', assignee: ACTOR });
    expect(moved.status).toBe(200);
    expect(
      responseJson<{ ticket: { status: string } }>(moved).ticket.status,
    ).toBe('build');
    expect(activity.at(-1)?.payload).toMatchObject({
      name: 'MC-150 moved to Build',
      agent: ACTOR,
      actor: ACTOR,
    });
    const edited = await compose('patch', `/tickets/${id}`)
      .set('x-ingest-token', TOKEN)
      .send({
        title: 'Renamed',
        description: 'narrow patch',
        actor: ACTOR,
      });
    expect(edited.status).toBe(200);
    const renamed = responseJson<{
      ticket: { title: string; description: string };
    }>(edited);
    expect(renamed.ticket.title).toBe('Renamed');
    expect(renamed.ticket.description).toBe('narrow patch');
    expect(activity.at(-1)?.payload).toMatchObject({
      name: 'MC-150 updated',
      actor: ACTOR,
    });
  });

  it('rejects a token patch of priority, project, or tags and leaves the row', async () => {
    const row = [...tickets.values()][0];
    const before = { ...row };
    for (const body of [
      { priority: 'high', actor: ACTOR },
      { projectId: 'proj-1', actor: ACTOR },
      { tags: ['a'], actor: ACTOR },
    ]) {
      const denied = await compose('patch', `/tickets/${row.id}`)
        .set('x-ingest-token', TOKEN)
        .set('x-actor-id', ACTOR)
        .send(body);
      expect(denied.status).toBe(400);
      expect(bodyMessage(denied)).toMatch(
        /status, assignee, title, and description/,
      );
    }
    expect(tickets.get(row.id)).toMatchObject({
      status: before.status,
      priority: before.priority,
      title: before.title,
      projectId: before.projectId,
    });
  });

  it('rejects token delete and every other dashboard write', async () => {
    const id = [...tickets.values()][0].id;
    const removed = await compose('delete', `/tickets/${id}`)
      .set('x-ingest-token', TOKEN)
      .set('x-actor-id', ACTOR)
      .send({});
    expect(removed.status).toBe(401);
    expect(responseJson(removed)).toEqual({
      statusCode: 401,
      message: 'unauthorized',
    });
    expect(tickets.has(id)).toBe(true);
    const project = await compose('post', '/projects')
      .set('x-ingest-token', TOKEN)
      .send({ name: 'Nope' });
    expect(project.status).toBe(401);
    const mission = await compose('put', '/mission')
      .set('x-ingest-token', TOKEN)
      .send({ mission: 'Nope' });
    expect(mission.status).toBe(401);
  });

  it('returns 401 with no token or a wrong token', async () => {
    const open = await compose('post', '/tickets').send({
      title: 'Missing token',
      actor: ACTOR,
    });
    expect(open.status).toBe(401);
    const wrong = await compose('post', '/tickets')
      .set('x-ingest-token', 'not-the-token')
      .set('x-actor-id', ACTOR)
      .send({ title: 'Wrong token' });
    expect(wrong.status).toBe(401);
    expect(tickets.size).toBe(1);
  });

  it('requires a registered agent id and lets the header win', async () => {
    const missing = await compose('post', '/tickets')
      .set('x-ingest-token', TOKEN)
      .send({ title: 'No actor' });
    expect(missing.status).toBe(400);
    expect(bodyMessage(missing)).toBe('actor must be a registered agent id');
    const unknown = await compose('post', '/tickets')
      .set('x-ingest-token', TOKEN)
      .set('x-actor-id', 'not_a_bot')
      .send({ title: 'Unknown' });
    expect(unknown.status).toBe(400);
    const snapshot = await compose('post', '/tickets')
      .set('x-ingest-token', TOKEN)
      .send({ title: 'Snapshot', actor: 'snap_bot' });
    expect(snapshot.status).toBe(400);
    const header = await compose('post', '/tickets')
      .set('x-ingest-token', TOKEN)
      .set('x-actor-id', ACTOR)
      .send({ title: 'Header wins', actor: 'snap_bot' });
    expect(header.status).toBe(201);
    expect(activity.at(-1)?.payload).toMatchObject({ actor: ACTOR });
  });

  it('keeps loopback open and keeps a session cookie ahead of a wrong token', async () => {
    const loopback = await request(app.getHttpServer())
      .post('/tickets')
      .send({ title: 'Loopback' });
    expect(loopback.status).toBe(201);
    expect(activity.at(-1)?.payload).not.toHaveProperty('actor');

    const cookie = `mc_session=${encodeURIComponent(signSession(SECRET, 3600))}`;
    const session = await compose('post', '/tickets')
      .set('Cookie', cookie)
      .set('x-ingest-token', 'not-the-token')
      .send({ title: 'Session' });
    expect(session.status).toBe(201);
    expect(activity.at(-1)?.payload).not.toHaveProperty('actor');
  });
});
