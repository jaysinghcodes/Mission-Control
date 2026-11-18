import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { applyWriteToken } from './write-token';
import { bodyMessage, responseJson } from './lint-helpers';
import { hashPassword } from '../src/auth/password';

/**
 * Tickets e2e — real Nest app + REAL Postgres (PR #20 QA findings A–E + QA-1).
 *
 * Needs a migrated database at DATABASE_URL, e.g.
 *   docker compose up -d db
 *   (cd apps/api && npx prisma migrate deploy)
 *   DATABASE_URL=… npm run test:e2e -w apps/api
 *
 * QA-1 #4: without DATABASE_URL, PrismaService falls back to localhost:5432.
 * That is fine for `npm run dev`, but for e2e it silently targets whoever
 * owns that port (often someone else's DB) and leaves rows behind. Fail
 * FAST here, before Nest boots and before any create runs — and clean up
 * every ticket + its activity events we create, even when a test fails.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Tickets e2e refuses to run without DATABASE_URL.\n' +
      '  Set it to a migrated Postgres, e.g.\n' +
      '    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mission_control\n' +
      '    npm run test:e2e -w apps/api\n' +
      '  (PrismaService would otherwise silently fall back to localhost:5432.)',
  );
}

describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const created: string[] = [];
  /** Restored after the file. Other e2e files register agents in this database. */
  let savedManual: boolean | null = null;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Writes send x-ingest-token when INGEST_TOKEN is set. Reads stay plain.
   * A fresh test run with no token still posts, matching loopback dev.
   */
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

  /** POST a ticket and remember its id for cleanup. */
  function ticketFrom(res: { body: unknown }): {
    ticket?: { id: string; status: string; key: string };
    message?: unknown;
    tickets?: { id: string; status: string; key: string }[];
  } {
    if (!res.body || typeof res.body !== 'object') return {};
    return res.body;
  }

  function ticketOf(res: { body: unknown }): {
    id: string;
    status: string;
    key: string;
  } {
    return ticketFrom(res).ticket as {
      id: string;
      status: string;
      key: string;
    };
  }

  async function createTicket(body: Record<string, unknown>) {
    const res = await call().post('/tickets').send(body);
    const ticket = ticketFrom(res).ticket;
    if (ticket?.id) created.push(ticket.id);
    return res;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    // Listen once. Supertest otherwise calls listen on the first request of
    // a batch and closes that server when the request ends, which resets
    // the other nine parallel creates.
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    if (!prisma.dbReady) {
      throw new Error(
        'Tickets e2e needs Postgres at DATABASE_URL (see header comment)',
      );
    }
    // Manual moves On keeps today's human creates and moves working when
    // another suite has already registered an agent in this database.
    const row = await prisma.setting.findUnique({ where: { id: 'default' } });
    savedManual =
      row?.manualMoves === true || row?.manualMoves === false
        ? row.manualMoves
        : null;
    await prisma.setting.upsert({
      where: { id: 'default' },
      create: { id: 'default', mission: '', manualMoves: true },
      update: { manualMoves: true },
    });
  });

  afterAll(async () => {
    // QA-1 #4: wipe the tickets we created AND the activity events their
    // creates/moves wrote (keyed by payload.ticket = the MC-N key). Without
    // this, a forgotten DATABASE_URL that pointed at a shared DB would leave
    // both tables littered; even on the right DB we do not want QA debris.
    if (created.length && prisma) {
      try {
        const rows = await prisma.ticket.findMany({
          where: { id: { in: created } },
          select: { id: true, key: true },
        });
        const keys = rows
          .map((r) => r.key)
          .filter((k): k is string => typeof k === 'string');
        if (keys.length) {
          // ActivityEvent.payload is Json; Prisma's path filter matches
          // `payload.ticket` for the string keys we broadcast.
          await prisma.activityEvent.deleteMany({
            where: {
              OR: keys.map((key) => ({
                payload: { path: ['ticket'], equals: key },
              })),
            },
          });
        }
        await prisma.ticket.deleteMany({ where: { id: { in: created } } });
      } catch (err) {
        console.warn('[tickets.e2e] cleanup failed:', err);
      }
    }
    if (prisma) {
      await prisma.setting
        .update({
          where: { id: 'default' },
          data: { manualMoves: savedManual },
        })
        .catch(() => undefined);
    }
    if (app) await app.close();
  });

  describe('POST /tickets', () => {
    it('A: no status → backlog (Atlas decision, matches schema default)', async () => {
      const res = await createTicket({ title: 'e2e default status' });
      expect(res.status).toBe(201);
      expect(ticketOf(res).status).toBe('backlog');
    });

    it('explicit status todo (kanban "+ New ticket") → todo', async () => {
      const res = await createTicket({ title: 'e2e todo', status: 'todo' });
      expect(res.status).toBe(201);
      expect(ticketOf(res).status).toBe('todo');
    });

    it('C: invalid create status (done) → 400 and nothing saved', async () => {
      const title = `e2e bad status ${Date.now()}-${Math.random()}`;
      const res = await createTicket({
        title,
        status: 'done',
      });
      expect(res.status).toBe(400);
      expect(await prisma.ticket.count({ where: { title } })).toBe(0);
    });

    it('E: missing title → 400 (was 201 {error})', async () => {
      const res = await createTicket({ priority: 'med' });
      expect(res.status).toBe(400);
      expect(bodyMessage(res)).toMatch(/title/);
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('full button loop: Backlog → To-Do → Build → QA → Review → Done', async () => {
      const createdTicket = await createTicket({ title: 'e2e loop' });
      const id = ticketOf(createdTicket).id;
      for (const status of ['todo', 'build', 'qa', 'review', 'done']) {
        const res = await call().patch(`/tickets/${id}`).send({ status });
        expect(res.status).toBe(200);
        expect(ticketOf(res).status).toBe(status);
      }
      const row = await prisma.ticket.findUnique({ where: { id } });
      expect(row?.status).toBe('done');
    });

    it('D: {status:"banana"} → 400 and the row is unchanged', async () => {
      const createdTicket = await createTicket({
        title: 'e2e banana',
        status: 'todo',
      });
      const id = ticketOf(createdTicket).id;
      const res = await call()
        .patch(`/tickets/${id}`)
        .send({ status: 'banana' });
      expect(res.status).toBe(400);
      const row = await prisma.ticket.findUnique({
        where: { id },
      });
      expect(row?.status).toBe('todo');
    });

    it('E: unknown id → 404 (was 200 {error})', async () => {
      const res = await call()
        .patch('/tickets/does-not-exist')
        .send({ status: 'todo' });
      expect(res.status).toBe(404);
    });

    it('B: parallel build+done — last-received wins, even if the first is slower (10x)', async () => {
      // Make the FIRST transaction of each pair stall before it takes the row
      // lock. Without the per-ticket queue the second request (→ done) would
      // commit first and the stale → build would overwrite it — exactly QA's
      // 3/10 failure, but deterministic. The row lock alone would NOT prevent
      // this (the slow request has not asked for the lock yet).
      const original = prisma.$transaction.bind(prisma) as (
        ...a: unknown[]
      ) => Promise<unknown>;
      let stallNext = false;
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(
          (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
            original(async (tx: unknown) => {
              if (stallNext) {
                stallNext = false;
                await sleep(60);
              }
              return fn(tx);
            }, opts),
        );
      try {
        for (let run = 0; run < 10; run++) {
          const createdTicket = await createTicket({
            title: `e2e race ${run}`,
            status: 'todo',
          });
          const id = ticketOf(createdTicket).id;
          stallNext = true;
          const first = call()
            .patch(`/tickets/${id}`)
            .send({ status: 'build' });
          const firstP = first.then((r) => r); // start it now
          await sleep(15); // ensure the server has received #1 before #2
          const secondP = call()
            .patch(`/tickets/${id}`)
            .send({ status: 'done' })
            .then((r) => r);
          const [r1, r2] = await Promise.all([firstP, secondP]);
          expect([r1.status, r2.status]).toEqual([200, 200]);
          // What a browser refresh would show:
          const get = await call().get('/tickets');
          const row = (ticketFrom(get).tickets ?? []).find((t) => t.id === id);
          expect(row?.status).toBe('done');
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('QA-1 #3: same-status PATCH → 200 and no extra activity event', async () => {
      const createdTicket = await createTicket({
        title: 'e2e noop',
        status: 'todo',
      });
      const id = ticketOf(createdTicket).id;
      const key = ticketOf(createdTicket).key;
      const before = await prisma.activityEvent.count({
        where: {
          type: 'run.progress',
          payload: { path: ['ticket'], equals: key },
        },
      });
      const first = await call()
        .patch(`/tickets/${id}`)
        .send({ status: 'build' });
      expect(first.status).toBe(200);
      const second = await call()
        .patch(`/tickets/${id}`)
        .send({ status: 'build' }); // double-click ▶ Start
      expect(second.status).toBe(200);
      expect(ticketOf(second).status).toBe('build');
      const after = await prisma.activityEvent.count({
        where: {
          type: 'run.progress',
          payload: { path: ['ticket'], equals: key },
        },
      });
      // Exactly one progress event for the real move; the no-op added none.
      expect(after - before).toBe(1);
    });
  });

  describe('concurrent creates (QA-1 #5)', () => {
    it('10 parallel POSTs return 10 unique MC-N keys', async () => {
      const settled = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          call()
            .post('/tickets')
            .send({ title: `e2e parallel ${i}`, status: 'todo' }),
        ),
      );
      for (const res of settled) {
        expect(res.status).toBe(201);
        const ticket = ticketFrom(res).ticket;
        if (ticket?.id) created.push(ticket.id);
      }
      const keys = settled.map((r) => ticketOf(r).key);
      expect(new Set(keys).size).toBe(10);
      for (const key of keys) expect(key).toMatch(/^MC-[0-9]+$/);
    });
  });

  describe('claims and the ready route', () => {
    const stamp =
      `${process.env.JEST_WORKER_ID ?? '0'}${Date.now().toString(36)}`.replace(
        /[^a-z0-9]/g,
        '',
      );
    const agentIds = Array.from({ length: 10 }, (_, i) =>
      `c${i}${stamp}`.slice(0, 64),
    );
    const savedEnv = {
      token: process.env.INGEST_TOKEN,
      proxy: process.env.BUNDLED_PROXY,
    };
    let previousManual: boolean | null = null;

    beforeAll(async () => {
      const row = await prisma.setting.findUnique({ where: { id: 'default' } });
      previousManual =
        row?.manualMoves === true || row?.manualMoves === false
          ? row.manualMoves
          : null;
      await prisma.setting.upsert({
        where: { id: 'default' },
        create: { id: 'default', mission: '', manualMoves: true },
        update: { manualMoves: true },
      });
      for (const [index, id] of agentIds.entries()) {
        await prisma.agent.upsert({
          where: { id },
          create: {
            id,
            name: `Claim ${index}`,
            source: 'registered',
            position: 800 + index,
          },
          update: { source: 'registered', name: `Claim ${index}` },
        });
      }
    });

    afterAll(async () => {
      if (savedEnv.token === undefined) delete process.env.INGEST_TOKEN;
      else process.env.INGEST_TOKEN = savedEnv.token;
      if (savedEnv.proxy === undefined) delete process.env.BUNDLED_PROXY;
      else process.env.BUNDLED_PROXY = savedEnv.proxy;
      await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
      await prisma.setting
        .update({
          where: { id: 'default' },
          data: { manualMoves: previousManual },
        })
        .catch(() => undefined);
    });

    it('gives one of ten parallel claims the ticket and nine an already claimed 409', async () => {
      const createdTicket = await createTicket({
        title: 'e2e claim race',
        status: 'backlog',
      });
      const ticket = ticketOf(createdTicket);
      const readied = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .send({ status: 'todo' });
      expect(readied.status).toBe(200);

      const results = await Promise.all(
        agentIds.map((id) =>
          request(app.getHttpServer())
            .patch(`/tickets/${ticket.id}`)
            .set('x-actor-id', id)
            .send({ status: 'build' }),
        ),
      );
      const won = results.filter((res) => res.status === 200);
      const lost = results.filter((res) => res.status === 409);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(9);
      const winner = (won[0].body as { ticket: { assignee: string } }).ticket
        .assignee;
      expect(agentIds).toContain(winner);
      for (const res of lost) {
        expect(res.body).toMatchObject({
          statusCode: 409,
          error: 'already claimed',
          claimedBy: winner,
        });
        expect(bodyMessage(res)).toBe(
          `${ticket.key} was picked up by ${winner}.`,
        );
      }
      const picked = await prisma.activityEvent.findMany({
        where: {
          type: 'run.progress',
          payload: { path: ['ticket'], equals: ticket.key },
        },
      });
      const claims = picked.filter((row) => {
        const payload = row.payload as { name?: string } | null;
        return payload?.name === `${ticket.key} picked up`;
      });
      expect(claims).toHaveLength(1);

      const again = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .set('x-actor-id', winner)
        .send({ status: 'build' });
      expect(again.status).toBe(200);
      const after = await prisma.activityEvent.findMany({
        where: {
          type: 'run.progress',
          payload: { path: ['ticket'], equals: ticket.key },
        },
      });
      expect(
        after.filter((row) => {
          const payload = row.payload as { name?: string } | null;
          return payload?.name === `${ticket.key} picked up`;
        }),
      ).toHaveLength(1);

      const released = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .set('x-actor-id', winner)
        .send({ status: 'todo' });
      expect(released.status).toBe(200);
      const releasedBody = released.body as {
        ticket: { status: string; assignee: string };
      };
      expect(releasedBody.ticket.status).toBe('todo');
      expect(releasedBody.ticket.assignee).not.toBe(winner);

      const other = agentIds.find((id) => id !== winner) ?? agentIds[0];
      const ready = await request(app.getHttpServer())
        .get('/tickets/ready')
        .set('x-actor-id', other);
      expect(ready.status).toBe(200);
      const listed = (ready.body as { tickets: { id: string }[] }).tickets;
      expect(listed.some((row) => row.id === ticket.id)).toBe(true);
    });

    it('refuses a human move while Automatic is locked, then allows the same move once Manual moves is On', async () => {
      await prisma.setting.update({
        where: { id: 'default' },
        data: { manualMoves: null },
      });
      try {
        const createdTicket = await createTicket({
          title: 'e2e lock then unlock',
          status: 'backlog',
        });
        const ticket = ticketOf(createdTicket);
        const readied = await request(app.getHttpServer())
          .patch(`/tickets/${ticket.id}`)
          .send({ status: 'todo' });
        expect(readied.status).toBe(200);

        const refused = await request(app.getHttpServer())
          .patch(`/tickets/${ticket.id}`)
          .send({ status: 'build' });
        expect(refused.status).toBe(409);
        expect(bodyMessage(refused)).toBe(
          'Agents move tickets past To Do. Turn on Manual moves in Settings to move it yourself.',
        );

        await prisma.setting.update({
          where: { id: 'default' },
          data: { manualMoves: true },
        });
        const moved = await request(app.getHttpServer())
          .patch(`/tickets/${ticket.id}`)
          .send({ status: 'build' });
        expect(moved.status).toBe(200);
        expect(
          (moved.body as { ticket: { status: string } }).ticket.status,
        ).toBe('build');
      } finally {
        await prisma.setting.update({
          where: { id: 'default' },
          data: { manualMoves: true },
        });
      }
    });

    it('requires a registered actor on loopback and a token off loopback', async () => {
      const missing = await request(app.getHttpServer()).get('/tickets/ready');
      expect(missing.status).toBe(400);
      expect(bodyMessage(missing)).toBe('actor must be a registered agent id');

      const loopback = await request(app.getHttpServer())
        .get('/tickets/ready')
        .set('x-actor-id', agentIds[0]);
      expect(loopback.status).toBe(200);
      expect(
        Array.isArray(responseJson<{ tickets?: unknown }>(loopback).tickets),
      ).toBe(true);

      process.env.INGEST_TOKEN = 'e2e-ready-token';
      process.env.BUNDLED_PROXY = '127.0.0.1';
      const denied = await request(app.getHttpServer())
        .get('/tickets/ready')
        .set('x-mc-remote', '1')
        .set('x-actor-id', agentIds[0]);
      expect(denied.status).toBe(401);

      const allowed = await request(app.getHttpServer())
        .get('/tickets/ready')
        .set('x-mc-remote', '1')
        .set('x-ingest-token', 'e2e-ready-token')
        .set('x-actor-id', agentIds[0]);
      expect(allowed.status).toBe(200);
      expect(
        Array.isArray(responseJson<{ tickets?: unknown }>(allowed).tickets),
      ).toBe(true);
    });
  });

  describe('field limits and delete', () => {
    const actor = 'e2edelrace';

    function expect400(
      res: { status: number; body: unknown },
      message: string,
    ) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message,
        error: 'Bad Request',
      });
    }

    it('rejects bad priority and length on create and update', async () => {
      const made = await createTicket({ title: 'e2e limits' });
      expect(made.status).toBe(201);
      expect(ticketOf(made).status).toBe('backlog');
      const omitted = ticketFrom(made).ticket as { priority?: string };
      expect(omitted.priority).toBe('med');
      const id = ticketOf(made).id;

      expect400(
        await call().post('/tickets').send({ title: 'x', priority: 'High' }),
        'priority must be one of high, med, low',
      );
      expect400(
        await call().patch(`/tickets/${id}`).send({ priority: '' }),
        'priority must be one of high, med, low',
      );
      expect400(
        await call()
          .post('/tickets')
          .send({ title: 't'.repeat(121) }),
        'title must be 120 characters or fewer',
      );
      expect400(
        await call()
          .patch(`/tickets/${id}`)
          .send({ description: 'd'.repeat(4001) }),
        'description must be 4000 characters or fewer',
      );
      expect400(
        await call()
          .post('/tickets')
          .send({ title: 'x', assignee: 'a'.repeat(101) }),
        'assignee must be 100 characters or fewer',
      );
      await prisma.ticket.update({
        where: { id },
        data: { title: 'z'.repeat(200) },
      });
      const priority = await call()
        .patch(`/tickets/${id}`)
        .send({ priority: 'low' });
      expect(priority.status).toBe(200);
      expect(
        (priority.body as { ticket: { title: string; priority: string } })
          .ticket,
      ).toMatchObject({ priority: 'low', title: 'z'.repeat(200) });
    });

    it('deletes a ticket, keeps activity, and unlinks runs', async () => {
      const made = await createTicket({
        title: 'e2e delete me',
        status: 'todo',
        priority: 'high',
      });
      const ticket = ticketOf(made);
      const run = await prisma.run.create({
        data: { name: 'linked run', status: 'queued', ticketId: ticket.id },
      });
      const removed = await request(app.getHttpServer()).delete(
        `/tickets/${ticket.id}`,
      );
      expect(removed.status).toBe(204);
      expect(removed.text ?? '').toBe('');
      expect(
        await prisma.ticket.findUnique({ where: { id: ticket.id } }),
      ).toBeNull();
      const still = await prisma.run.findUnique({ where: { id: run.id } });
      expect(still?.ticketId).toBeNull();
      const events = await prisma.activityEvent.findMany({
        where: { payload: { path: ['ticket'], equals: ticket.key } },
      });
      const names = events.map(
        (row) => (row.payload as { name?: string } | null)?.name,
      );
      expect(names).toContain(`${ticket.key} created`);
      expect(names).toContain(`${ticket.key} deleted`);
      const again = await request(app.getHttpServer()).delete(
        `/tickets/${ticket.id}`,
      );
      expect(again.status).toBe(404);
      expect(again.body).toEqual({
        statusCode: 404,
        message: `ticket ${ticket.id} not found`,
        error: 'Not Found',
      });
      const patched = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .send({ title: 'gone' });
      expect(patched.status).toBe(404);
      await prisma.agent.upsert({
        where: { id: actor },
        create: { id: actor, name: 'Delete Race', source: 'registered' },
        update: { source: 'registered' },
      });
      const ready = await request(app.getHttpServer())
        .get('/tickets/ready')
        .set('x-actor-id', actor);
      expect(ready.status).toBe(200);
      const listed = (ready.body as { tickets: { id: string }[] }).tickets;
      expect(listed.some((row) => row.id === ticket.id)).toBe(false);
      await prisma.agent.deleteMany({ where: { id: actor } });
      await prisma.run.delete({ where: { id: run.id } }).catch(() => undefined);
    });

    it('refuses an actor, a token off loopback, and a locked Build delete', async () => {
      await prisma.agent.upsert({
        where: { id: actor },
        create: { id: actor, name: 'Delete Race', source: 'registered' },
        update: { source: 'registered' },
      });
      const made = await createTicket({ title: 'e2e held', status: 'todo' });
      const ticket = ticketOf(made);
      const claimed = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .set('x-actor-id', actor)
        .send({ status: 'build' });
      expect(claimed.status).toBe(200);

      const byActor = await request(app.getHttpServer())
        .delete(`/tickets/${ticket.id}`)
        .set('x-actor-id', actor);
      expect(byActor.status).toBe(403);
      expect(byActor.body).toEqual({
        statusCode: 403,
        error: 'agents cannot delete tickets',
        message: 'Only the dashboard can delete a ticket.',
      });
      const byQuery = await request(app.getHttpServer()).delete(
        `/tickets/${ticket.id}?actor=stranger`,
      );
      expect(byQuery.status).toBe(403);
      expect(
        await prisma.ticket.findUnique({ where: { id: ticket.id } }),
      ).toMatchObject({ status: 'build' });

      const deletedName = `${ticket.key} deleted`;
      const deletedCount = async () => {
        const events = await prisma.activityEvent.findMany({
          where: { payload: { path: ['ticket'], equals: ticket.key } },
        });
        return events.filter(
          (row) =>
            (row.payload as { name?: string } | null)?.name === deletedName,
        ).length;
      };
      const beforeDelete = await deletedCount();
      await prisma.setting.update({
        where: { id: 'default' },
        data: { manualMoves: null },
      });
      const held = await request(app.getHttpServer()).delete(
        `/tickets/${ticket.id}`,
      );
      expect(held.status).toBe(409);
      expect(held.body).toEqual({
        statusCode: 409,
        error: 'agents own this ticket',
        message:
          'Agents own this ticket. Turn on Manual moves in Settings to delete it.',
      });
      expect(await deletedCount()).toBe(beforeDelete);

      const edited = await request(app.getHttpServer())
        .patch(`/tickets/${ticket.id}`)
        .send({ title: 'Still here', priority: 'high' });
      expect(edited.status).toBe(200);
      expect(
        (edited.body as { ticket: { title: string; status: string } }).ticket,
      ).toMatchObject({ title: 'Still here', status: 'build' });

      const saved = {
        token: process.env.INGEST_TOKEN,
        proxy: process.env.BUNDLED_PROXY,
        hash: process.env.DASHBOARD_PASSWORD_HASH,
        secret: process.env.SESSION_SECRET,
      };
      process.env.INGEST_TOKEN = 'e2e-delete-token';
      process.env.BUNDLED_PROXY = '127.0.0.1';
      process.env.DASHBOARD_PASSWORD_HASH = hashPassword('delete-e2e-password');
      process.env.SESSION_SECRET = 'delete-e2e-secret';
      try {
        const spare = await createTicket({
          title: 'e2e cookie delete',
          status: 'backlog',
        });
        const spareId = ticketOf(spare).id;
        const tokenOnly = await request(app.getHttpServer())
          .delete(`/tickets/${spareId}`)
          .set('x-mc-remote', '1')
          .set('x-ingest-token', 'e2e-delete-token');
        expect(tokenOnly.status).toBe(401);
        expect(tokenOnly.body).toEqual({
          statusCode: 401,
          message: 'unauthorized',
        });

        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .set('x-mc-remote', '1')
          .send({ password: 'delete-e2e-password' });
        expect(login.status).toBe(204);
        const cookie = String(login.headers['set-cookie']).split(';')[0];
        const withCookie = await request(app.getHttpServer())
          .delete(`/tickets/${spareId}`)
          .set('x-mc-remote', '1')
          .set('Cookie', cookie);
        expect(withCookie.status).toBe(204);
      } finally {
        if (saved.token === undefined) delete process.env.INGEST_TOKEN;
        else process.env.INGEST_TOKEN = saved.token;
        if (saved.proxy === undefined) delete process.env.BUNDLED_PROXY;
        else process.env.BUNDLED_PROXY = saved.proxy;
        if (saved.hash === undefined)
          delete process.env.DASHBOARD_PASSWORD_HASH;
        else process.env.DASHBOARD_PASSWORD_HASH = saved.hash;
        if (saved.secret === undefined) delete process.env.SESSION_SECRET;
        else process.env.SESSION_SECRET = saved.secret;
        await prisma.setting
          .update({ where: { id: 'default' }, data: { manualMoves: true } })
          .catch(() => undefined);
        await prisma.agent
          .deleteMany({ where: { id: actor } })
          .catch(() => undefined);
      }
    });

    it('lets exactly one of delete or claim win, 20 times', async () => {
      await prisma.setting.update({
        where: { id: 'default' },
        data: { manualMoves: true },
      });
      await prisma.agent.upsert({
        where: { id: actor },
        create: { id: actor, name: 'Delete Race', source: 'registered' },
        update: { source: 'registered' },
      });
      const tickets: { id: string; key: string }[] = [];
      for (let i = 0; i < 20; i += 1) {
        const made = await createTicket({
          title: `e2e race ${i}`,
          status: 'todo',
        });
        expect(made.status).toBe(201);
        tickets.push(ticketOf(made));
      }
      await prisma.setting.update({
        where: { id: 'default' },
        data: { manualMoves: null },
      });
      try {
        for (const ticket of tickets) {
          const [removed, claimed] = await Promise.all([
            request(app.getHttpServer()).delete(`/tickets/${ticket.id}`),
            request(app.getHttpServer())
              .patch(`/tickets/${ticket.id}`)
              .set('x-actor-id', actor)
              .send({ status: 'build' }),
          ]);
          expect(removed.status).not.toBe(500);
          expect(claimed.status).not.toBe(500);
          const row = await prisma.ticket.findUnique({
            where: { id: ticket.id },
          });
          const won =
            (removed.status === 204 &&
              claimed.status === 404 &&
              row === null) ||
            (claimed.status === 200 &&
              removed.status === 409 &&
              row?.status === 'build' &&
              row.assignee === actor);
          expect(won).toBe(true);
          if (row) created.push(row.id);
        }
      } finally {
        await prisma.setting
          .update({ where: { id: 'default' }, data: { manualMoves: true } })
          .catch(() => undefined);
        await prisma.agent
          .deleteMany({ where: { id: actor } })
          .catch(() => undefined);
      }
    });
  });
});
