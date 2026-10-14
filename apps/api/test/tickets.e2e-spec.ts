import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { applyWriteToken } from './write-token';
import { bodyMessage } from './lint-helpers';

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
/** A dropped socket. HTTP 4xx and 5xx are not this. */
function isDroppedConnection(err: unknown): boolean {
  let message = '';
  if (typeof err === 'string') message = err;
  else if (err instanceof Error) message = err.message;
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  return (
    code === 'ECONNRESET' ||
    message.includes('ECONNRESET') ||
    message.includes('socket hang up')
  );
}

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
    it('10 parallel POSTs → 10 unique MC-N keys', async () => {
      const postOnce = (i: number) =>
        call()
          .post('/tickets')
          .send({ title: `e2e parallel ${i}`, status: 'todo' });

      const first = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => postOnce(i)),
      );
      const rejected = first.filter((result) => result.status === 'rejected');
      const fulfilled = first.filter((result) => result.status === 'fulfilled');
      for (const result of fulfilled) {
        if (result.value.status !== 201) continue;
        const ticket = ticketFrom(result.value).ticket;
        if (ticket?.id) created.push(ticket.id);
      }

      const httpFailure = fulfilled.find(
        (result) => result.value.status !== 201,
      );
      const otherReject = rejected.find(
        (result) => !isDroppedConnection(result.reason),
      );
      if (rejected.length > 0 || httpFailure) {
        console.log(
          'parallel ticket create first batch:',
          JSON.stringify(
            first.map((result) => {
              if (result.status === 'rejected') {
                const reason: unknown = result.reason;
                const message =
                  typeof reason === 'string'
                    ? reason
                    : reason instanceof Error
                      ? reason.message
                      : '';
                const code =
                  reason && typeof reason === 'object' && 'code' in reason
                    ? String((reason as { code?: unknown }).code)
                    : '';
                return { error: message, code };
              }
              const body: unknown = result.value.body as unknown;
              return {
                status: result.value.status,
                body,
              };
            }),
          ),
        );
      }
      if (otherReject && otherReject.status === 'rejected') {
        throw otherReject.reason;
      }
      if (httpFailure) {
        expect(httpFailure.value.status).toBe(201);
      }

      let settled = fulfilled.map((result) => result.value);
      if (rejected.length > 0) {
        settled = await Promise.all(
          Array.from({ length: 10 }, (_, i) => postOnce(i)),
        );
      }
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
});
