import type { Response } from 'express';
import { readCrew } from './naming';
import { SETTING_ID } from '../team/mission';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsController } from '../agents/agents.controller';
import { SettingsController } from './settings.controller';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';

/**
 * Seat assignment and roster position share one advisory lock.
 * These hit the isolated test database from jest global setup.
 * A lost update would leave two of six concurrent registers without a seat.
 */

const stamp = `lk${process.env.JEST_WORKER_ID ?? '0'}${Date.now().toString(36)}`;

class StatusResponse {
  statusCode = 0;
  status(code: number): this {
    this.statusCode = code;
    return this;
  }
}

function statusResponse(): Response {
  return new StatusResponse() as unknown as Response;
}

describe('crew seat lock', () => {
  const prisma = new PrismaService();
  const gateway = {
    broadcast: () => undefined,
    clientCount: 0,
  } as unknown as LiveActivityGateway;
  const agents = new AgentsController(prisma, gateway);
  const settings = new SettingsController(prisma);
  const extraIds: string[] = [];
  let original: Awaited<ReturnType<PrismaService['setting']['findUnique']>> =
    null;

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.agent.deleteMany({ where: { id: { startsWith: stamp } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    original = await prisma.setting.findUnique({ where: { id: SETTING_ID } });
  });

  afterEach(async () => {
    await prisma.agent.deleteMany({
      where: { id: { in: [...extraIds, stamp] } },
    });
    await prisma.agent.deleteMany({ where: { id: { startsWith: stamp } } });
    extraIds.length = 0;
    if (!original) {
      await prisma.setting.deleteMany({ where: { id: SETTING_ID } });
      return;
    }
    const data = {
      mission: original.mission,
      openclawVersion: original.openclawVersion,
      namingMode: original.namingMode,
      crewMap: original.crewMap ?? {},
      timezone: original.timezone,
      setupDone: original.setupDone,
    };
    await prisma.setting.upsert({
      where: { id: SETTING_ID },
      create: { id: SETTING_ID, ...data },
      update: data,
    });
  });

  async function parkOthers(): Promise<Record<string, string>> {
    const seats = readCrew();
    const others = await prisma.agent.findMany({
      where: { id: { not: { startsWith: stamp } } },
      orderBy: { position: 'asc' },
    });
    const parked: Record<string, string> = {};
    others.slice(0, seats.length).forEach((agent, index) => {
      parked[agent.id] = seats[index].id;
    });
    await prisma.setting.upsert({
      where: { id: SETTING_ID },
      create: {
        id: SETTING_ID,
        mission: '',
        namingMode: 'crew',
        crewMap: parked,
        setupDone: false,
      },
      update: { namingMode: 'crew', crewMap: parked },
    });
    return parked;
  }

  async function map(): Promise<Record<string, string>> {
    const row = await prisma.setting.findUnique({ where: { id: SETTING_ID } });
    const value = row?.crewMap;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, seat] of Object.entries(value)) {
      if (typeof seat === 'string') out[key] = seat;
    }
    return out;
  }

  it('gives six concurrent registers distinct seats and positions', async () => {
    const parked = await parkOthers();
    const free = readCrew().length - Object.keys(parked).length;
    expect(free).toBeGreaterThanOrEqual(6);
    const ids = Array.from({ length: 6 }, (_, index) => `${stamp}c${index}`);
    const results = await Promise.all(
      ids.map(async (id) => {
        const res = statusResponse();
        await agents.register({ id, name: 'Bot' }, res);
        return res.statusCode;
      }),
    );
    expect(results).toEqual([201, 201, 201, 201, 201, 201]);
    const rows = await prisma.agent.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.position)).size).toBe(6);
    const seats = await map();
    const taken = ids.map((id) => seats[id]);
    expect(taken.every((seat) => typeof seat === 'string')).toBe(true);
    expect(new Set(taken).size).toBe(6);
  });

  it('keeps a saved seat when a later agent has that id', async () => {
    await parkOthers();
    const seats = readCrew();
    const early = `${stamp}early`;
    await agents.register({ id: early, name: 'Early' }, statusResponse());
    const current = await map();
    const used = new Set(Object.values(current));
    const taken = new Set(
      (await prisma.agent.findMany({ select: { id: true } })).map(
        (agent) => agent.id,
      ),
    );
    const seat = seats.find(
      (item) => !taken.has(item.id) && !used.has(item.id),
    );
    expect(seat).toBeTruthy();
    extraIds.push(seat!.id);
    current[early] = seat!.id;
    await prisma.setting.update({
      where: { id: SETTING_ID },
      data: { crewMap: current },
    });
    await agents.register({ id: seat!.id, name: 'Late' }, statusResponse());
    const after = await map();
    expect(after[early]).toBe(seat!.id);
    expect(after[seat!.id]).toBeTruthy();
    expect(after[seat!.id]).not.toBe(seat!.id);
  });

  it('gives a freed seat to the earliest agent without one', async () => {
    const parked = await parkOthers();
    const free = readCrew().length - Object.keys(parked).length;
    expect(free).toBeGreaterThanOrEqual(1);
    const seatedCount = free;
    const ids = Array.from(
      { length: seatedCount + 2 },
      (_, index) => `${stamp}b${String(index).padStart(2, '0')}`,
    );
    for (const id of ids) {
      await agents.register({ id, name: 'Wait' }, statusResponse());
    }
    const before = await map();
    const seated = ids.filter((id) => before[id]);
    const waiting = ids.filter((id) => !before[id]);
    expect(seated.length).toBe(seatedCount);
    expect(waiting).toHaveLength(2);
    const rows = await prisma.agent.findMany({ where: { id: { in: ids } } });
    const position = new Map(rows.map((row) => [row.id, row.position]));
    const earliestWaiting = [...waiting].sort(
      (a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0),
    )[0];
    const removed = seated[0];
    const freed = before[removed];
    await agents.remove(removed);
    const afterDelete = await map();
    expect(afterDelete[removed]).toBeUndefined();
    expect(afterDelete[earliestWaiting]).toBe(freed);
    const newbie = `${stamp}bnew`;
    await agents.register({ id: newbie, name: 'Newer' }, statusResponse());
    const after = await map();
    expect(after[earliestWaiting]).toBe(freed);
    expect(after[newbie]).not.toBe(freed);
  });

  it('rejects an unknown crewMap agent and writes nothing', async () => {
    const id = `${stamp}known`;
    await agents.register({ id, name: 'Known' }, statusResponse());
    await settings.put({ namingMode: 'crew', crewMap: { [id]: 'speedy' } });
    const before = await prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    await expect(
      settings.put({ namingMode: 'crew', crewMap: { ghost: 'atlas' } }),
    ).rejects.toThrow(/unknown agent ghost/);
    const after = await prisma.setting.findUnique({
      where: { id: SETTING_ID },
    });
    expect(after?.namingMode).toBe(before?.namingMode);
    expect(after?.crewMap).toEqual(before?.crewMap);
    expect(after?.timezone).toBe(before?.timezone);
    expect(after?.setupDone).toBe(before?.setupDone);
  });

  it('seats a living agent missing from the map on the next register', async () => {
    const parked = await parkOthers();
    const free = readCrew().length - Object.keys(parked).length;
    expect(free).toBeGreaterThanOrEqual(1);
    const id = `${stamp}heal`;
    const max = await prisma.agent.aggregate({ _max: { position: true } });
    await prisma.agent.create({
      data: {
        id,
        name: 'Pixel',
        source: 'registered',
        position: (max._max.position ?? -1) + 1,
      },
    });
    const res = statusResponse();
    await agents.register({ id, name: 'Pixel' }, res);
    expect(res.statusCode).toBe(200);
    const seats = await map();
    expect(seats[id]).toBeTruthy();
    expect(Object.values(parked).includes(seats[id])).toBe(false);
  });

  it('does not create a settings row just to take the lock', async () => {
    await prisma.setting.deleteMany({ where: { id: SETTING_ID } });
    const id = `${stamp}bare`;
    const res = statusResponse();
    await agents.register({ id, name: 'Bare' }, res);
    expect(res.statusCode).toBe(201);
    expect(
      await prisma.setting.findUnique({ where: { id: SETTING_ID } }),
    ).toBeNull();
  });
});
