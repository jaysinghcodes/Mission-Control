import { Controller, Get, Optional, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TimezoneService } from '../time/timezone.service';
import { aggregateUsage, type UsageProvider } from './aggregate-usage';
import { applyUsagePrices } from './price-usage';
import { loadPriceTable, type PriceTable } from './prices';
import { usagePeriodLabel } from './period-window';
import { usageTimeZone } from './zone-time';

/**
 * UsageController: cost so far.
 *
 * Rows are daily buckets. Today (`24h`), `7d`, and `month` are summed here.
 * The day is the calendar day in the timezone saved in settings.
 * When that value is empty, the server timezone is used (`TZ`, else the host).
 * Dollars are tokens times config/prices.json, unless the provider sent costUsd.
 * The price files are read on each request.
 */
@Controller('usage')
export class UsageController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly zones?: TimezoneService,
  ) {}

  @Get()
  async get(@Query('period') period = '24h') {
    return this.read(period, Date.now());
  }

  async read(
    period: string,
    now: number,
    opts?: {
      timeZone?: string;
      prices?: PriceTable;
      localProviders?: ReadonlySet<string>;
    },
  ) {
    const timeZone =
      opts?.timeZone ??
      (this.zones ? await this.zones.current() : usageTimeZone());
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
      timeZone,
    );
    const priced =
      agg.rawLines.length === 0
        ? agg
        : applyUsagePrices(
            agg,
            opts?.prices ?? loadPriceTable(),
            opts?.localProviders ?? (await this.localProviders()),
          );
    return {
      usage: priced.usage,
      days: priced.days,
      note: priced.note,
      daysCovered: priced.daysCovered,
      daysExpected: priced.daysExpected,
      ts: now,
      label: usagePeriodLabel(period),
      windowStart: priced.windowStart,
      timeZone,
    };
  }

  private async localProviders(): Promise<Set<string>> {
    const rows = await this.prisma.modelConfig.findMany({
      select: { provider: true, local: true },
    });
    const names = new Set<string>();
    for (const row of rows) {
      if (row.local) names.add(row.provider.trim().toLowerCase());
    }
    return names;
  }
}
