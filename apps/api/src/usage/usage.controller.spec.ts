import { UsageController } from './usage.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('UsageController', () => {
  function controller() {
    const prisma = { usageSnapshot: { findUnique: jest.fn(async () => null) } };
    return new UsageController(prisma as unknown as PrismaService);
  }

  it('adds a UTC month-start cutoff for period=month', async () => {
    const res = await controller().get('month');
    expect(res.windowStart).toEqual(expect.any(Number));
    const start = new Date(res.windowStart!);
    expect(start.getUTCDate()).toBe(1);
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('omits the cutoff for a duration window', async () => {
    const res = await controller().get('24h');
    expect(res).not.toHaveProperty('windowStart');
  });
});
