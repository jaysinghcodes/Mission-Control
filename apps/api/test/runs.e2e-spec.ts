import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { applyWriteToken } from './write-token';
import { bodyMessage, responseJson } from './lint-helpers';

/**
 * Runs e2e. Real Nest app and Postgres.
 * POST is 201, PATCH is 200, bad fields are 400, unknown ids are 404.
 * No 200 body contains an error key.
 *
 * Needs DATABASE_URL pointing at a migrated database. Writes send
 * x-ingest-token when INGEST_TOKEN is set.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Runs e2e refuses to run without DATABASE_URL.\n' +
      '  Set it to a migrated Postgres, e.g.\n' +
      '    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mission_control\n' +
      '    npm run test:e2e -w apps/api\n',
  );
}

describe('Runs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tickets: string[] = [];
  const runs: string[] = [];

  function call() {
    const base = request(app.getHttpServer());
    const token = process.env.INGEST_TOKEN;
    if (typeof token !== 'string' || token.trim() === '') return base;
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

  function runFrom(res: { body: unknown }): {
    id: string;
    name: string;
    agent: string;
    status: string;
    progress: number;
    ticketId: string | null;
  } {
    return responseJson<{
      run: {
        id: string;
        name: string;
        agent: string;
        status: string;
        progress: number;
        ticketId: string | null;
      };
    }>(res).run;
  }

  function runsFrom(res: { body: unknown }): { id: string }[] {
    return responseJson<{ runs: { id: string }[] }>(res).runs;
  }

  function ticketIdFrom(res: { body: unknown }): string {
    return responseJson<{ ticket: { id: string } }>(res).ticket.id;
  }

  function noError(body: { error?: unknown }) {
    expect(body.error).toBeUndefined();
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    if (!prisma.dbReady) {
      throw new Error('Runs e2e needs Postgres at DATABASE_URL');
    }
  });

  afterAll(async () => {
    if (prisma) {
      try {
        if (runs.length) {
          await prisma.activityEvent.deleteMany({
            where: {
              OR: runs.map((id) => ({ payload: { path: ['id'], equals: id } })),
            },
          });
          await prisma.run.deleteMany({ where: { id: { in: runs } } });
        }
        if (tickets.length) {
          await prisma.ticket.deleteMany({ where: { id: { in: tickets } } });
        }
      } catch (err) {
        console.warn('[runs.e2e] cleanup failed:', err);
      }
    }
    if (app) await app.close();
  });

  async function createTicket(title: string) {
    const res = await call().post('/tickets').send({ title, status: 'todo' });
    expect(res.status).toBe(201);
    tickets.push(ticketIdFrom(res));
    return ticketIdFrom(res);
  }

  describe('POST /runs', () => {
    it('missing name is 400 and the message names name', async () => {
      const res = await call().post('/runs').send({});
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/name/);
    });

    it('a non string name is 400 and names name', async () => {
      const res = await call().post('/runs').send({ name: 4 });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/name/);
    });

    it('an unknown ticketId is 404 and nothing is inserted', async () => {
      const before = await prisma.run.count();
      const res = await call()
        .post('/runs')
        .send({ name: 'Orphan run', ticketId: 'missing-ticket' });
      expect(res.status).toBe(404);
      expect(bodyMessage(res)).toMatch(/ticketId/);
      expect(await prisma.run.count()).toBe(before);
    });

    it('a bad ticketId type is 400 and names ticketId', async () => {
      const res = await call()
        .post('/runs')
        .send({ name: 'Bad link', ticketId: 9 });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/ticketId/);
    });

    it('creates 201 with no error key, and without a ticket the link stays empty', async () => {
      const res = await call()
        .post('/runs')
        .send({ name: 'Loose run', agent: 'Quill' });
      expect(res.status).toBe(201);
      noError(res.body);
      expect(runFrom(res).ticketId).toBeNull();
      expect(runFrom(res).status).toBe('queued');
      runs.push(runFrom(res).id);
    });

    it('a 20KB name or agent is 400 and the message names the field', async () => {
      const huge = 'n'.repeat(20 * 1024);
      const before = await prisma.run.count();
      const name = await call().post('/runs').send({ name: huge });
      expect(name.status).toBe(400);
      expect(bodyMessage(name)).toMatch(/name/);
      const agent = await call()
        .post('/runs')
        .send({ name: 'Short', agent: huge });
      expect(agent.status).toBe(400);
      expect(bodyMessage(agent)).toMatch(/agent/);
      expect(await prisma.run.count()).toBe(before);
    });

    it('a name over 200 or an agent over 100 is 400, and the cap itself is accepted', async () => {
      const over = await call()
        .post('/runs')
        .send({ name: 'n'.repeat(201), agent: 'a'.repeat(101) });
      expect(over.status).toBe(400);
      expect(bodyMessage(over)).toMatch(/name/);

      const res = await call()
        .post('/runs')
        .send({ name: 'n'.repeat(200), agent: 'a'.repeat(100) });
      expect(res.status).toBe(201);
      noError(res.body);
      expect([...runFrom(res).name].length).toBe(200);
      expect([...runFrom(res).agent].length).toBe(100);
      runs.push(runFrom(res).id);

      const agent = await call()
        .patch(`/runs/${runFrom(res).id}`)
        .send({ agent: 'a'.repeat(101) });
      expect(agent.status).toBe(400);
      expect(bodyMessage(agent)).toMatch(/agent/);
    });

    it('counts emoji as characters: 200 and 100 pass, 201 and 101 fail', async () => {
      const emoji = '😀';
      const overName = await call()
        .post('/runs')
        .send({ name: emoji.repeat(201) });
      expect(overName.status).toBe(400);
      expect(bodyMessage(overName)).toMatch(/name/);
      const overAgent = await call()
        .post('/runs')
        .send({ name: 'Emoji agent', agent: emoji.repeat(101) });
      expect(overAgent.status).toBe(400);
      expect(bodyMessage(overAgent)).toMatch(/agent/);

      const res = await call()
        .post('/runs')
        .send({ name: emoji.repeat(200), agent: emoji.repeat(100) });
      expect(res.status).toBe(201);
      noError(res.body);
      const name = runFrom(res).name;
      const agent = runFrom(res).agent;
      expect([...name].length).toBe(200);
      expect([...agent].length).toBe(100);
      expect(name).toHaveLength(400);
      expect(agent).toHaveLength(200);
      runs.push(runFrom(res).id);
    });

    it('an unknown field, including status, is 400 and nothing is inserted', async () => {
      const before = await prisma.run.count();
      const status = await call()
        .post('/runs')
        .send({ name: 'No status here', status: 'running' });
      expect(status.status).toBe(400);
      expect(bodyMessage(status)).toMatch(/status/);
      const extra = await call()
        .post('/runs')
        .send({ name: 'No extra', extra: true });
      expect(extra.status).toBe(400);
      expect(bodyMessage(extra)).toMatch(/extra/);
      expect(await prisma.run.count()).toBe(before);
    });

    it('creates 201 and persists a real ticketId', async () => {
      const ticketId = await createTicket('e2e run parent');
      const res = await call()
        .post('/runs')
        .send({ name: 'Linked run', agent: 'Forge', ticketId });
      expect(res.status).toBe(201);
      noError(res.body);
      expect(runFrom(res).ticketId).toBe(ticketId);
      runs.push(runFrom(res).id);

      const row = await prisma.run.findUnique({
        where: { id: runFrom(res).id },
      });
      expect(row?.ticketId).toBe(ticketId);

      const listed = await request(app.getHttpServer())
        .get('/runs')
        .query({ ticketId });
      expect(listed.status).toBe(200);
      noError(listed.body);
      expect(runsFrom(listed).map((row: { id: string }) => row.id)).toContain(
        runFrom(res).id,
      );
    });
  });

  describe('PATCH /runs/:id', () => {
    it('an unknown run is 404', async () => {
      const res = await call()
        .patch('/runs/missing-run')
        .send({ status: 'done' });
      expect(res.status).toBe(404);
      expect(bodyMessage(res)).toMatch(/run/);
    });

    it('a bad status is 400 and names status', async () => {
      const created = await call().post('/runs').send({ name: 'Patch me' });
      expect(created.status).toBe(201);
      runs.push(runFrom(created).id);
      const res = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ status: 'shipped' });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/status/);
      const row = await prisma.run.findUnique({
        where: { id: runFrom(created).id },
      });
      expect(row?.status).toBe('queued');
    });

    it('a bad progress is 400 and names progress', async () => {
      const created = await call().post('/runs').send({ name: 'Progress me' });
      runs.push(runFrom(created).id);
      const res = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ progress: 'fast' });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/progress/);
    });

    it('an unknown ticketId is 404 and the row stays unchanged', async () => {
      const created = await call().post('/runs').send({ name: 'Stay queued' });
      runs.push(runFrom(created).id);
      const res = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ ticketId: 'missing-ticket', status: 'done' });
      expect(res.status).toBe(404);
      expect(bodyMessage(res)).toMatch(/ticketId/);
      const row = await prisma.run.findUnique({
        where: { id: runFrom(created).id },
      });
      expect(row?.status).toBe('queued');
      expect(row?.ticketId).toBeNull();
    });

    it('an unknown field is 400 and the row stays unchanged', async () => {
      const created = await call()
        .post('/runs')
        .send({ name: 'Stay put', agent: 'Quill' });
      expect(created.status).toBe(201);
      runs.push(runFrom(created).id);
      const before = await prisma.run.findUnique({
        where: { id: runFrom(created).id },
      });
      const res = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ status: 'done', bogus: 1 });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/bogus/);
      const after = await prisma.run.findUnique({
        where: { id: runFrom(created).id },
      });
      expect(after?.status).toBe(before?.status);
      expect(after?.agent).toBe('Quill');
    });

    it('a no-op PATCH is 200, leaves the run unchanged, and writes no activity event', async () => {
      const created = await call()
        .post('/runs')
        .send({ name: 'Already queued', agent: 'Quill' });
      expect(created.status).toBe(201);
      runs.push(runFrom(created).id);
      const id = runFrom(created).id;
      const beforeRow = await prisma.run.findUnique({ where: { id } });
      const beforeEvents = await prisma.activityEvent.count({
        where: { payload: { path: ['id'], equals: id } },
      });
      expect(beforeEvents).toBeGreaterThan(0);

      const empty = await call().patch(`/runs/${id}`).send({});
      expect(empty.status).toBe(200);
      noError(empty.body);
      expect(runFrom(empty).status).toBe('queued');
      expect(runFrom(empty).agent).toBe('Quill');
      expect(runFrom(empty).progress).toBe(0);
      expect(runFrom(empty).ticketId).toBeNull();

      const repeated = await call().patch(`/runs/${id}`).send({
        status: 'queued',
        progress: 0,
        agent: 'Quill',
        ticketId: null,
      });
      expect(repeated.status).toBe(200);
      noError(repeated.body);
      expect(runFrom(repeated).status).toBe('queued');

      const afterRow = await prisma.run.findUnique({ where: { id } });
      expect(afterRow?.status).toBe(beforeRow?.status);
      expect(afterRow?.progress).toBe(beforeRow?.progress);
      expect(afterRow?.agent).toBe(beforeRow?.agent);
      expect(afterRow?.ticketId).toBe(beforeRow?.ticketId);
      expect(afterRow?.startedAt).toEqual(beforeRow?.startedAt);
      expect(afterRow?.finishedAt).toEqual(beforeRow?.finishedAt);
      const afterEvents = await prisma.activityEvent.count({
        where: { payload: { path: ['id'], equals: id } },
      });
      expect(afterEvents).toBe(beforeEvents);

      const moved = await call()
        .patch(`/runs/${id}`)
        .send({ status: 'running' });
      expect(moved.status).toBe(200);
      expect(runFrom(moved).status).toBe('running');
      const afterMove = await prisma.activityEvent.count({
        where: { payload: { path: ['id'], equals: id } },
      });
      expect(afterMove).toBe(beforeEvents + 1);
    });

    it('updates 200 with no error key and can set then clear ticketId', async () => {
      const ticketId = await createTicket('e2e patch parent');
      const created = await call().post('/runs').send({ name: 'Move me' });
      expect(created.status).toBe(201);
      runs.push(runFrom(created).id);

      const linked = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ status: 'running', progress: 40, ticketId });
      expect(linked.status).toBe(200);
      noError(linked.body);
      expect(runFrom(linked).status).toBe('running');
      expect(runFrom(linked).progress).toBe(40);
      expect(runFrom(linked).ticketId).toBe(ticketId);

      const cleared = await call()
        .patch(`/runs/${runFrom(created).id}`)
        .send({ ticketId: null, status: 'done', progress: 100 });
      expect(cleared.status).toBe(200);
      noError(cleared.body);
      expect(runFrom(cleared).ticketId).toBeNull();
      expect(runFrom(cleared).status).toBe('done');
    });
  });
});
