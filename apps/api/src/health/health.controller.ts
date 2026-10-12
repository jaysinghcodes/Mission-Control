import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthBody {
  service: 'mission-control';
  db: 'up' | 'down';
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  connectedClients: number;
  database: 'connected' | 'unavailable';
  lastIngestAt: string | null;
  ts: number;
}

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
   * GET /health. Always JSON with service mission-control.
   * db up is HTTP 200. db down is HTTP 503. A database error never becomes
   * an unhandled 500.
   */
  @Get()
  async getHealth(): Promise<HealthBody> {
    try {
      if (!this.prisma.dbReady) {
        throw new HttpException(
          this.payload(false, null),
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const row = await this.prisma.activityEvent.findFirst({
        where: { source: 'openclaw' },
        orderBy: { ts: 'desc' },
        select: { ts: true },
      });
      return this.payload(true, row?.ts ? row.ts.toISOString() : null);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        this.payload(false, null),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private payload(dbUp: boolean, lastIngestAt: string | null): HealthBody {
    return {
      service: 'mission-control',
      db: dbUp ? 'up' : 'down',
      status: dbUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      connectedClients: this.gateway.clientCount,
      database: dbUp ? 'connected' : 'unavailable',
      lastIngestAt,
      ts: Date.now(),
    };
  }
}
