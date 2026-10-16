import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response } from 'express';
import { WriteAuthMiddleware } from '../auth/write-auth.middleware';
import { SettingsController } from './settings.controller';
import type { PrismaService } from '../prisma/prisma.service';
import { parseCrew, readCrew, readNamingBody, readStoredMode } from './naming';

describe('crew file', () => {
  const seats = readCrew();

  it('ships 12 seats from config/crew.json and the frontend roster file is gone', () => {
    expect(seats).toHaveLength(12);
    expect(new Set(seats.map((seat) => seat.id)).size).toBe(12);
    expect(seats[0]).toMatchObject({
      id: 'speedy',
      role: 'Chief of Staff',
      desk: 'Lead table',
    });
    expect(seats.map((seat) => seat.id)).toContain('sentinel');
    expect(existsSync(join(__dirname, '../../../web/src/data/roster.ts'))).toBe(
      false,
    );
    expect(existsSync(join(__dirname, '../../../web/src/data/mock.ts'))).toBe(
      false,
    );
  });

  it('boot does not insert a default roster', () => {
    const boot = readFileSync(join(__dirname, '../boot.ts'), 'utf8');
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(boot).not.toContain('agent.create');
    expect(main).not.toContain('agent.create');
    expect(boot).not.toContain('seed:demo');
  });

  it('rejects a seat list that is not the file shape', () => {
    expect(() => parseCrew({ seats: [] })).toThrow(/non empty/);
    expect(() =>
      parseCrew({
        seats: [
          {
            id: 'speedy',
            name: 'Speedy',
            role: 'QA',
            desk: 'Test desk',
            color: 'red',
          },
        ],
      }),
    ).toThrow(/color/);
  });
});

describe('naming body', () => {
  const seats = readCrew();

  it('accepts own names with an empty map', () => {
    expect(readNamingBody({ namingMode: 'own' }, seats)).toEqual({
      namingMode: 'own',
      crewMap: {},
    });
  });

  it('stores an explicit agent id map and ignores role words', () => {
    const saved = readNamingBody(
      { namingMode: 'crew', crewMap: { main: 'speedy', dev: 'forge' } },
      seats,
    );
    expect(saved.crewMap).toEqual({ main: 'speedy', dev: 'forge' });
    expect(saved.crewMap.dev).toBe('forge');
    expect(readStoredMode('dev')).toBeNull();
  });

  it('rejects a duplicate seat, an unknown seat, and a bad mode', () => {
    expect(() =>
      readNamingBody(
        { namingMode: 'crew', crewMap: { main: 'speedy', other: 'speedy' } },
        seats,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      readNamingBody({ namingMode: 'crew', crewMap: { main: 'dev' } }, seats),
    ).toThrow(/unknown crew seat/);
    expect(() => readNamingBody({ namingMode: 'alias' }, seats)).toThrow(
      /namingMode must be crew or own/,
    );
    expect(() =>
      readNamingBody({ namingMode: 'own', extra: true }, seats),
    ).toThrow(/unknown field/);
  });
});

interface HitResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => HitResponse;
  json: (payload: unknown) => HitResponse;
}

