import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { DEFAULT_CREATE_STATUS, TICKET_STATUSES } from './ticket-status';
import type { PrismaService } from '../prisma/prisma.service';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';

/**
 * TicketsController unit tests — no database needed.
 *
 * A small in-memory fake stands in for Prisma so we can (a) assert the
 * validation/error contract for QA findings C, D, E and the Atlas default
 * (A), and (b) deterministically reproduce the finding-B race by making the
 * FIRST write slower than the second. The real-Postgres version of these
 * checks lives in test/tickets.e2e-spec.ts.
 */

type Row = {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  assignee: string | null;
  tags: string[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeFakePrisma() {
  const rows = new Map<string, Row>();
  /** Per-call artificial latency for ticket.update, consumed in call order. */
  const updateDelays: number[] = [];
  /** Monotonic id source (rows.size would repeat after deletes). */
  let nextId = 1;

  const ticket = {
    count: jest.fn(async () => rows.size),
    create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
      // A tiny await widens the read-max → insert window, so the QA-1 #5
      // race (parallel creates reading the same max) reproduces reliably
      // if the advisory lock below were ever removed.
      await sleep(1);
      const row = { id: `id-${nextId++}`, ...data } as Row;
      rows.set(row.id, row);
      return row;
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) => {
        const delay = updateDelays.shift() ?? 0;
        if (delay) await sleep(delay);
        const row = rows.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    ),
    findMany: jest.fn(async () => [...rows.values()]),
  };

  // Shared spies so tests can assert on the SQL that was sent. The fake
  // interprets just the three raw statements the controller issues:
  //   - PATCH row lock:  SELECT "id", "status", … FOR UPDATE   (by id)
  //   - POST key read:   SELECT MAX(… '^MC-([0-9]+)$' …)
  //   - POST key lock:   SELECT pg_advisory_xact_lock(…)       ($executeRaw)
  const tx = {
    $queryRaw: jest.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('MAX(')) {
          // Mirror the SQL: highest numeric MC-<n> key, NULL if none.
          const nums = [...rows.values()]
            .map((r) => /^MC-([0-9]+)$/.exec(r.key ?? '')?.[1])
            .filter((n): n is string => n !== undefined)
            .map((n) => BigInt(n));
          const max = nums.length
            ? nums.reduce((a, b) => (a > b ? a : b))
            : null;
          return [{ max }];
        }
        const row = rows.get(values[0] as string);
        return row
          ? [
              {
                id: row.id,
                status: row.status,
                assignee: row.assignee,
                priority: row.priority,
              },
            ]
          : [];
      },
    ),
    $executeRaw: jest.fn(async (_strings: TemplateStringsArray) => 1),
    ticket,
  };

  // Fake of Postgres' transaction-scoped advisory lock: one global FIFO
  // chain; a transaction that calls pg_advisory_xact_lock waits for the
  // previous holder's transaction to END (commit/rollback), like the real
  // thing. Per-transaction client objects carry their own release handle.
  let lockTail: Promise<void> = Promise.resolve();
  const prisma = {
    ticket,
    activityEvent: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(
      async (fn: (t: typeof tx) => Promise<unknown>, _opts?: unknown) => {
        let release: () => void = () => undefined;
        const client = {
          ...tx,
          $executeRaw: async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            await tx.$executeRaw(strings, ...values);
            if (strings.join('?').includes('pg_advisory_xact_lock')) {
              const previous = lockTail;
              lockTail = new Promise<void>((r) => (release = r));
              await previous;
            }
            return 1;
          },
        };
        try {
          return await fn(client as typeof tx);
        } finally {
          release(); // "COMMIT/ROLLBACK" releases the xact lock
        }
      },
    ),
  };
  return { prisma, rows, updateDelays, tx };
}

function makeController() {
  const fake = makeFakePrisma();
  const gateway = { broadcast: jest.fn() };
  const controller = new TicketsController(
    fake.prisma as unknown as PrismaService,
    gateway as unknown as LiveActivityGateway,
  );
  return { controller, ...fake, gateway };
}

