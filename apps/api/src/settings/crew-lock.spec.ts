import type { Response } from 'express';
import { readCrew, registrationOrder } from './naming';
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

function withoutKey(
  map: Record<string, string>,
  key: string,
): Record<string, string> {
  const out = { ...map };
  delete out[key];
  return out;
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

  async function chooseOwnName(): Promise<string> {
    await parkOthers();
    const id = `${stamp}own`;
    const res = statusResponse();
    await agents.register({ id, name: 'Quill' }, res);
    expect(res.statusCode).toBe(201);
    const before = await map();
    expect(before[id]).toBeTruthy();
    await settings.put({
      namingMode: 'crew',
      crewMap: { ...before, [id]: '' },
    });
    expect((await map())[id]).toBe('');
    return id;
  }

  it('keeps Own name when another agent registers', async () => {
    const own = await chooseOwnName();
    const zed = `${stamp}zed`;
    const res = statusResponse();
    await agents.register({ id: zed, name: 'Zed' }, res);
    expect(res.statusCode).toBe(201);
    const after = await map();
    expect(after[own]).toBe('');
    expect(after[zed]).toBeTruthy();
  });

  it('keeps Own name when another agent is deleted', async () => {
    const own = await chooseOwnName();
    const seated = `${stamp}seat`;
    await agents.register({ id: seated, name: 'Seat' }, statusResponse());
    const held = (await map())[seated];
    expect(held).toBeTruthy();
    const waiter = `${stamp}wait`;
    const max = await prisma.agent.aggregate({ _max: { position: true } });
    await prisma.agent.create({
      data: {
        id: waiter,
        name: 'Wait',
        source: 'registered',
        position: (max._max.position ?? 0) + 1,
      },
    });
    await agents.remove(seated);
    const after = await map();
    expect(after[own]).toBe('');
    expect(after[seated]).toBeUndefined();
    expect(after[waiter]).toBeTruthy();
    expect(after[waiter]).not.toBe('');
  });

  it('keeps Own name when a new client syncs after a restart', async () => {
    const own = await chooseOwnName();
    const fresh = new PrismaService();
    await fresh.$connect();
    try {
      const row = await fresh.setting.findUnique({
        where: { id: SETTING_ID },
      });
      const stored = row?.crewMap;
      expect(
        stored && typeof stored === 'object' && !Array.isArray(stored),
      ).toBe(true);
      expect((stored as Record<string, string>)[own]).toBe('');
      const restarted = new AgentsController(fresh, gateway);
      const res = statusResponse();
      await restarted.register({ id: `${stamp}boot`, name: 'Boot' }, res);
      expect(res.statusCode).toBe(201);
      const again = await fresh.setting.findUnique({
        where: { id: SETTING_ID },
      });
      expect((again?.crewMap as Record<string, string>)[own]).toBe('');
    } finally {
      await fresh.$disconnect();
    }
  });

  it('keeps a seat that a stale save does not name', async () => {
    await parkOthers();
    const first = `${stamp}first`;
    await agents.register({ id: first, name: 'First' }, statusResponse());
    const loaded = await map();
    const newcomer = `${stamp}new`;
    await agents.register({ id: newcomer, name: 'New' }, statusResponse());
    const seated = await map();
    expect(seated[newcomer]).toBeTruthy();
    const stale = { ...loaded };
    const destination = readCrew().find(
      (seat) =>
        seat.id !== loaded[first] &&
        seat.id !== seated[newcomer] &&
        !Object.values(loaded).includes(seat.id),
    );
    if (destination) stale[first] = destination.id;
    await settings.put({ namingMode: 'crew', crewMap: stale });
    expect((await map())[newcomer]).toBe(seated[newcomer]);
    expect((await map())[first]).toBe(stale[first]);
  });

  function freeSeats(current: Record<string, string>): string[] {
    const used = new Set(Object.values(current));
    return readCrew()
      .map((seat) => seat.id)
      .filter((id) => !used.has(id));
  }

  it('reseats the displaced holder in the same save response', async () => {
    await parkOthers();
    const helper = `${stamp}helper`;
    const ledger = `${stamp}ledger`;
    await agents.register({ id: helper, name: 'Helper' }, statusResponse());
    await agents.register({ id: ledger, name: 'Ledger' }, statusResponse());
    await settings.put({ namingMode: 'crew', crewMap: { [helper]: '' } });
    const before = await map();
    expect(before[helper]).toBe('');
    const held = before[ledger];
    expect(held).toBeTruthy();
    const open = freeSeats(before);
    expect(open.length).toBeGreaterThanOrEqual(1);
    const res = await settings.put({
      namingMode: 'crew',
      crewMap: { [helper]: held },
    });
    expect(res.crewMap[helper]).toBe(held);
    expect(res.crewMap[ledger]).toBe(open[0]);
    expect(await map()).toEqual(res.crewMap);
  });

  it('own names then crew again restores every seat and Own name choice', async () => {
    await parkOthers();
    const own = `${stamp}keep`;
    const seated = `${stamp}seated`;
    await agents.register({ id: own, name: 'Keep' }, statusResponse());
    await agents.register({ id: seated, name: 'Seated' }, statusResponse());
    await settings.put({ namingMode: 'crew', crewMap: { [own]: '' } });
    const before = await map();
    expect(before[own]).toBe('');
    expect(before[seated]).toBeTruthy();
    const asOwn = await settings.put({ namingMode: 'own', crewMap: {} });
    expect(asOwn.namingMode).toBe('own');
    expect(asOwn.crewMap).toEqual(before);
    await settings.put({ timezone: null });
    expect(await map()).toEqual(before);
    const back = await settings.put({ namingMode: 'crew' });
    expect(back.namingMode).toBe('crew');
    expect(back.crewMap).toEqual(before);
  });

  it('switching back to crew drops deleted agents and seats new ones, and no stored seat moves', async () => {
    await parkOthers();
    const stays = `${stamp}stays`;
    const leaves = `${stamp}leaves`;
    await agents.register({ id: stays, name: 'Stays' }, statusResponse());
    await agents.register({ id: leaves, name: 'Leaves' }, statusResponse());
    const before = await map();
    expect(before[stays]).toBeTruthy();
    expect(before[leaves]).toBeTruthy();
    await settings.put({ namingMode: 'own', crewMap: {} });
    await agents.remove(leaves);
    const arrives = `${stamp}arrives`;
    await agents.register({ id: arrives, name: 'Arrives' }, statusResponse());
    const whileOwn = await map();
    expect(whileOwn).toEqual(before);
    const back = await settings.put({ namingMode: 'crew', crewMap: {} });
    expect(back.crewMap[leaves]).toBeUndefined();
    expect(back.crewMap[arrives]).toBe(
      freeSeats(withoutKey(before, leaves))[0],
    );
    for (const [id, seat] of Object.entries(before)) {
      if (id === leaves) continue;
      expect(back.crewMap[id]).toBe(seat);
    }
  });

  it('with all seats full a new agent waits, and freeing a seat seats it on the next save', async () => {
    const parked = await parkOthers();
    const free = readCrew().length - Object.keys(parked).length;
    const fillers = Array.from(
      { length: free },
      (_, index) => `${stamp}f${String(index).padStart(2, '0')}`,
    );
    for (const id of fillers) {
      await agents.register({ id, name: 'Fill' }, statusResponse());
    }
    const late = `${stamp}late`;
    await agents.register({ id: late, name: 'Late' }, statusResponse());
    const full = await map();
    expect(freeSeats(full)).toHaveLength(0);
    expect(full[late]).toBeUndefined();
    const stillFull = await settings.put({ namingMode: 'crew', crewMap: {} });
    expect(stillFull.crewMap[late]).toBeUndefined();
    const giver = Object.keys(full).find((id) => full[id] !== '')!;
    const opened = full[giver];
    const res = await settings.put({
      namingMode: 'crew',
      crewMap: { [giver]: '' },
    });
    expect(res.crewMap[giver]).toBe('');
    const roster = await prisma.agent.findMany();
    const waiting = registrationOrder(
      roster.filter((agent) => !(agent.id in full)),
    );
    const next = waiting.find((agent) => agent.id === opened) ?? waiting[0];
    // The late agent is next unless another worker left an earlier waiter.
    expect(res.crewMap[next.id]).toBe(opened);
    if (waiting.length === 1) expect(res.crewMap[late]).toBe(opened);
  });
});
