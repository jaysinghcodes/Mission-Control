import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { MISSION_MAX, MISSION_PLACEHOLDER } from './mission';
import { DevicesController, MissionController } from './team.controller';

type SettingRow = { id: string; mission: string; updatedAt: Date };
type DeviceRow = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: Date | null;
};

function makeStore() {
  const settings = new Map<string, SettingRow>();
  let devices: DeviceRow[] = [];
  const prisma = {
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => settings.get(where.id) ?? null),
      upsert: jest.fn(
        async ({
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
            : { id: create.id, mission: create.mission, updatedAt: new Date() };
          settings.set(next.id, next);
          return next;
        },
      ),
    },
    device: {
      findMany: jest.fn(async () =>
        [...devices].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      ),
    },
  };
  return {
    prisma,
    settings,
    setDevices(rows: DeviceRow[]) {
      devices = rows;
    },
  };
}

describe('Team mission and devices', () => {
  let app: INestApplication;
  const store = makeStore();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MissionController, DevicesController],
      providers: [{ provide: PrismaService, useValue: store.prisma }],
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
  });

  it('returns the placeholder path when no mission is stored', async () => {
    const res = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(res.body.mission).toBe('');
    expect(res.body.placeholder).toBe(MISSION_PLACEHOLDER);
    expect(res.body.placeholder.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('error');
  });

  it('saves a mission and reads it back', async () => {
    const first = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: 'Ship the weekly brief.' })
      .expect(200);
    expect(first.body.mission).toBe('Ship the weekly brief.');

    const got = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(got.body.mission).toBe('Ship the weekly brief.');

    const second = await request(app.getHttpServer())
      .put('/mission')
      .send({ mission: '  A different line.  ' })
      .expect(200);
    expect(second.body.mission).toBe('A different line.');
    const again = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(again.body.mission).toBe('A different line.');
  });

  it('treats an empty mission as the placeholder path', async () => {
    await request(app.getHttpServer()).put('/mission').send({ mission: 'Hello' }).expect(200);
    const cleared = await request(app.getHttpServer()).put('/mission').send({ mission: '   ' }).expect(200);
    expect(cleared.body.mission).toBe('');
    expect(cleared.body.placeholder).toBe(MISSION_PLACEHOLDER);

    const got = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(got.body.mission).toBe('');
    expect(got.body.placeholder).toBe(MISSION_PLACEHOLDER);
  });

  it('rejects a mission that is not a string or is over the max, and does not save it', async () => {
    await request(app.getHttpServer()).put('/mission').send({ mission: 'Kept' }).expect(200);

    const tooLong = 'x'.repeat(MISSION_MAX + 1);
    const over = await request(app.getHttpServer()).put('/mission').send({ mission: tooLong }).expect(400);
    expect(over.body.statusCode).toBe(400);
    expect(String(over.body.message)).toMatch(/at most/);
    expect(over.body).not.toHaveProperty('mission');

    const missing = await request(app.getHttpServer()).put('/mission').send({}).expect(400);
    expect(missing.body.statusCode).toBe(400);

    const numeric = await request(app.getHttpServer()).put('/mission').send({ mission: 12 }).expect(400);
    expect(numeric.body.statusCode).toBe(400);

    const kept = await request(app.getHttpServer()).get('/mission').expect(200);
    expect(kept.body.mission).toBe('Kept');
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
      { id: 'a', name: 'API host', type: 'server', online: true, lastSeenAt: null },
    ]);
    const res = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(res.body.devices).toEqual([
      { id: 'a', name: 'API host', type: 'server', online: true, lastSeenAt: null },
      {
        id: 'b',
        name: 'Field laptop',
        type: 'laptop',
        online: false,
        lastSeenAt: '2026-10-06T15:04:00.000Z',
      },
    ]);
    expect(res.body).not.toHaveProperty('error');
  });

  it('returns an empty device list', async () => {
    const res = await request(app.getHttpServer()).get('/devices').expect(200);
    expect(res.body.devices).toEqual([]);
    expect(res.body).not.toHaveProperty('error');
  });
});