describe('SettingsController', () => {
  it('GET is unset until PUT saves an agent id map', async () => {
    let row: { namingMode: string | null; crewMap: unknown } | null = null;
    const prisma = {
      setting: {
        findUnique: jest.fn(() => row),
        upsert: jest.fn(
          (args: {
            create: { namingMode: string; crewMap: unknown };
            update: { namingMode: string; crewMap: unknown };
          }) => {
            row = row
              ? {
                  namingMode: args.update.namingMode,
                  crewMap: args.update.crewMap,
                }
              : {
                  namingMode: args.create.namingMode,
                  crewMap: args.create.crewMap,
                };
            return row;
          },
        ),
      },
    };
    const controller = new SettingsController(
      prisma as unknown as PrismaService,
    );
    const first = await controller.get();
    expect(first.namingMode).toBeNull();
    expect(first.crewMap).toEqual({});
    expect(first.seats).toHaveLength(12);
    const saved = await controller.put({
      namingMode: 'crew',
      crewMap: { main: 'speedy' },
    });
    expect(saved.namingMode).toBe('crew');
    expect(saved.crewMap).toEqual({ main: 'speedy' });
    expect(saved.seats.find((seat) => seat.id === 'speedy')?.name).toBe(
      'Speedy',
    );
    expect(first.setupDone).toBe(false);
    expect(first.timezoneSaved).toBe(false);
  });

  it('saves a timezone and setup flag without clearing names', async () => {
    let row: {
      namingMode: string | null;
      crewMap: unknown;
      timezone: string | null;
      setupDone: boolean;
    } | null = null;
    const prisma = {
      setting: {
        findUnique: jest.fn(() => row),
        upsert: jest.fn(
          (args: {
            create: {
              namingMode: string | null;
              crewMap: unknown;
              timezone: string | null;
              setupDone: boolean;
            };
            update: {
              namingMode?: string | null;
              crewMap?: unknown;
              timezone?: string | null;
              setupDone?: boolean;
            };
          }) => {
            row = row
              ? {
                  namingMode:
                    args.update.namingMode !== undefined
                      ? args.update.namingMode
                      : row.namingMode,
                  crewMap:
                    args.update.crewMap !== undefined
                      ? args.update.crewMap
                      : row.crewMap,
                  timezone:
                    args.update.timezone !== undefined
                      ? args.update.timezone
                      : row.timezone,
                  setupDone:
                    args.update.setupDone !== undefined
                      ? args.update.setupDone
                      : row.setupDone,
                }
              : {
                  namingMode: args.create.namingMode,
                  crewMap: args.create.crewMap,
                  timezone: args.create.timezone,
                  setupDone: args.create.setupDone,
                };
            return row;
          },
        ),
      },
    };
    const controller = new SettingsController(
      prisma as unknown as PrismaService,
    );
    await controller.put({ namingMode: 'own' });
    const zoned = await controller.put({ timezone: 'Europe/Berlin' });
    expect(zoned.namingMode).toBe('own');
    expect(zoned.timezone).toBe('Europe/Berlin');
    expect(zoned.timezoneSaved).toBe(true);
    expect(zoned.setupDone).toBe(false);
    const done = await controller.put({ setupDone: true });
    expect(done.setupDone).toBe(true);
    expect(done.namingMode).toBe('own');
    expect(done.timezone).toBe('Europe/Berlin');
    const cleared = await controller.put({ timezone: null });
    expect(cleared.timezoneSaved).toBe(false);
    expect(cleared.namingMode).toBe('own');
    await expect(
      controller.put({ timezone: 'Not/AZone' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.put({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PUT /settings returns 400 for an offset or an abbreviation', async () => {
    const controller = new SettingsController({} as PrismaService);
    await expect(controller.put({ timezone: '+02:00' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.put({ timezone: 'CST' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('PUT /settings stores a legacy zone as its current name', async () => {
    let row: { timezone: string | null } | null = null;
    const prisma = {
      setting: {
        findUnique: jest.fn(() => row),
        upsert: jest.fn(
          (args: {
            create: { timezone: string | null };
            update: { timezone?: string | null };
          }) => {
            const timezone =
              args.update.timezone !== undefined
                ? args.update.timezone
                : (row?.timezone ?? args.create.timezone);
            row = { timezone };
            return {
              namingMode: null,
              crewMap: {},
              timezone,
              setupDone: false,
            };
          },
        ),
      },
    };
    const controller = new SettingsController(
      prisma as unknown as PrismaService,
    );
    const kolkata = await controller.put({ timezone: 'Asia/Calcutta' });
    expect(kolkata.timezone).toBe('Asia/Kolkata');
    expect(kolkata.timezoneSaved).toBe(true);
    const saved = await controller.put({ timezone: 'Asia/Kolkata' });
    expect(saved.timezone).toBe('Asia/Kolkata');
    const kyiv = await controller.put({ timezone: 'Europe/Kyiv' });
    expect(kyiv.timezone).toBe('Europe/Kyiv');
  });

  it('PUT /settings is a write and production without a token is 401', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata lives on the original method
    const put = SettingsController.prototype.put;
    expect(Reflect.getMetadata(METHOD_METADATA, put)).toBe(RequestMethod.PUT);
    expect(Reflect.getMetadata(PATH_METADATA, put)).toBe('/');

    const saved = { ...process.env };
    const middleware = new WriteAuthMiddleware();
    const hit = (token?: string) => {
      const headers: Record<string, string> = {};
      if (token !== undefined) headers['x-ingest-token'] = token;
      let called = false;
      const response: HitResponse = {
        statusCode: 200,
        body: null,
        status(this: HitResponse, code: number) {
          this.statusCode = code;
          return this;
        },
        json(this: HitResponse, payload: unknown) {
          this.body = payload;
          return this;
        },
      };
      middleware.use(
        { method: 'PUT', headers } as Request,
        response as unknown as Response,
        () => {
          called = true;
        },
      );
      return { called, response };
    };

    process.env.INGEST_TOKEN = 'secret';
    process.env.NODE_ENV = 'test';
    expect(hit().response.statusCode).toBe(401);
    expect(hit('secret').called).toBe(true);

    delete process.env.INGEST_TOKEN;
    process.env.NODE_ENV = 'production';
    const closed = hit();
    expect(closed.called).toBe(false);
    expect(closed.response.statusCode).toBe(401);
    expect(closed.response.body).toEqual({
      statusCode: 401,
      message: 'unauthorized',
    });

    process.env.NODE_ENV = 'test';
    expect(hit().called).toBe(true);
    process.env = saved;
  });
});
