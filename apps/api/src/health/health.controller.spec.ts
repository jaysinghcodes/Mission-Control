import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { HealthController } from './health.controller';
import { buildInfo, resetBuildInfoCache } from '../build-info';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Unit tests for HealthController (GLM review 🟡 #11).
 * Prisma + gateway are mocked — we only assert the response shape.
 */
describe('HealthController', () => {
  let controller: HealthController;
  let gateway: { clientCount: number };
  let prisma: {
    dbReady: boolean;
    activityEvent: { findFirst: jest.Mock };
    setting: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    resetBuildInfoCache();
    gateway = { clientCount: 3 };
    prisma = {
      dbReady: true,
      activityEvent: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            ts: new Date('2026-10-05T12:00:00.000Z'),
          }),
        ),
      },
      setting: {
        findUnique: jest.fn(() =>
          Promise.resolve({ openclawVersion: '2026.10.15' }),
        ),
      },
    };
    controller = new HealthController(
      gateway as unknown as LiveActivityGateway,
      prisma as unknown as PrismaService,
    );
  });

  it('reports ok when the database is reachable', async () => {
    const res = await controller.getHealth();

    expect(res.service).toBe('mission-control');
    expect(res.db).toBe('up');
    expect(res.status).toBe('ok');
    expect(res.database).toBe('connected');
    expect(res.connectedClients).toBe(3);
    expect(res.uptimeSeconds).toEqual(expect.any(Number));
    expect(res.ts).toEqual(expect.any(Number));
    expect(res.lastIngestAt).toBe('2026-10-05T12:00:00.000Z');
    expect(res.version).toBe(buildInfo().version);
    expect(res.gitSha).toBe(buildInfo().gitSha);
    expect(res.openclawVersion).toBe('2026.10.15');
    expect(prisma.activityEvent.findFirst).toHaveBeenCalledWith({
      where: { source: 'openclaw' },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
  });

  it('returns 503 JSON when the database is down', async () => {
    prisma.dbReady = false;
    await expect(controller.getHealth()).rejects.toBeInstanceOf(HttpException);
    try {
      await controller.getHealth();
    } catch (err) {
      const http = err as HttpException;
      expect(http.getStatus()).toBe(503);
      expect(http.getResponse()).toMatchObject({
        service: 'mission-control',
        db: 'down',
        status: 'degraded',
        database: 'unavailable',
        lastIngestAt: null,
        openclawVersion: null,
        version: buildInfo().version,
        gitSha: buildInfo().gitSha,
      });
    }
    expect(prisma.activityEvent.findFirst).not.toHaveBeenCalled();
    expect(prisma.setting.findUnique).not.toHaveBeenCalled();
  });

  it('returns 503 JSON when the database query throws', async () => {
    prisma.activityEvent.findFirst.mockRejectedValue(
      new Error('database unreachable'),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: LiveActivityGateway, useValue: gateway },
      ],
    }).compile();
    const nest: INestApplication<App> = moduleRef.createNestApplication();
    await nest.init();
    try {
      const res = await request(nest.getHttpServer()).get('/health');
      const body = res.body as {
        service: string;
        db: string;
        status: string;
        database: string;
        statusCode?: number;
      };
      expect(res.status).toBe(503);
      expect(body).toMatchObject({
        service: 'mission-control',
        db: 'down',
        status: 'degraded',
        database: 'unavailable',
      });
      expect(body.statusCode).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('reports no ingest when the bridge has never posted', async () => {
    prisma.activityEvent.findFirst.mockResolvedValue(null);
    const res = await controller.getHealth();
    expect(res.lastIngestAt).toBeNull();
  });
});
