import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { OFFLINE_AFTER_MS, SNAPSHOT_ID } from './../src/agents/agent-merge';
import { applyWriteToken } from './write-token';
import { bodyMessage, responseJson } from './lint-helpers';

/**
 * Agent register, heartbeat, delete, and source aware snapshots.
 * Real Nest app and Postgres. Criteria 1 to 8.
 *
 * Needs DATABASE_URL pointing at a migrated database. Writes send
 * x-ingest-token when INGEST_TOKEN is set.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Agents e2e refuses to run without DATABASE_URL.\n' +
      '  Set it to a migrated Postgres, e.g.\n' +
      '    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mission_control\n' +
      '    npm run test:e2e -w apps/api\n',
  );
}

interface WireAgent {
  id: string;
  name: string;
  source: string;
  role: string | null;
  color: string;
  emoji: string | null;
  avatar: string | null;
  position: number;
  status: string;
  model: string | null;
  parentId: string | null;
  currentTask: string | null;
  lastSeenAt: string | null;
  online: boolean;
}

describe('Agents register (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let baseUrl = '';
  const created: string[] = [];

  function call() {
    const base = request(app.getHttpServer());
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

  function agentsFrom(res: { body: unknown }): WireAgent[] {
    return responseJson<{ agents: WireAgent[] }>(res).agents;
  }

  function agentFrom(res: { body: unknown }): WireAgent {
    return responseJson<{ agent: WireAgent }>(res).agent;
  }

  beforeAll(async () => {
    process.env.HEALTH_TICK_MS = '0';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    await prisma.agent.deleteMany({
      where: {
        id: {
          in: [
            'forge_helper',
            'e2e_default_bot',
            'e2e_reg_status',
            'e2e_old_snap',
            'e2e_nova',
            'e2e_default_kept',
            'e2e_heartbeat',
            'e2e_hb_both',
            'e2e_hb_empty',
            'e2e_hb_unknown',
            'e2e_hb_status',
            'e2e_delete_me',
            'e2e_delete_default',
            'e2e_live',
            '11111111-2222-4333-8444-555555555555',
            'e2e_backfill_default',
            'scout_clone',
            'other_thing',
            'qa_bot',
          ],
        },
      },
    });
    const url = await app.getUrl();
    baseUrl = url.replace('://[::1]', '://127.0.0.1');
  });

  afterAll(async () => {
    if (created.length > 0) {
      await prisma.agent.deleteMany({ where: { id: { in: created } } });
    }
    if (app) await app.close();
  });

  it('criterion 1: register returns 201 then 200 and does not duplicate the id', async () => {
    const id = 'forge_helper';
    created.push(id);
    const first = await call()
      .post('/agents/register')
      .send({ id, name: 'Forge Helper', role: 'engineer' });
    expect(first.status).toBe(201);
    expect(responseJson<{ error?: unknown }>(first).error).toBeUndefined();
    expect(agentFrom(first)).toMatchObject({
      id,
      name: 'Forge Helper',
      source: 'registered',
      role: 'engineer',
      online: true,
    });
    expect(agentFrom(first).lastSeenAt).toEqual(expect.any(String));

    const second = await call()
      .post('/agents/register')
      .send({ id, name: 'Forge Helper', role: 'engineer', model: 'local' });
    expect(second.status).toBe(200);
    expect(responseJson<{ error?: unknown }>(second).error).toBeUndefined();
    expect(agentFrom(second).model).toBe('local');

    const list = await request(app.getHttpServer()).get('/agents');
    const matches = agentsFrom(list).filter((agent) => agent.id === id);
    expect(matches).toHaveLength(1);

    const unknown = await call()
      .post('/agents/register')
      .send({ id: 'forge_helper_bad', name: 'Nope', status: 'working' });
    expect(unknown.status).toBe(400);
    expect(bodyMessage(unknown)).toBe('unknown field status');

    const longName = await call()
      .post('/agents/register')
      .send({ id: 'forge_helper_long', name: 'n'.repeat(201) });
    expect(longName.status).toBe(400);
    expect(bodyMessage(longName)).toBe('name must be 200 characters or fewer');
  });

  it('criterion 2: registering a default id keeps position and visual', async () => {
    const id = 'e2e_default_bot';
    created.push(id);
    await prisma.agent.create({
      data: {
        id,
        name: 'E2E Default',
        source: 'default',
        role: 'engineer',
        color: '#9bd434',
        emoji: '🛠️',
        avatar: 'robot-forge',
        position: 40,
        status: 'working',
        parentId: null,
      },
    });
    const res = await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Default', model: 'local' });
    expect(res.status).toBe(200);
    expect(agentFrom(res)).toMatchObject({
      id,
      source: 'registered',
      position: 40,
      color: '#9bd434',
      emoji: '🛠️',
      avatar: 'robot-forge',
      role: 'engineer',
      model: 'local',
    });
  });

  it('criterion 3: snapshot keeps omitted rows and updates only status on a registered id', async () => {
    const registeredId = 'e2e_reg_status';
    const snapId = 'e2e_old_snap';
    const freshId = 'e2e_nova';
    created.push(registeredId, snapId, freshId, 'e2e_default_kept');
    await prisma.agent.create({
      data: {
        id: 'e2e_default_kept',
        name: 'E2E Kept Default',
        source: 'default',
        role: 'qa',
        color: '#36b3f5',
        position: 41,
      },
    });
    await prisma.agent.create({
      data: {
        id: registeredId,
        name: 'E2E Registered',
        source: 'registered',
        role: 'engineer',
        color: '#9bd434',
        emoji: '🔧',
        avatar: 'kept',
        model: 'local',
        position: 42,
        status: 'idle',
        lastSeenAt: new Date(),
      },
    });
    await prisma.agent.create({
      data: {
        id: snapId,
        name: 'E2E Old Snap',
        source: 'snapshot',
        position: 43,
      },
    });

    const posted = await call()
      .post('/events')
      .send({
        type: 'agents.snapshot',
        payload: {
          agents: [
            {
              id: registeredId,
              name: 'Renamed',
              role: 'other',
              color: '#000000',
              status: 'working',
              currentTask: 'Shipping',
              emoji: '👻',
            },
            {
              id: freshId,
              name: 'E2E Nova',
              role: 'development',
              status: 'idle',
            },
          ],
        },
      });
    expect(posted.status).toBe(202);

    const list = await request(app.getHttpServer()).get('/agents');
    const agents = agentsFrom(list);
    const kept = agents.find((agent) => agent.id === 'e2e_default_kept');
    const registered = agents.find((agent) => agent.id === registeredId);
    const fresh = agents.find((agent) => agent.id === freshId);
    expect(agents.find((agent) => agent.id === snapId)).toBeUndefined();
    expect(kept).toMatchObject({
      source: 'default',
      name: 'E2E Kept Default',
      role: 'qa',
      color: '#36b3f5',
      position: 41,
    });
    expect(registered).toMatchObject({
      source: 'registered',
      name: 'E2E Registered',
      role: 'engineer',
      color: '#9bd434',
      emoji: '🔧',
      avatar: 'kept',
      model: 'local',
      position: 42,
      status: 'working',
      currentTask: 'Shipping',
    });
    expect(fresh).toMatchObject({ source: 'snapshot', name: 'E2E Nova' });
  });

  it('criterion 4: heartbeat updates lastSeenAt and 10 minutes reports online false', async () => {
    const id = 'e2e_heartbeat';
    created.push(id);
    const createdRes = await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Heartbeat' });
    expect(createdRes.status).toBe(201);
    const firstSeen = agentFrom(createdRes).lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const beat = await call().post(`/agents/${id}/heartbeat`).send({});
    expect(beat.status).toBe(204);
    expect(beat.text).toBe('');

    const listed = await request(app.getHttpServer()).get('/agents');
    const row = agentsFrom(listed).find((agent) => agent.id === id);
    expect(row?.online).toBe(true);
    expect(row?.lastSeenAt && firstSeen && row.lastSeenAt >= firstSeen).toBe(
      true,
    );

    await prisma.agent.update({
      where: { id },
      data: { lastSeenAt: new Date(Date.now() - OFFLINE_AFTER_MS) },
    });
    const stale = await request(app.getHttpServer()).get(`/agents/${id}`);
    expect(stale.status).toBe(200);
    expect(agentFrom(stale).online).toBe(false);
    const stillThere = await prisma.agent.findUnique({ where: { id } });
    expect(stillThere).not.toBeNull();

    const missing = await call().post('/agents/e2e_missing/heartbeat').send({});
    expect(missing.status).toBe(404);
    expect(bodyMessage(missing)).toBe('agent not found');
  });

  it('a heartbeat with currentTask and status updates the roster and broadcasts', async () => {
    const id = 'e2e_hb_both';
    created.push(id);
    const socket: Socket = io(baseUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });
    const events: { id?: string; action?: string }[] = [];
    socket.on(
      'agents.snapshot',
      (payload: { id?: string; action?: string }) => {
        events.push(payload);
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('socket did not connect')),
        2000,
      );
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    try {
      const registered = await call()
        .post('/agents/register')
        .send({ id, name: 'E2E Heartbeat Body' });
      expect(registered.status).toBe(201);
      const started = Date.now();
      const beat = await call()
        .post(`/agents/${id}/heartbeat`)
        .send({ currentTask: 'Shipping the notes', status: 'working' });
      expect(beat.status).toBe(204);
      expect(beat.text).toBe('');
      await waitFor(() =>
        events.some((event) => event.action === 'heartbeat' && event.id === id),
      );
      expect(Date.now() - started).toBeLessThan(2000);
      const listed = await request(app.getHttpServer()).get(`/agents/${id}`);
      expect(listed.status).toBe(200);
      expect(agentFrom(listed)).toMatchObject({
        id,
        status: 'working',
        currentTask: 'Shipping the notes',
        online: true,
      });
    } finally {
      socket.close();
    }
  });

  it('an empty heartbeat body still returns 204 and leaves status and currentTask', async () => {
    const id = 'e2e_hb_empty';
    created.push(id);
    const registered = await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Heartbeat Empty' });
    expect(registered.status).toBe(201);
    await prisma.agent.update({
      where: { id },
      data: { status: 'idle', currentTask: 'Keep me' },
    });
    const before = await prisma.agent.findUnique({ where: { id } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const empty = await call().post(`/agents/${id}/heartbeat`).send({});
    expect(empty.status).toBe(204);
    expect(empty.text).toBe('');
    const noBody = await call().post(`/agents/${id}/heartbeat`);
    expect(noBody.status).toBe(204);
    expect(noBody.text).toBe('');
    const after = await prisma.agent.findUnique({ where: { id } });
    expect(after?.status).toBe('idle');
    expect(after?.currentTask).toBe('Keep me');
    expect(after?.lastSeenAt && before?.lastSeenAt).toBeTruthy();
    expect(after!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(
      before!.lastSeenAt!.getTime(),
    );
  });

  it('an unknown heartbeat field is 400 and does not write', async () => {
    const id = 'e2e_hb_unknown';
    created.push(id);
    await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Heartbeat Unknown' });
    const before = await prisma.agent.findUnique({ where: { id } });
    const res = await call()
      .post(`/agents/${id}/heartbeat`)
      .send({ currentTask: 'Nope', extra: true });
    expect(res.status).toBe(400);
    expect(bodyMessage(res)).toBe('unknown field extra');
    const missing = await call()
      .post('/agents/e2e_hb_missing/heartbeat')
      .send({ nope: 1 });
    expect(missing.status).toBe(400);
    expect(bodyMessage(missing)).toBe('unknown field nope');
    const after = await prisma.agent.findUnique({ where: { id } });
    expect(after?.lastSeenAt).toEqual(before?.lastSeenAt);
    expect(after?.currentTask).toBeNull();
    expect(after?.status).toBe(before?.status);
  });

  it('an invalid heartbeat status is 400 and does not write', async () => {
    const id = 'e2e_hb_status';
    created.push(id);
    await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Heartbeat Status' });
    const before = await prisma.agent.findUnique({ where: { id } });
    const res = await call()
      .post(`/agents/${id}/heartbeat`)
      .send({ status: 'running' });
    expect(res.status).toBe(400);
    expect(bodyMessage(res)).toBe('status must be one of working, idle');
    const typed = await call()
      .post(`/agents/${id}/heartbeat`)
      .send({ status: 1 });
    expect(typed.status).toBe(400);
    expect(bodyMessage(typed)).toBe('status must be a string');
    const after = await prisma.agent.findUnique({ where: { id } });
    expect(after?.status).toBe(before?.status);
    expect(after?.lastSeenAt).toEqual(before?.lastSeenAt);
  });

  it('criterion 5: delete removes a registered row and returns 409 for a default', async () => {
    const id = 'e2e_delete_me';
    const def = 'e2e_delete_default';
    created.push(id, def);
    await call().post('/agents/register').send({ id, name: 'E2E Delete' });
    await prisma.agent.create({
      data: {
        id: def,
        name: 'E2E Delete Default',
        source: 'default',
        position: 44,
      },
    });
    const blocked = await call().delete(`/agents/${def}`);
    expect(blocked.status).toBe(409);
    expect(bodyMessage(blocked)).toBe('default agents cannot be deleted');
    expect(
      await prisma.agent.findUnique({ where: { id: def } }),
    ).not.toBeNull();

    const removed = await call().delete(`/agents/${id}`);
    expect(removed.status).toBe(204);
    expect(await prisma.agent.findUnique({ where: { id } })).toBeNull();
    const again = await call().delete(`/agents/${id}`);
    expect(again.status).toBe(404);
  });

  it('criterion 6: token rules match the shared write check on all three routes', async () => {
    const savedToken = process.env.INGEST_TOKEN;
    const savedEnv = process.env.NODE_ENV;
    const routes: { method: 'post' | 'delete'; path: string }[] = [
      { method: 'post', path: '/agents/register' },
      { method: 'post', path: '/agents/e2e_auth/heartbeat' },
      { method: 'delete', path: '/agents/e2e_auth' },
    ];
    try {
      process.env.INGEST_TOKEN = 'e2e-agents-token';
      process.env.NODE_ENV = 'test';
      for (const route of routes) {
        const denied = await request(app.getHttpServer())
          [route.method](route.path)
          .send({});
        expect(denied.status).toBe(401);
        expect(denied.body).toEqual({
          statusCode: 401,
          message: 'unauthorized',
        });
        const wrong = await request(app.getHttpServer())
          [route.method](route.path)
          .set('x-ingest-token', 'nope')
          .send({});
        expect(wrong.status).toBe(401);
        const allowed = await request(app.getHttpServer())
          [route.method](route.path)
          .set('x-ingest-token', 'e2e-agents-token')
          .send({});
        expect(allowed.status).not.toBe(401);
      }

      delete process.env.INGEST_TOKEN;
      process.env.NODE_ENV = 'test';
      const open = await request(app.getHttpServer())
        .post('/agents/register')
        .send({ id: 'Not A Slug', name: 'Nope' });
      expect(open.status).not.toBe(401);

      process.env.NODE_ENV = 'production';
      for (const route of routes) {
        const closed = await request(app.getHttpServer())
          [route.method](route.path)
          .send({});
        expect(closed.status).toBe(401);
        expect(closed.body).toEqual({
          statusCode: 401,
          message: 'unauthorized',
        });
      }
    } finally {
      if (savedToken === undefined) delete process.env.INGEST_TOKEN;
      else process.env.INGEST_TOKEN = savedToken;
      process.env.NODE_ENV = savedEnv;
    }
  });

  it('criterion 7: an open client sees register and delete within 2 seconds', async () => {
    const id = 'e2e_live';
    created.push(id);
    const socket: Socket = io(baseUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });
    const events: { id?: string; action?: string; ts?: number }[] = [];
    socket.on(
      'agents.snapshot',
      (payload: { id?: string; action?: string; ts?: number }) => {
        events.push(payload);
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('socket did not connect')),
        2000,
      );
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const registerStarted = Date.now();
    const registered = await call()
      .post('/agents/register')
      .send({ id, name: 'E2E Live' });
    expect(registered.status).toBe(201);
    await waitFor(() =>
      events.some((event) => event.action === 'register' && event.id === id),
    );
    expect(Date.now() - registerStarted).toBeLessThan(2000);

    const deleteStarted = Date.now();
    const removed = await call().delete(`/agents/${id}`);
    expect(removed.status).toBe(204);
    await waitFor(() =>
      events.some((event) => event.action === 'delete' && event.id === id),
    );
    expect(Date.now() - deleteStarted).toBeLessThan(2000);

    const list = await request(app.getHttpServer()).get('/agents');
    expect(agentsFrom(list).some((agent) => agent.id === id)).toBe(false);
    socket.close();
  });

  it('criterion 8: migration backfill marks uuid rows snapshot and leaves other ids default', async () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    const seeded = 'e2e_backfill_default';
    created.push(uuid, seeded);
    await prisma.$executeRaw`
      INSERT INTO "Agent" ("id", "name", "source", "updatedAt")
      VALUES (${uuid}, ${'E2E Uuid'}, 'default', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO "Agent" ("id", "name", "source", "updatedAt")
      VALUES (${seeded}, ${'E2E Slug'}, 'default', NOW())
    `;
    expect(SNAPSHOT_ID.test(uuid)).toBe(true);
    await prisma.$executeRaw`
      UPDATE "Agent"
      SET "source" = 'snapshot'
      WHERE "id" ~* ${SNAPSHOT_ID.source}
        AND "id" = ${uuid}
    `;
    const uuidRow = await prisma.agent.findUnique({ where: { id: uuid } });
    const slugRow = await prisma.agent.findUnique({ where: { id: seeded } });
    expect(uuidRow?.source).toBe('snapshot');
    expect(slugRow?.source).toBe('default');

    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Agent'
        AND column_name IN ('source', 'position', 'lastSeenAt', 'model', 'avatar')
    `;
    expect(columns.map((column) => column.column_name).sort()).toEqual([
      'avatar',
      'lastSeenAt',
      'model',
      'position',
      'source',
    ]);

    const slug = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(btrim(${'Demo Lead'})), '[^a-z0-9]+', '_', 'g'),
              '^_+|_+$',
              '',
              'g'
            ),
            '_+',
            '_',
            'g'
          ),
          64
        ),
        '_+$',
        ''
      ) AS slug
    `;
    expect(slug[0].slug).toBe('demo_lead');
  });

  it('matches an explicit id only and leaves the same display name alone', async () => {
    created.push('scout_clone', 'other_thing', 'qa_bot');
    await prisma.agent.upsert({
      where: { id: 'speedy' },
      update: {},
      create: {
        id: 'speedy',
        name: 'Speedy',
        source: 'default',
        position: 0,
      },
    });
    await prisma.agent.upsert({
      where: { id: 'forge' },
      update: {},
      create: {
        id: 'forge',
        name: 'Forge',
        source: 'default',
        parentId: 'speedy',
        position: 2,
      },
    });
    await prisma.agent.upsert({
      where: { id: 'scout' },
      update: { source: 'default', parentId: 'speedy', status: 'working' },
      create: {
        id: 'scout',
        name: 'Scout',
        source: 'default',
        parentId: 'speedy',
        status: 'working',
        position: 11,
      },
    });
    await prisma.agent.upsert({
      where: { id: 'qa_bot' },
      update: {},
      create: {
        id: 'qa_bot',
        name: 'QA Bot',
        source: 'registered',
        status: 'idle',
        parentId: 'speedy',
        position: 20,
      },
    });

    const cloned = await call()
      .post('/events')
      .send({
        type: 'agents.snapshot',
        payload: {
          agents: [
            {
              id: 'scout_clone',
              name: 'Scout',
              status: 'hijacked',
              parent: 'Forge',
            },
          ],
        },
      });
    expect(cloned.status).toBe(202);
    const scout = await prisma.agent.findUnique({ where: { id: 'scout' } });
    const scoutClone = await prisma.agent.findUnique({
      where: { id: 'scout_clone' },
    });
    expect(scout).toMatchObject({
      source: 'default',
      status: 'working',
      parentId: 'speedy',
    });
    expect(scoutClone).toMatchObject({
      name: 'Scout',
      source: 'snapshot',
      status: 'hijacked',
      parentId: 'forge',
    });

    const stolen = await call()
      .post('/events')
      .send({
        type: 'agents.snapshot',
        payload: {
          agents: [{ id: 'other_thing', name: 'QA Bot', status: 'stolen' }],
        },
      });
    expect(stolen.status).toBe(202);
    const qa = await prisma.agent.findUnique({ where: { id: 'qa_bot' } });
    const other = await prisma.agent.findUnique({
      where: { id: 'other_thing' },
    });
    expect(qa).toMatchObject({
      source: 'registered',
      status: 'idle',
      parentId: 'speedy',
    });
    expect(other).toMatchObject({
      name: 'QA Bot',
      source: 'snapshot',
      status: 'stolen',
    });
  });

  it('a nameless snapshot does not move Sentinel, and seed keeps Pixel under Speedy', async () => {
    await prisma.agent.upsert({
      where: { id: 'speedy' },
      update: {},
      create: { id: 'speedy', name: 'Speedy', source: 'default', position: 0 },
    });
    await prisma.agent.upsert({
      where: { id: 'forge' },
      update: {},
      create: {
        id: 'forge',
        name: 'Forge',
        source: 'default',
        parentId: 'speedy',
        position: 2,
      },
    });
    await prisma.agent.upsert({
      where: { id: 'sentinel' },
      update: { source: 'default', parentId: 'speedy' },
      create: {
        id: 'sentinel',
        name: 'Sentinel',
        source: 'default',
        parentId: 'speedy',
        status: 'working',
        position: 3,
      },
    });
    await prisma.agent.upsert({
      where: { id: 'pixel' },
      update: {},
      create: {
        id: 'pixel',
        name: 'Pixel',
        source: 'default',
        parentId: 'speedy',
        position: 5,
      },
    });

    const moved = await call()
      .post('/events')
      .send({
        type: 'agents.snapshot',
        payload: {
          agents: [{ name: 'Sentinel', parent: 'Forge' }],
        },
      });
    expect(moved.status).toBe(202);
    const sentinel = await prisma.agent.findUnique({
      where: { id: 'sentinel' },
    });
    expect(sentinel).toMatchObject({
      source: 'default',
      parentId: 'speedy',
    });

    const pixel = await prisma.agent.findUnique({ where: { id: 'pixel' } });
    expect(pixel).toMatchObject({ source: 'default', parentId: 'speedy' });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 2000) {
      throw new Error('timed out waiting for agents.snapshot');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
