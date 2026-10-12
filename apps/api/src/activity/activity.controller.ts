import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ActivityController — persisted event history. Every ingest is stored in
 * ActivityEvent, so pages can load the recent stream on mount (the socket
 * only delivers live events).
 */
@Controller('activity')
export class ActivityController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('limit') limit = '50') {
    const n = Math.min(Number(limit) || 50, 200);
    const events = await this.prisma.activityEvent.findMany({
      orderBy: { ts: 'desc' },
      take: n,
    });
    return { events, ts: Date.now() };
  }
}
