import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTimeZone } from '../usage/zone-time';
import { SETTING_ID } from '../team/mission';

/**
 * The timezone usage and memory bucket on.
 * A saved settings value wins. Otherwise the server timezone is used.
 */
@Injectable()
export class TimezoneService {
  constructor(private readonly prisma: PrismaService) {}

  async current(): Promise<string> {
    const row = await this.prisma.setting.findUnique({
      where: { id: SETTING_ID },
      select: { timezone: true },
    });
    return resolveTimeZone(row?.timezone ?? null);
  }
}
