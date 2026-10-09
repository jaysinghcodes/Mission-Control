import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RunsController } from './runs.controller';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * RunsController unit tests. No database.
 * Missing name is 400. Missing id is 404. ticketId is stored only when the ticket exists.
 */

type RunRow = {
  id: string;
  name: string;
  agent: string | null;
  status: string;
  progress: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  ticketId: string | null;
};

function make() {
  const runs = new Map<string, RunRow>();
  const tickets = new Set<string>(['ticket-1']);
  let next = 1;

  const prisma = {
    run: {
      findMany: jest.fn(async () => [...runs.values()]),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => runs.get(where.id) ?? null),
      create: jest.fn(async ({ data }: { data: Partial<RunRow> & { name: string } }) => {
        const row: RunRow = {
          id: `run-${next++}`,
          name: data.name,
          agent: data.agent ?? null,
          status: data.status ?? 'queued',
          progress: data.progress ?? 0,
          startedAt: data.startedAt ?? null,
          finishedAt: data.finishedAt ?? null,
          ticketId: data.ticketId ?? null,
        };
        runs.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RunRow> }) => {
        const prev = runs.get(where.id);
        if (!prev) throw new Error('missing');
        const row = { ...prev, ...data };
        runs.set(row.id, row);
        return row;
      }),
    },
    ticket: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        tickets.has(where.id) ? { id: where.id } : null,
      ),
    },
    activityEvent: {
      create: jest.fn(async () => ({})),
    },
  };

  const gateway = { broadcast: jest.fn() };
  const controller = new RunsController(
    prisma as unknown as PrismaService,
    gateway as unknown as LiveActivityGateway,
  );
  return { controller, prisma, gateway, runs };
}

describe('RunsController', () => {
  it('rejects a missing name with 400', async () => {
    const { controller } = make();
    await expect(controller.create({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ name: '   ' })).rejects.toMatchObject({
      message: 'name is required',
      status: 400,
    });
  });

  it('rejects an unknown run with 404', async () => {
    const { controller } = make();
    await expect(controller.update('missing', { status: 'done' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update('missing', {})).rejects.toMatchObject({
      message: 'run not found',
      status: 404,
    });
  });

  it('stores ticketId when the ticket exists', async () => {
    const { controller, runs } = make();
    const created = await controller.create({ name: 'Ship the notes', agent: 'Quill', ticketId: 'ticket-1' });
    expect(created.run.ticketId).toBe('ticket-1');
    expect(created.run.status).toBe('queued');

    const updated = await controller.update(created.run.id, { status: 'running', ticketId: 'ticket-1' });
    expect(updated.run.ticketId).toBe('ticket-1');
    expect(updated.run.status).toBe('running');
    expect(runs.get(created.run.id)?.ticketId).toBe('ticket-1');
  });

  it('rejects an unknown ticketId with 400 and does not insert the run', async () => {
    const { controller, prisma } = make();
    await expect(controller.create({ name: 'Orphan', ticketId: 'nope' })).rejects.toMatchObject({
      message: 'ticket not found',
      status: 400,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();
  });

  it('leaves ticketId unset when the body omits it', async () => {
    const { controller, prisma } = make();
    const created = await controller.create({ name: 'Morning brief' });
    expect(created.run.ticketId).toBeNull();
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  });
});
