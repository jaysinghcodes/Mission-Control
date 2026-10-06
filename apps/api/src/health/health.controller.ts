import { Controller, Get } from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HealthController — liveness/readiness probe for the API.
 *
 * Mission Control's OBSERVE lane shows real health values (never fake 100%):
 * this endpoint reports process uptime, live socket client count, and actual
 * database connectivity so the dashboard has honest data to render.
 * (GLM review 🟡 #7: health now reflects Prisma state, not just process liveness.)
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly gateway: LiveActivityGateway,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /health — liveness + readiness.
   * Returns status (ok | degraded), uptime seconds, connected dashboard
   * clients, and whether the database is reachable.
   */
  @Get()
  async getHealth() {
    const db = this.prisma.dbReady;
    let lastIngestAt: string | null = null;
    if (db) {
      const row = await this.prisma.activityEvent.findFirst({
        where: { source: 'openclaw' },
        orderBy: { ts: 'desc' },
        select: { ts: true },
      });
      lastIngestAt = row?.ts ? row.ts.toISOString() : null;
    }
    return {
      status: db ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      connectedClients: this.gateway.clientCount,
      database: db ? 'connected' : 'unavailable',
      lastIngestAt,
      ts: Date.now(),
    };
  }
}
