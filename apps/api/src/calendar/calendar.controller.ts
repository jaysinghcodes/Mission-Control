import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** CalendarController — real cron jobs (synced via calendar.snapshot). */
@Controller('calendar')
export class CalendarController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const jobs = await this.prisma.cronJob.findMany({
      orderBy: { day: 'asc' },
    });
    return { jobs, ts: Date.now() };
  }
}
