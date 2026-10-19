import {
  BadRequestException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { WriteAuthMiddleware } from '../auth/write-auth.middleware';

import { AgentsController } from './agents.controller';
import { offlineAfterMs } from './agent-merge';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import type { PrismaService } from '../prisma/prisma.service';

interface Stored {
  id: string;
  name: string;
  source: string;
  color: string;
  role: string | null;
  status: string;
  parentId: string | null;
  emoji: string | null;
  personalityTags: unknown;
  currentTask: string | null;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: string | null;
  channel: string | null;
  model: string | null;
  avatar: string | null;
  position: number;
  lastSeenAt: Date | null;
  updatedAt: Date;
}

class StatusResponse {
  statusCode = 0;
  status(this: StatusResponse, code: number): StatusResponse {
    this.statusCode = code;
    return this;
  }
}

class CapturedResponse {
  statusCode = 0;
  body: unknown = null;
  status(this: CapturedResponse, code: number): CapturedResponse {
    this.statusCode = code;
    return this;
  }
  json(this: CapturedResponse, body: unknown): CapturedResponse {
    this.body = body;
    return this;
  }
}

function harness() {
  const rows = new Map<string, Stored>();
  const events: { type: string; payload: unknown }[] = [];
  const broadcast = jest.fn();
  const prisma = {
    agent: {
      findMany: jest.fn(() => Promise.resolve([...rows.values()])),
      findUnique: jest.fn(
        ({
          where,
          include,
        }: {
          where: { id?: string; name?: string };
          include?: unknown;
        }) => {
          const row = where.id
            ? rows.get(where.id)
            : [...rows.values()].find((agent) => agent.name === where.name);
          if (!row) return Promise.resolve(null);
          if (include) return Promise.resolve({ ...row, children: [] });
          return Promise.resolve(row);
        },
      ),
      create: jest.fn(({ data }: { data: Stored }) => {
        const row: Stored = {
          ...data,
          personalityTags:
            data.personalityTags &&
            typeof data.personalityTags === 'object' &&
            !Array.isArray(data.personalityTags)
              ? null
              : data.personalityTags,
          updatedAt: new Date(),
        };
        rows.set(row.id, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Stored> }) => {
          const prev = rows.get(where.id);
          if (!prev) return Promise.reject(new Error('missing'));
          const next = { ...prev, ...data, updatedAt: new Date() };
          rows.set(where.id, next);
          return Promise.resolve(next);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const prev = rows.get(where.id);
        rows.delete(where.id);
        return Promise.resolve(prev);
      }),
    },
    activityEvent: {
      create: jest.fn(
        ({ data }: { data: { type: string; payload: unknown } }) => {
          events.push(data);
          return Promise.resolve(data);
        },
      ),
    },
  };
  const gateway = { broadcast, clientCount: 0 };
  const controller = new AgentsController(
    prisma as unknown as PrismaService,
    gateway as unknown as LiveActivityGateway,
  );
  const res = new StatusResponse();
  return {
    rows,
    events,
    broadcast,
    prisma,
    controller,
    res: res as unknown as Response & { statusCode: number },
  };
}

function seedDefault(rows: Map<string, Stored>): void {
  rows.set('forge', {
    id: 'forge',
    name: 'Forge',
    source: 'default',
    color: '#9bd434',
    role: 'engineer',
    status: 'working',
    parentId: 'speedy',
    emoji: '🛠️',
    personalityTags: ['builder'],
    currentTask: 'Ticket 4',
    tasksCompleted: 31,
    totalCost: 2.41,
    recentActivity: 'Working',
    channel: null,
    model: null,
    avatar: 'robot-forge',
    position: 2,
    lastSeenAt: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  });
}

describe('AgentsController register, heartbeat, delete', () => {
  it('criterion 1: 201 creates a registered row and 200 updates it with no duplicate', async () => {
    const { rows, controller, res, broadcast } = harness();
    const created = await controller.register(
      { id: 'forge_helper', name: 'Forge Helper', role: 'engineer' },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(created.agent.source).toBe('registered');
    expect(created.agent.online).toBe(true);
    expect('error' in created).toBe(false);

    const updated = await controller.register(
      {
        id: 'forge_helper',
        name: 'Forge Helper',
        role: 'engineer',
        model: 'local',
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(updated.agent.model).toBe('local');
    expect(rows.size).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      'agents.snapshot',
      expect.objectContaining({
        id: 'forge_helper',
        action: 'register',
        agent: 'forge_helper',
        name: 'Forge Helper registered',
      }),
    );
  });

  it('criterion 2: registering a default id keeps position and visual', async () => {
    const { rows, controller, res } = harness();
    seedDefault(rows);
    const updated = await controller.register(
      { id: 'forge', name: 'Forge', model: 'local' },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(updated.agent).toMatchObject({
      id: 'forge',
      source: 'registered',
      position: 2,
      color: '#9bd434',
      emoji: '🛠️',
      avatar: 'robot-forge',
      role: 'engineer',
      parentId: 'speedy',
      model: 'local',
    });
    expect(rows.size).toBe(1);
  });

  it('criterion 4: heartbeat updates lastSeenAt and 10 minutes reports online false', async () => {
    const { rows, controller, res, broadcast, prisma } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    const before = rows.get('forge_helper')!.lastSeenAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.heartbeat('forge_helper');
    const after = rows.get('forge_helper')!.lastSeenAt!.getTime();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(broadcast).toHaveBeenCalledWith(
      'agents.snapshot',
      expect.objectContaining({ id: 'forge_helper', action: 'heartbeat' }),
    );
    const heartbeats = prisma.activityEvent.create.mock.calls.filter((call) => {
      const payload = call[0].data.payload;
      return (
        !!payload &&
        typeof payload === 'object' &&
        'action' in payload &&
        payload.action === 'heartbeat'
      );
    });
    expect(heartbeats).toHaveLength(0);

    rows.get('forge_helper')!.lastSeenAt = new Date(
      Date.now() - offlineAfterMs(),
    );
    const listed = await controller.list();
    expect(listed.agents[0].online).toBe(false);
    expect(listed.agents).toHaveLength(1);

    rows.get('forge_helper')!.lastSeenAt = new Date(
      Date.now() - offlineAfterMs() + 1000,
    );
    const fresh = await controller.list();
    expect(fresh.agents[0].online).toBe(true);

    await expect(controller.heartbeat('missing_bot')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    seedDefault(rows);
    await expect(controller.heartbeat('forge')).rejects.toMatchObject({
      message: 'agent is not registered',
    });
  });

  it('a heartbeat body with currentTask and status updates the row and broadcasts', async () => {
    const { rows, controller, res, broadcast } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    broadcast.mockClear();
    await controller.heartbeat('forge_helper', {
      currentTask: 'Shipping the notes',
      status: 'working',
    });
    expect(rows.get('forge_helper')).toMatchObject({
      status: 'working',
      currentTask: 'Shipping the notes',
      source: 'registered',
    });
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      'agents.snapshot',
      expect.objectContaining({ id: 'forge_helper', action: 'heartbeat' }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(2, 'agent.status', {
      name: 'Forge Helper is now working',
      agent: 'forge_helper',
      id: 'forge_helper',
      status: 'working',
    });
    broadcast.mockClear();
    await controller.heartbeat('forge_helper', { status: 'working' });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'agents.snapshot',
      expect.objectContaining({ action: 'heartbeat' }),
    );
  });

  it('an empty heartbeat body only moves lastSeenAt', async () => {
    const { rows, controller, res } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    const row = rows.get('forge_helper')!;
    row.status = 'idle';
    row.currentTask = 'Keep me';
    const before = row.lastSeenAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.heartbeat('forge_helper', {});
    expect(row.status).toBe('idle');
    expect(row.currentTask).toBe('Keep me');
    expect(row.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
    const seen = row.lastSeenAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await controller.heartbeat('forge_helper');
    expect(row.status).toBe('idle');
    expect(row.currentTask).toBe('Keep me');
    expect(row.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(seen);
  });

  it('an unknown heartbeat field is 400 and does not write', async () => {
    const { rows, controller, res, broadcast } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    const before = rows.get('forge_helper')!.lastSeenAt;
    broadcast.mockClear();
    await expect(
      controller.heartbeat('forge_helper', {
        currentTask: 'Nope',
        extra: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.heartbeat('forge_helper', {
        currentTask: 'Nope',
        extra: true,
      }),
    ).rejects.toMatchObject({ message: 'unknown field extra', status: 400 });
    expect(rows.get('forge_helper')!.lastSeenAt).toEqual(before);
    expect(rows.get('forge_helper')!.currentTask).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
    await expect(
      controller.heartbeat('missing_bot', { nope: 1 }),
    ).rejects.toMatchObject({ message: 'unknown field nope', status: 400 });
  });

  it('idle, null, and blank clear currentTask and do not 400', async () => {
    const { rows, controller, res } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    const current = () => rows.get('forge_helper')!;
    current().status = 'working';
    current().currentTask = 'Shipping the notes';

    await controller.heartbeat('forge_helper', { status: 'idle' });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    current().status = 'working';
    current().currentTask = 'Shipping the notes';
    await controller.heartbeat('forge_helper', {
      status: 'idle',
      currentTask: 'Still writing',
    });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    current().status = 'working';
    current().currentTask = 'Shipping the notes';
    await controller.heartbeat('forge_helper', { currentTask: null });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    current().status = 'working';
    current().currentTask = 'Shipping the notes';
    await controller.heartbeat('forge_helper', { currentTask: '' });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    current().status = 'working';
    current().currentTask = 'Shipping the notes';
    await controller.heartbeat('forge_helper', { currentTask: '   ' });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    current().status = 'working';
    current().currentTask = 'Shipping the notes';
    await controller.heartbeat('forge_helper', {
      status: 'working',
      currentTask: null,
    });
    expect(current().status).toBe('idle');
    expect(current().currentTask).toBeNull();

    await expect(
      controller.heartbeat('forge_helper', { currentTask: 4 }),
    ).rejects.toMatchObject({
      message: 'currentTask must be a string',
      status: 400,
    });
    expect(current().currentTask).toBeNull();
  });

  it('an invalid heartbeat status is 400 and does not write', async () => {
    const { rows, controller, res } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    await expect(
      controller.heartbeat('forge_helper', { status: 'running' }),
    ).rejects.toMatchObject({
      message: 'status must be one of working, idle',
      status: 400,
    });
    await expect(
      controller.heartbeat('forge_helper', { status: 1 }),
    ).rejects.toMatchObject({
      message: 'status must be a string',
      status: 400,
    });
    expect(rows.get('forge_helper')!.status).toBe('idle');
    expect(rows.get('forge_helper')!.currentTask).toBeNull();
  });

  it('criterion 5: delete removes a default, a snapshot, and a registered row', async () => {
    const { rows, controller, res, broadcast } = harness();
    seedDefault(rows);
    rows.set('forge_2', {
      ...rows.get('forge')!,
      id: 'forge_2',
      name: 'Forge 2',
      source: 'snapshot',
    });
    await controller.remove('forge');
    expect(rows.has('forge')).toBe(false);
    await controller.remove('forge_2');
    expect(rows.has('forge_2')).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      'agents.snapshot',
      expect.objectContaining({
        id: 'forge_2',
        source: 'snapshot',
        action: 'delete',
      }),
    );

    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    await controller.remove('forge_helper');
    expect(rows.has('forge_helper')).toBe(false);
    expect(broadcast).toHaveBeenCalledWith(
      'agents.snapshot',
      expect.objectContaining({
        id: 'forge_helper',
        source: 'registered',
        action: 'delete',
        agent: 'forge_helper',
        name: 'Forge Helper went offline',
      }),
    );
    await expect(controller.remove('forge_helper')).rejects.toMatchObject({
      message: 'agent not found',
    });
  });

  it('criterion 7: register and delete broadcast agents.snapshot', async () => {
    const { controller, res, broadcast } = harness();
    await controller.register(
      { id: 'forge_helper', name: 'Forge Helper' },
      res,
    );
    await controller.remove('forge_helper');
    const types = broadcast.mock.calls.map((call: [string]) => call[0]);
    expect(types).toEqual(['agents.snapshot', 'agents.snapshot']);
  });

  it('rejects an unknown field, a bad id, and a name over 200 characters', async () => {
    const { controller, res } = harness();
    await expect(
      controller.register(
        { id: 'forge_helper', name: 'Forge Helper', status: 'working' },
        res,
      ),
    ).rejects.toMatchObject({ message: 'unknown field status' });
    await expect(
      controller.register({ id: 'Forge', name: 'Forge' }, res),
    ).rejects.toMatchObject({
      message: 'id must be a lowercase slug of 1 to 64 characters',
    });
    await expect(
      controller.register({ id: 'forge_helper', name: 'n'.repeat(201) }, res),
    ).rejects.toMatchObject({
      message: 'name must be 200 characters or fewer',
    });
    const created = await controller.register(
      { id: 'forge_helper', name: '😀'.repeat(200) },
      res,
    );
    expect([...created.agent.name].length).toBe(200);
  });

  it('criterion 6: the three routes are writes and follow the token middleware', () => {
    // Nest stores route metadata on the method function. Binding it would
    // look up a different function and miss the metadata.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata lives on the original method
    const register = AgentsController.prototype.register;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata lives on the original method
    const heartbeat = AgentsController.prototype.heartbeat;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata lives on the original method
    const remove = AgentsController.prototype.remove;
    expect(Reflect.getMetadata(METHOD_METADATA, register)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, register)).toBe('register');
    expect(Reflect.getMetadata(METHOD_METADATA, heartbeat)).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, heartbeat)).toBe(':id/heartbeat');
    expect(Reflect.getMetadata(METHOD_METADATA, remove)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(PATH_METADATA, remove)).toBe(':id');

    const saved = { ...process.env };
    const middleware = new WriteAuthMiddleware();
    const hit = (method: string, url: string, token?: string) => {
      const headers: Record<string, string> = {};
      if (token !== undefined) headers['x-ingest-token'] = token;
      let called = false;
      const response = new CapturedResponse();
      middleware.use(
        { method, url, originalUrl: url, headers } as Request,
        response as unknown as Response,
        () => {
          called = true;
        },
      );
      return { called, response };
    };

    process.env.INGEST_TOKEN = 'secret';
    process.env.NODE_ENV = 'test';
    for (const url of ['/agents/register', '/agents/bot/heartbeat']) {
      const denied = hit('POST', url);
      expect(denied.called).toBe(false);
      expect(denied.response.statusCode).toBe(401);
      expect(denied.response.body).toEqual({
        statusCode: 401,
        message: 'unauthorized',
      });
      const wrong = hit('POST', url, 'nope');
      expect(wrong.response.statusCode).toBe(401);
      const allowed = hit('POST', url, 'secret');
      expect(allowed.called).toBe(true);
    }
    expect(hit('DELETE', '/agents/bot').called).toBe(true);

    delete process.env.INGEST_TOKEN;
    process.env.NODE_ENV = 'test';
    expect(hit('POST', '/agents/register').called).toBe(true);

    process.env.NODE_ENV = 'production';
    const closed = hit('POST', '/agents/register');
    expect(closed.called).toBe(false);
    expect(closed.response.statusCode).toBe(401);
    expect(hit('DELETE', '/agents/bot').called).toBe(true);

    process.env = { ...saved };
  });
});
