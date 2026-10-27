import { bodyMessage, responseJson } from '../../test/lint-helpers';

function missionBody(res: { body: unknown }): {
  mission: string;
  placeholder: string;
} {
  return responseJson(res);
}

function errorBody(res: { body: unknown }): { statusCode: number } {
  return responseJson(res);
}

function deviceBody(res: { body: unknown }): { devices: unknown[] } {
  return responseJson(res);
}

import { promiseFn } from '../../test/lint-helpers';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { MISSION_MAX, MISSION_PLACEHOLDER } from './mission';
import { DevicesController, MissionController } from './team.controller';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { DEVICE_NAME_MAX, DEVICE_TYPES } from './devices';

type DeviceJson = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string | null;
  requestedAt: string | null;
  source: string | null;
};

function createdBody(res: { body: unknown }): { device: DeviceJson } {
  return responseJson(res);
}

function listBody(res: { body: unknown }): { devices: DeviceJson[] } {
  return responseJson(res);
}

type SettingRow = { id: string; mission: string; updatedAt: Date };
type DeviceRow = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: Date | null;
  pairedAt?: Date | null;
  requestedAt?: Date | null;
  source?: string;
  kind?: string;
};

function makeStore() {
  const settings = new Map<string, SettingRow>();
  let devices: DeviceRow[] = [];
  const prisma = {
    setting: {
      findUnique: jest.fn(
        promiseFn(
          ({ where }: { where: { id: string } }) =>
            settings.get(where.id) ?? null,
        ),
      ),
      upsert: jest.fn(
        promiseFn(
          ({
            where,
            create,
            update,
          }: {
            where: { id: string };
            create: { id: string; mission: string };
            update: { mission: string };
          }) => {
            const existing = settings.get(where.id);
            const next: SettingRow = existing
              ? { ...existing, mission: update.mission, updatedAt: new Date() }
              : {
                  id: create.id,
                  mission: create.mission,
                  updatedAt: new Date(),
                };
            settings.set(next.id, next);
            return next;
          },
        ),
      ),
    },
    device: {
      findMany: jest.fn(
        promiseFn(() =>
          [...devices].sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
        ),
      ),
      findUnique: jest.fn(
        promiseFn(
          ({ where }: { where: { id: string } }) =>
            devices.find((row) => row.id === where.id) ?? null,
        ),
      ),
      create: jest.fn(
        promiseFn(({ data }: { data: DeviceRow }) => {
          devices = [...devices, { ...data }];
          return { ...data };
        }),
      ),
      deleteMany: jest.fn(
        promiseFn(({ where }: { where: { id: string } }) => {
          const before = devices.length;
          devices = devices.filter((row) => row.id !== where.id);
          return { count: before - devices.length };
        }),
      ),
    },
  };
  return {
    prisma,
    devices: () => devices,
    settings,
    setDevices(rows: DeviceRow[]) {
      devices = rows;
    },
  };
}

