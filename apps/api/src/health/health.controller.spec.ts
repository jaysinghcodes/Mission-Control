import { HealthController } from './health.controller';
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
  };

  beforeEach(() => {
    gateway = { clientCount: 3 };
    prisma = {
      dbReady: true,
      activityEvent: {
        findFirst: jest.fn(async () => ({ ts: new Date('2026-10-05T12:00:00.000Z') })),
      },
    };
    controller = new HealthController(
      gateway as unknown as LiveActivityGateway,
      prisma as unknown as PrismaService,
    );
  });

  it('reports ok when the database is reachable', async () => {
    const res = await controller.getHealth();

    expect(res.status).toBe('ok');
    expect(res.database).toBe('connected');
    expect(res.connectedClients).toBe(3);
    expect(res.uptimeSeconds).toEqual(expect.any(Number));
    expect(res.ts).toEqual(expect.any(Number));
    expect(res.lastIngestAt).toBe('2026-10-05T12:00:00.000Z');
    expect(prisma.activityEvent.findFirst).toHaveBeenCalledWith({
      where: { source: 'openclaw' },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
  });

  it('reports degraded when the database is down (no fake 100%)', async () => {
    prisma.dbReady = false;
    const res = await controller.getHealth();

    expect(res.status).toBe('degraded');
    expect(res.database).toBe('unavailable');
    expect(res.lastIngestAt).toBeNull();
    expect(prisma.activityEvent.findFirst).not.toHaveBeenCalled();
  });

  it('reports no ingest when the bridge has never posted', async () => {
    prisma.activityEvent.findFirst.mockResolvedValue(null);
    const res = await controller.getHealth();
    expect(res.lastIngestAt).toBeNull();
  });
});
