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

  const ticket = {
    count: jest.fn(async () => rows.size),
    create: jest.fn(async ({ data }: { data: Omit<Row, 'id'> }) => {
      const row = { id: `id-${rows.size + 1}`, ...data } as Row;
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
  // The tx client used inside $transaction: row lock query + ticket.update.
  const tx = {
    $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) =>
      rows.has(id) ? [{ id }] : [],
    ),
    ticket,
  };
  const prisma = {
    ticket,
    activityEvent: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
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
