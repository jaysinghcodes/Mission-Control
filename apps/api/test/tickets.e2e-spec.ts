import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Tickets e2e — real Nest app + REAL Postgres (PR #20 QA findings A–E).
 *
 * Needs a migrated database at DATABASE_URL, e.g.
 *   docker compose up -d db
 *   (cd apps/api && npx prisma migrate deploy)
 *   npm run test:e2e -w apps/api
 * Every ticket this suite creates is deleted again in afterAll.
 */
describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const created: string[] = [];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** POST a ticket and remember its id for cleanup. */
  async function createTicket(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer()).post('/tickets').send(body);
    if (res.body?.ticket?.id) created.push(res.body.ticket.id);
    return res;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    if (!prisma.dbReady) {
      throw new Error(
        'Tickets e2e needs Postgres at DATABASE_URL (see header comment)',
      );
    }
  });

  afterAll(async () => {
    if (created.length) {
      await prisma.ticket.deleteMany({ where: { id: { in: created } } });
    }
    await app.close();
  });

  describe('POST /tickets', () => {
    it('A: no status → backlog (Atlas decision, matches schema default)', async () => {
      const res = await createTicket({ title: 'e2e default status' });
      expect(res.status).toBe(201);
      expect(res.body.ticket.status).toBe('backlog');
    });

    it('explicit status todo (kanban "+ New ticket") → todo', async () => {
      const res = await createTicket({ title: 'e2e todo', status: 'todo' });
      expect(res.status).toBe(201);
      expect(res.body.ticket.status).toBe('todo');
    });

    it('C: invalid create status (done) → 400 and nothing saved', async () => {
      const before = await prisma.ticket.count();
      const res = await createTicket({
        title: 'e2e bad status',
        status: 'done',
      });
      expect(res.status).toBe(400);
      expect(await prisma.ticket.count()).toBe(before);
    });

    it('E: missing title → 400 (was 201 {error})', async () => {
      const res = await createTicket({ priority: 'med' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/title/);
    });
  });

  describe('PATCH /tickets/:id', () => {
    it('full button loop: Backlog → To-Do → Build → QA → Review → Done', async () => {
      const { body } = await createTicket({ title: 'e2e loop' });
      const id = body.ticket.id as string;
      for (const status of ['todo', 'build', 'qa', 'review', 'done']) {
        const res = await request(app.getHttpServer())
          .patch(`/tickets/${id}`)
          .send({ status });
        expect(res.status).toBe(200);
        expect(res.body.ticket.status).toBe(status);
      }
      const row = await prisma.ticket.findUnique({ where: { id } });
      expect(row?.status).toBe('done');
    });

    it('D: {status:"banana"} → 400 and the row is unchanged', async () => {
      const { body } = await createTicket({
        title: 'e2e banana',
        status: 'todo',
      });
      const res = await request(app.getHttpServer())
        .patch(`/tickets/${body.ticket.id}`)
        .send({ status: 'banana' });
      expect(res.status).toBe(400);
      const row = await prisma.ticket.findUnique({
        where: { id: body.ticket.id },
      });
      expect(row?.status).toBe('todo');
    });

    it('E: unknown id → 404 (was 200 {error})', async () => {
      const res = await request(app.getHttpServer())
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
      const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((
        fn: (tx: unknown) => Promise<unknown>,
        opts?: unknown,
      ) =>
        original(async (tx: unknown) => {
          if (stallNext) {
            stallNext = false;
            await sleep(60);
          }
          return fn(tx);
        }, opts)) as never);
      try {
        for (let run = 0; run < 10; run++) {
          const { body } = await createTicket({
            title: `e2e race ${run}`,
            status: 'todo',
          });
          const id = body.ticket.id as string;
          stallNext = true;
          const first = request(app.getHttpServer())
            .patch(`/tickets/${id}`)
            .send({ status: 'build' });
          const firstP = first.then((r) => r); // start it now
          await sleep(15); // ensure the server has received #1 before #2
          const secondP = request(app.getHttpServer())
            .patch(`/tickets/${id}`)
            .send({ status: 'done' })
            .then((r) => r);
          const [r1, r2] = await Promise.all([firstP, secondP]);
          expect([r1.status, r2.status]).toEqual([200, 200]);
          // What a browser refresh would show:
          const get = await request(app.getHttpServer()).get('/tickets');
          const row = (
            get.body.tickets as { id: string; status: string }[]
          ).find((t) => t.id === id);
          expect(row?.status).toBe('done');
        }
      } finally {
        spy.mockRestore();
      }
    });
  });
});