describe('Team mission and devices', () => {
  let app: INestApplication;
  const store = makeStore();
  const gateway = { broadcast: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MissionController, DevicesController],
      providers: [
        { provide: PrismaService, useValue: store.prisma },
        { provide: LiveActivityGateway, useValue: gateway },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    store.settings.clear();
    store.setDevices([]);
    gateway.broadcast.mockClear();
  });

  it('returns the placeholder path when no mission is stored', async () => {
    const res = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(missionBody(res).mission).toBe('');
    expect(missionBody(res).placeholder).toBe(MISSION_PLACEHOLDER);
    expect(missionBody(res).placeholder.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('error');
  });

  it('saves a mission and reads it back', async () => {
    const first = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: 'Ship the weekly brief.' })
      .expect(200);
    expect(missionBody(first).mission).toBe('Ship the weekly brief.');

    const got = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(missionBody(got).mission).toBe('Ship the weekly brief.');

    const second = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: '  A different line.  ' })
      .expect(200);
    expect(missionBody(second).mission).toBe('A different line.');
    const again = await request(app.getHttpServer())
      .get('/mission')
      .expect(200);
    expect(missionBody(again).mission).toBe('A different line.');
  });

  it('treats an empty mission as the placeholder path', async () => {
    await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: 'Hello' })
      .expect(200);
    const cleared = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: '   ' })
      .expect(200);
    expect(missionBody(cleared).mission).toBe('');
    expect(missionBody(cleared).placeholder).toBe(MISSION_PLACEHOLDER);

    const got = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(missionBody(got).mission).toBe('');
    expect(missionBody(got).placeholder).toBe(MISSION_PLACEHOLDER);
  });

  it('rejects a mission that is not a string or is over the max, and does not save it', async () => {
    await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: 'Kept' })
      .expect(200);

    const tooLong = 'x'.repeat(MISSION_MAX + 1);
    const over = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: tooLong })
      .expect(400);
    expect(errorBody(over).statusCode).toBe(400);
    expect(bodyMessage(over)).toMatch(/at most/);
    expect(over.body).not.toHaveProperty('mission');

    const missing = await request(app.getHttpServer())
      .put('/mission')
      .send({})
      .expect(400);
    expect(errorBody(missing).statusCode).toBe(400);

    const numeric = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: 12 })
      .expect(400);
    expect(errorBody(numeric).statusCode).toBe(400);

    const kept = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(missionBody(kept).mission).toBe('Kept');
  });

  it('lists devices with name, type, and online or last-seen', async () => {
    store.setDevices([
      {
        id: 'b',
        name: 'Field laptop',
        type: 'laptop',
        online: false,
        lastSeenAt: new Date('2026-10-06T15:04:00.000Z'),
      },
      {
        id: 'a',
        name: 'API host',
        type: 'server',
        online: true,
        lastSeenAt: null,
      },
    ]);
    const res = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(deviceBody(res).devices).toEqual([
      {
        id: 'a',
        name: 'API host',
        type: 'server',
        online: true,
        lastSeenAt: null,
        pairedAt: null,
        requestedAt: null,
        source: null,
      },
      {
        id: 'b',
        name: 'Field laptop',
        type: 'laptop',
        online: false,
        lastSeenAt: '2026-10-06T15:04:00.000Z',
        pairedAt: null,
        requestedAt: null,
        source: null,
      },
    ]);
    expect(res.body).not.toHaveProperty('error');
  });

  it('returns an empty device list', async () => {
    const res = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(deviceBody(res).devices).toEqual([]);
    expect(res.body).not.toHaveProperty('error');
  });

  it('creates a manual device with an API id, offline, paired now, and broadcasts', async () => {
    const before = Date.now();
    const res = await request(app.getHttpServer())
      .post('/devices')
      .send({ name: '  Kitchen laptop  ', type: 'laptop' })
      .expect(201);
    const { device } = createdBody(res);
    expect(device.id).toMatch(/^manual-/);
    expect(device).toMatchObject({
      name: 'Kitchen laptop',
      type: 'laptop',
      online: false,
      lastSeenAt: null,
      requestedAt: null,
      source: 'manual',
    });
    expect(new Date(device.pairedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'devices.snapshot',
      expect.objectContaining({ action: 'create', deviceId: device.id }),
    );

    const list = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(listBody(list).devices.map((d) => d.name)).toEqual([
      'Kitchen laptop',
    ]);

    const second = await request(app.getHttpServer())
      .post('/devices')
      .send({ name: 'Desk phone', type: 'phone' })
      .expect(201);
    expect(createdBody(second).device.id).not.toBe(device.id);
    const both = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(listBody(both).devices.map((d) => [d.name, d.type])).toEqual([
      ['Desk phone', 'phone'],
      ['Kitchen laptop', 'laptop'],
    ]);
  });

  it('accepts every allowed type', async () => {
    for (const type of DEVICE_TYPES) {
      await request(app.getHttpServer())
        .post('/devices')
        .send({ name: `A ${type}`, type })
        .expect(201);
    }
    expect(store.devices()).toHaveLength(DEVICE_TYPES.length);
  });

  it('rejects a bad name, a bad type, or an unknown field and saves nothing', async () => {
    const bad: unknown[] = [
      {},
      { type: 'laptop' },
      { name: '   ', type: 'laptop' },
      { name: 12, type: 'laptop' },
      { name: 'x'.repeat(DEVICE_NAME_MAX + 1), type: 'laptop' },
      { name: 'Laptop' },
      { name: 'Laptop', type: 'tablet' },
      { name: 'Laptop', type: 3 },
      { name: 'Laptop', type: 'laptop', id: 'mine' },
      { name: 'Laptop', type: 'laptop', online: true },
      ['Laptop'],
    ];
    for (const body of bad) {
      const res = await request(app.getHttpServer())
        .post('/devices')
        .send(body as object)
        .expect(400);
      expect(errorBody(res).statusCode).toBe(400);
    }
    expect(store.devices()).toEqual([]);
    expect(gateway.broadcast).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/devices')
      .send({ name: 'x'.repeat(DEVICE_NAME_MAX), type: 'other' })
      .expect(201);
  });

  it('deletes any device and returns 404 for a missing id', async () => {
    store.setDevices([
      {
        id: 'demo-device-studio',
        name: 'Studio display',
        type: 'browser',
        online: true,
        lastSeenAt: null,
        source: 'demo',
      },
      {
        id: 'mac-1',
        name: 'Kitchen Mac',
        type: 'operator',
        online: true,
        lastSeenAt: null,
        source: 'bridge',
      },
    ]);
    const made = await request(app.getHttpServer())
      .post('/devices')
      .send({ name: 'Field phone', type: 'phone' })
      .expect(201);
    const id = createdBody(made).device.id;

    await request(app.getHttpServer()).delete(`/devices/${id}`).expect(204);
    await request(app.getHttpServer())
      .delete('/devices/demo-device-studio')
      .expect(204);
    await request(app.getHttpServer()).delete('/devices/mac-1').expect(204);
    expect(store.devices()).toEqual([]);
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'devices.snapshot',
      expect.objectContaining({ action: 'delete', deviceId: id }),
    );

    const missing = await request(app.getHttpServer())
      .delete(`/devices/${id}`)
      .expect(404);
    expect(errorBody(missing).statusCode).toBe(404);
  });
});
