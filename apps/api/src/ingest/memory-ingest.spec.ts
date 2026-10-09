import { IngestController } from './ingest.controller';
import type { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import type { PrismaService } from '../prisma/prisma.service';
import type { SnapshotsService } from '../snapshots/snapshots.service';

describe('POST /events memory.snapshot', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.INGEST_TOKEN;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('accepts memory.snapshot and applies it through the snapshot service', async () => {
    const applyMemory = jest.fn(async () => undefined);
    const snapshots = { applyMemory } as unknown as SnapshotsService;
    const prisma = {
      activityEvent: { create: jest.fn(async () => ({ id: 'evt' })) },
    } as unknown as PrismaService;
    const gateway = { broadcast: jest.fn() } as unknown as LiveActivityGateway;
    const controller = new IngestController(gateway, prisma, snapshots);
    const payload = { entries: [{ id: 'mem-1' }] };

    const res = await controller.ingest({ type: 'memory.snapshot', payload });

    expect(res.accepted).toBe(true);
    expect(res.type).toBe('memory.snapshot');
    expect(applyMemory).toHaveBeenCalledWith(payload);
    expect(gateway.broadcast).toHaveBeenCalledWith(
      'memory.snapshot',
      expect.objectContaining({ entries: payload.entries }),
    );
  });

  it('still rejects an unknown type', async () => {
    const controller = new IngestController(
      { broadcast: jest.fn() } as unknown as LiveActivityGateway,
      { activityEvent: { create: jest.fn() } } as unknown as PrismaService,
      { applyMemory: jest.fn() } as unknown as SnapshotsService,
    );
    await expect(
      controller.ingest({ type: 'memory.write', payload: {} }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
