import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RunsController } from './runs.controller';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * RunsController unit tests. No database.
 * Bad fields are 400 and the message names the field.
 * An unknown run or ticket id is 404.
 * Create is declared 201 and update 200. Neither success body has an error key.
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
      findMany: jest.fn(async ({ where }: { where?: { status?: string; ticketId?: string } } = {}) => {
        return [...runs.values()].filter((row) => {
          if (where?.status && row.status !== where.status) return false;
          if (where?.ticketId && row.ticketId !== where.ticketId) return false;
          return true;
        });
      }),
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
  it('declares 201 for create and 200 for update', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RunsController.prototype.create)).toBe(201);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RunsController.prototype.update)).toBe(200);
  });

  it('rejects a missing or blank name with 400 that names name', async () => {
    const { controller, prisma } = make();
    await expect(controller.create({})).rejects.toMatchObject({
      message: 'name is required',
      status: 400,
    });
    await expect(controller.create({ name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ name: 12 })).rejects.toMatchObject({
      message: 'name must be a string',
      status: 400,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();
  });

  it('rejects a bad agent, status, or progress with 400 that names the field', async () => {
    const { controller, prisma } = make();
    const created = await controller.create({ name: 'Ship the notes' });

    await expect(controller.update(created.run.id, { agent: 4 })).rejects.toMatchObject({
      message: 'agent must be a string',
      status: 400,
    });
    await expect(controller.update(created.run.id, { status: 'shipped' })).rejects.toMatchObject({
      message: expect.stringMatching(/status/),
      status: 400,
    });
    await expect(controller.update(created.run.id, { progress: 40.5 })).rejects.toMatchObject({
      message: 'progress must be an integer',
      status: 400,
    });
    await expect(controller.update(created.run.id, { progress: 140 })).rejects.toMatchObject({
      message: 'progress must be from 0 to 100',
      status: 400,
    });
    expect(prisma.run.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown run with 404', async () => {
    const { controller } = make();
    await expect(controller.update('missing', { status: 'done' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update('missing', {})).rejects.toMatchObject({
      message: 'run not found',
      status: 404,
    });
  });

  it('stores ticketId when the ticket exists and the success body has no error key', async () => {
    const { controller, runs } = make();
    const created = await controller.create({ name: 'Ship the notes', agent: 'Quill', ticketId: 'ticket-1' });
    expect(created).not.toHaveProperty('error');
    expect(created.run.ticketId).toBe('ticket-1');
    expect(created.run.status).toBe('queued');

    const updated = await controller.update(created.run.id, { status: 'running', ticketId: 'ticket-1' });
    expect(updated).not.toHaveProperty('error');
    expect(updated.run.ticketId).toBe('ticket-1');
    expect(updated.run.status).toBe('running');
    expect(runs.get(created.run.id)?.ticketId).toBe('ticket-1');
  });

  it('rejects an unknown ticketId with 404 and does not insert or update the run', async () => {
    const { controller, prisma } = make();
    await expect(controller.create({ name: 'Orphan', ticketId: 'nope' })).rejects.toMatchObject({
      message: 'ticketId not found',
      status: 404,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();

    const created = await controller.create({ name: 'Kept' });
    await expect(controller.update(created.run.id, { ticketId: 'nope', status: 'done' })).rejects.toMatchObject({
      message: 'ticketId not found',
      status: 404,
    });
    expect(prisma.run.update).not.toHaveBeenCalled();
    expect(created.run.status).toBe('queued');
  });

  it('rejects a non string ticketId with 400 that names ticketId', async () => {
    const { controller, prisma } = make();
    await expect(controller.create({ name: 'Orphan', ticketId: 5 })).rejects.toMatchObject({
      message: 'ticketId must be a string or null',
      status: 400,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();
  });

  it('leaves ticketId unset when the body omits it, and null clears it', async () => {
    const { controller, prisma } = make();
    const created = await controller.create({ name: 'Morning brief' });
    expect(created.run.ticketId).toBeNull();
    expect(created).not.toHaveProperty('error');
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();

    const linked = await controller.create({ name: 'Linked', ticketId: 'ticket-1' });
    const cleared = await controller.update(linked.run.id, { ticketId: null });
    expect(cleared).not.toHaveProperty('error');
    expect(cleared.run.ticketId).toBeNull();
  });

  it('rejects a name over 200 characters or an agent over 100 with 400 that names the field', async () => {
    const { controller, prisma } = make();
    const huge = 'n'.repeat(20 * 1024);
    await expect(controller.create({ name: huge })).rejects.toMatchObject({
      message: 'name must be 200 characters or fewer',
      status: 400,
    });
    await expect(controller.create({ name: 'n'.repeat(201) })).rejects.toMatchObject({
      message: 'name must be 200 characters or fewer',
      status: 400,
    });
    await expect(controller.create({ name: 'ok', agent: huge })).rejects.toMatchObject({
      message: 'agent must be 100 characters or fewer',
      status: 400,
    });
    await expect(controller.create({ name: 'ok', agent: 'a'.repeat(101) })).rejects.toMatchObject({
      message: 'agent must be 100 characters or fewer',
      status: 400,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();

    const created = await controller.create({ name: 'n'.repeat(200), agent: 'a'.repeat(100) });
    expect(created.run.name).toHaveLength(200);
    expect(created.run.agent).toHaveLength(100);
    await expect(controller.update(created.run.id, { agent: 'a'.repeat(101) })).rejects.toMatchObject({
      message: 'agent must be 100 characters or fewer',
      status: 400,
    });
    expect(prisma.run.update).not.toHaveBeenCalled();
  });

  it('rejects unknown fields, including status on create, with 400 that names the field', async () => {
    const { controller, prisma } = make();
    await expect(controller.create({ name: 'Ship', status: 'running' })).rejects.toMatchObject({
      message: 'unknown field status',
      status: 400,
    });
    await expect(controller.create({ name: 'Ship', progress: 10 })).rejects.toMatchObject({
      message: 'unknown field progress',
      status: 400,
    });
    await expect(controller.create({ name: 'Ship', extra: true })).rejects.toMatchObject({
      message: 'unknown field extra',
      status: 400,
    });
    expect(prisma.run.create).not.toHaveBeenCalled();

    const created = await controller.create({ name: 'Ship' });
    await expect(controller.update(created.run.id, { name: 'Renamed' })).rejects.toMatchObject({
      message: 'unknown field name',
      status: 400,
    });
    await expect(controller.update(created.run.id, { name: 'Renamed', bogus: 1 })).rejects.toMatchObject({
      message: 'unknown fields name, bogus',
      status: 400,
    });
    await expect(controller.update('missing', { extra: 1 })).rejects.toMatchObject({
      message: 'unknown field extra',
      status: 400,
    });
    expect(prisma.run.update).not.toHaveBeenCalled();
    expect(created.run.status).toBe('queued');
  });

  it('writes no activity event when a PATCH changes nothing', async () => {
    const { controller, prisma, gateway } = make();
    const created = await controller.create({ name: 'Morning brief', agent: 'Quill' });
    const eventsAfterCreate = prisma.activityEvent.create.mock.calls.length;
    const broadcastsAfterCreate = gateway.broadcast.mock.calls.length;

    const same = await controller.update(created.run.id, {});
    expect(same).not.toHaveProperty('error');
    expect(same.run).toEqual(created.run);
    expect(same.run.status).toBe('queued');

    const repeated = await controller.update(created.run.id, {
      status: 'queued',
      progress: 0,
      agent: 'Quill',
      ticketId: null,
    });
    expect(repeated).not.toHaveProperty('error');
    expect(repeated.run.status).toBe('queued');
    expect(repeated.run.agent).toBe('Quill');
    expect(repeated.run.progress).toBe(0);
    expect(repeated.run.ticketId).toBeNull();
    expect(prisma.activityEvent.create).toHaveBeenCalledTimes(eventsAfterCreate);
    expect(gateway.broadcast).toHaveBeenCalledTimes(broadcastsAfterCreate);
    expect(prisma.run.update).not.toHaveBeenCalled();

    const moved = await controller.update(created.run.id, { status: 'running' });
    expect(moved.run.status).toBe('running');
    expect(prisma.activityEvent.create).toHaveBeenCalledTimes(eventsAfterCreate + 1);
    expect(gateway.broadcast).toHaveBeenCalledTimes(broadcastsAfterCreate + 1);
  });

  it('filters the list by ticketId', async () => {
    const { controller } = make();
    await controller.create({ name: 'Linked', ticketId: 'ticket-1' });
    await controller.create({ name: 'Loose' });
    const listed = await controller.list(undefined, 'ticket-1');
    expect(listed).not.toHaveProperty('error');
    expect(listed.runs.map((row) => row.name)).toEqual(['Linked']);
  });
});
