import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { monthStartUtc } from './period-window';

/** UsageController — real cost snapshots (synced via usage.snapshot). */
@Controller('usage')
export class UsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Query('period') period = '24h') {
    const snap = await this.prisma.usageSnapshot.findUnique({ where: { period } });
    const body: { usage: typeof snap; ts: number; windowStart?: number } = {
      usage: snap,
      ts: Date.now(),
    };
    // `month` is the UTC calendar month to date. 24h and 7d stay duration windows.
    if (period === 'month') body.windowStart = monthStartUtc(Date.now());
    return body;
  }
}