describe('TicketsController', () => {
  describe('POST /tickets (create)', () => {
    it(`A: omitted status defaults to DEFAULT_CREATE_STATUS (${DEFAULT_CREATE_STATUS}, per Atlas)`, async () => {
      expect(DEFAULT_CREATE_STATUS).toBe('backlog'); // pin the product decision
      const { controller } = makeController();
      const { ticket } = await controller.create({ title: 'no status' });
      expect(ticket.status).toBe('backlog');
    });

    // Ticket 3: the default assignee comes from OPERATOR_NAME, never a
    // hardcoded personal name. Save/restore the env so tests stay isolated.
    describe('default assignee (OPERATOR_NAME)', () => {
      const saved = process.env.OPERATOR_NAME;
      afterEach(() => {
        if (saved === undefined) delete process.env.OPERATOR_NAME;
        else process.env.OPERATOR_NAME = saved;
      });

      it('falls back to the neutral "Operator" when OPERATOR_NAME is unset', async () => {
        delete process.env.OPERATOR_NAME;
        const { controller } = makeController();
        const { ticket } = await controller.create({ title: 'no assignee' });
        expect(ticket.assignee).toBe('Operator');
      });

      it('uses OPERATOR_NAME when configured', async () => {
        process.env.OPERATOR_NAME = 'Ada';
        const { controller } = makeController();
        const { ticket } = await controller.create({ title: 'no assignee' });
        expect(ticket.assignee).toBe('Ada');
      });

      it('an explicit assignee still wins over the default', async () => {
        process.env.OPERATOR_NAME = 'Ada';
        const { controller } = makeController();
        const { ticket } = await controller.create({ title: 't', assignee: 'Demo Builder' });
        expect(ticket.assignee).toBe('Demo Builder');
      });
    });

    it.each(['todo', 'backlog', ' todo '])(
      'accepts create status %p',
      async (status) => {
        const { controller } = makeController();
        const { ticket } = await controller.create({ title: 't', status });
        expect(ticket.status).toBe(String(status).trim());
      },
    );

    it.each(['done', 'build', 'qa', 'banana', '', 42])(
      'C: rejects create status %p with 400',
      async (status) => {
        const { controller, prisma } = makeController();
        await expect(
          controller.create({ title: 't', status }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.ticket.create).not.toHaveBeenCalled(); // nothing saved
      },
    );

    describe('QA-1 #5: ticket keys', () => {
      it('allocates under pg_advisory_xact_lock inside a transaction', async () => {
        const { controller, prisma, tx } = makeController();
        await controller.create({ title: 't' });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const lockSql = tx.$executeRaw.mock.calls[0][0].join('?');
        expect(lockSql).toMatch(/pg_advisory_xact_lock/);
        expect(prisma.ticket.count).not.toHaveBeenCalled(); // no more count()
      });

      it('starts at MC-150 and continues from the max MC-N (not the row count)', async () => {
        const { controller, rows } = makeController();
        expect((await controller.create({ title: 'a' })).ticket.key).toBe(
          'MC-150',
        );
        // Non-MC keys (demo seed) and NULL keys are ignored; a gap left by a
        // deleted ticket is NOT refilled (count-based keys would collide).
        rows.set('seed', {
          id: 'seed',
          key: 'DEMO-9',
          title: 's',
          status: 'todo',
          priority: 'med',
          assignee: null,
          tags: [],
        });
        rows.set('old', { ...rows.get('seed')!, id: 'old', key: 'MC-300' });
        expect((await controller.create({ title: 'b' })).ticket.key).toBe(
          'MC-301',
        );
        rows.delete('old');
        expect((await controller.create({ title: 'c' })).ticket.key).toBe(
          'MC-302',
        );
      });

      it('10 parallel creates → 10 unique, consecutive keys', async () => {
        const { controller } = makeController();
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            controller.create({ title: `p${i}`, status: 'todo' }),
          ),
        );
        const keys = results.map((r) => r.ticket.key).sort();
        expect(new Set(keys).size).toBe(10);
        expect(keys).toEqual(
          Array.from({ length: 10 }, (_, i) => `MC-${150 + i}`).sort(),
        );
      });
    });

    it.each([undefined, '', '   ', 7])(
      'E: missing/blank title %p is a 400, not 201 {error}',
      async (title) => {
        const { controller, prisma } = makeController();
        await expect(controller.create({ title })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.ticket.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('PATCH /tickets/:id (move)', () => {
    it('moves Backlog → To-Do (the new Backlog-page button)', async () => {
      const { controller } = makeController();
      const { ticket } = await controller.create({ title: 't' }); // backlog by default
      const res = await controller.update(ticket.id, { status: 'todo' });
      expect(res.ticket.status).toBe('todo');
    });

    it.each([...TICKET_STATUSES])(
      'accepts pipeline status %p',
      async (status) => {
        const { controller } = makeController();
        const { ticket } = await controller.create({
          title: 't',
          status: 'todo',
        });
        const res = await controller.update(ticket.id, { status });
        expect(res.ticket.status).toBe(status);
      },
    );

    it.each(['banana', '', 'DONE', 5])(
      'D: rejects status %p with 400 and saves nothing',
      async (status) => {
        const { controller, prisma, rows } = makeController();
        const { ticket } = await controller.create({
          title: 't',
          status: 'todo',
        });
        // create() itself runs a transaction (QA-1 #5 key allocation), so
        // only count what the rejected PATCH does from here on.
        prisma.$transaction.mockClear();
        await expect(
          controller.update(ticket.id, { status }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(rows.get(ticket.id)!.status).toBe('todo');
      },
    );

    it('E: unknown id is a 404, not 200 {error}', async () => {
      const { controller } = makeController();
      await expect(
        controller.update('nope', { status: 'todo' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('E: empty body is a 400 (no silent no-op)', async () => {
      const { controller } = makeController();
      const { ticket } = await controller.create({ title: 't' });
      await expect(controller.update(ticket.id, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('takes a row lock (SELECT … FOR UPDATE) inside a transaction', async () => {
      const { controller, tx } = makeController();
      const { ticket } = await controller.create({ title: 't' });
      tx.$queryRaw.mockClear(); // ignore create()'s MAX(key) query (QA-1 #5)
      await controller.update(ticket.id, { status: 'todo' });
      const sql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join(
        '?',
      );
      expect(sql).toMatch(/FOR UPDATE/);
    });

    it('only writes the fields that were sent (no stale read-modify-write)', async () => {
      const { controller, prisma } = makeController();
      const { ticket } = await controller.create({ title: 't' });
      await controller.update(ticket.id, { status: 'todo' });
      expect(prisma.ticket.update).toHaveBeenLastCalledWith({
        where: { id: ticket.id },
        data: { status: 'todo' },
      });
    });

    describe('QA-1 #3: no activity event for a no-op move', () => {
      it('same-status PATCH (double-clicked ▶ Start) → 200, but no extra run.progress', async () => {
        const { controller, prisma, gateway } = makeController();
        const { ticket } = await controller.create({
          title: 't',
          status: 'todo',
        });
        prisma.activityEvent.create.mockClear(); // drop create's run.queued
        gateway.broadcast.mockClear();

        // Two identical clicks, fired back to back like a double-click.
        const [r1, r2] = await Promise.all([
          controller.update(ticket.id, { status: 'build' }),
          controller.update(ticket.id, { status: 'build' }),
        ]);
        expect(r1.ticket.status).toBe('build');
        expect(r2.ticket.status).toBe('build'); // still a normal 200 answer
        expect(prisma.activityEvent.create).toHaveBeenCalledTimes(1);
        expect(gateway.broadcast).toHaveBeenCalledTimes(1);
        expect(gateway.broadcast).toHaveBeenCalledWith(
          'run.progress',
          expect.objectContaining({ name: `ticket ${ticket.key} → build` }),
        );
      });

      it('a real change after a no-op still emits its event', async () => {
        const { controller, gateway } = makeController();
        const { ticket } = await controller.create({
          title: 't',
          status: 'todo',
        });
        gateway.broadcast.mockClear();
        await controller.update(ticket.id, { status: 'todo' }); // no-op
        expect(gateway.broadcast).not.toHaveBeenCalled();
        await controller.update(ticket.id, { priority: 'high' }); // change
        expect(gateway.broadcast).toHaveBeenCalledTimes(1);
      });
    });

    it('B: parallel PATCHes — the last-received write wins even when the first is slower (10x)', async () => {
      for (let run = 0; run < 10; run++) {
        const { controller, rows, updateDelays } = makeController();
        const { ticket } = await controller.create({
          title: `race ${run}`,
          status: 'todo',
        });
        // First request (→ build) is artificially slow; without the per-ticket
        // queue it would commit AFTER the second (→ done) — QA's 3/10 failure.
        updateDelays.push(25, 0);
        const first = controller.update(ticket.id, { status: 'build' });
        const second = controller.update(ticket.id, { status: 'done' });
        const [r1, r2] = await Promise.all([first, second]);
        expect(r1.ticket.status).toBe('build');
        expect(r2.ticket.status).toBe('done');
        expect(rows.get(ticket.id)!.status).toBe('done'); // what a refresh would show
      }
    });
  });
});
