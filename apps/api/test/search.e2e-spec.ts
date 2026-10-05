import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Search e2e — real Nest app + REAL Postgres (QA-1 polish item 8, QA-2).
 *
 * Proves, against actual Postgres LIKE semantics (a mock can't):
 *  - `%` and `_` in the query match literally (no wildcard blow-up);
 *  - activity search is case-insensitive on payload.name (JSON) too.
 *
 * Fails fast without DATABASE_URL (jest-e2e globalSetup + the check below)
 * and deletes every row it inserts, even if a test fails. All fixtures carry
 * a per-run marker so they can't collide with other data in the DB.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'Search e2e refuses to run without DATABASE_URL (see test/e2e-global-setup.ts).',
  );
}

describe('Search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Unique per run; lower-case so the case-insensitivity test can upper it.
  const m = `zq${Date.now().toString(36)}`;
  const ticketIds: string[] = [];
  const eventIds: string[] = [];

  const search = (q: string) =>
    request(app.getHttpServer()).get('/search').query({ q });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Pairs where an UNescaped wildcard would match both rows.
    for (const title of [
      `${m} 100% done`,
      `${m} 1000 rows`,
      `${m} a_b`,
      `${m} axb`,
    ]) {
      const t = await prisma.ticket.create({
        data: { title, status: 'backlog' },
      });
      ticketIds.push(t.id);
    }
    const ev = await prisma.activityEvent.create({
      data: {
        type: 'run.progress',
        payload: { name: `Deploy ${m.toUpperCase()} Pipeline` },
      },
    });
    eventIds.push(ev.id);
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
        await prisma.activityEvent.deleteMany({
          where: { id: { in: eventIds } },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[search.e2e] cleanup failed:', err);
      }
    }
    if (app) await app.close();
  });

  const titles = (body: { results: { tickets: { title: string }[] } }) =>
    body.results.tickets.map((t) => t.title).sort();

  it('`%` matches a literal percent sign, not "anything"', async () => {
    const res = await search(`${m} 100%`).expect(200);
    expect(titles(res.body)).toEqual([`${m} 100% done`]);
  });

  it('`_` matches a literal underscore, not "any one character"', async () => {
    const res = await search(`${m} a_b`).expect(200);
    expect(titles(res.body)).toEqual([`${m} a_b`]);
  });

  it('a wildcard-only query no longer returns every row', async () => {
    const res = await search('%%').expect(200);
    for (const t of res.body.results.tickets as { title: string }[]) {
      expect(t.title).toContain('%%');
    }
  });

  it('activity search is case-insensitive on payload.name', async () => {
    const res = await search(`deploy ${m}`).expect(200);
    const ids = (res.body.results.activity as { id: string }[]).map(
      (e) => e.id,
    );
    expect(ids).toContain(eventIds[0]);
  });
});
