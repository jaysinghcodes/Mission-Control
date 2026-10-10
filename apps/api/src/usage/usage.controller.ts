import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  USAGE_DISPLAY_TZ,
  aggregateUsage,
  type UsageProvider,
} from './aggregate-usage';
import { usagePeriodLabel } from './period-window';

/**
 * UsageController — spend for System.
 *
 * Rows are daily buckets. Today (`24h`), `7d`, and `month` are summed here.
 * Today is the calendar day in America/Chicago. The bridge does not post those totals.
 */
@Controller('usage')
export class UsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Query('period') period = '24h') {
    return this.read(period, Date.now());
  }

  async read(period: string, now: number) {
    const rows = await this.prisma.usageBucket.findMany();
    const agg = aggregateUsage(
      rows.map((row) => ({
        at: row.at,
        totalCost: row.totalCost,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        providers: row.providers as UsageProvider[] | null,
      })),
      period,
      now,
      USAGE_DISPLAY_TZ,
    );
    return {
      usage: agg.usage,
      days: agg.days,
      note: agg.note,
      daysCovered: agg.daysCovered,
      daysExpected: agg.daysExpected,
      ts: now,
      label: usagePeriodLabel(period),
      windowStart: agg.windowStart,
    };
  }
}
