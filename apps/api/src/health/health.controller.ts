import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { buildInfo, type BuildInfo } from '../build-info';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_ID } from '../team/mission';

export interface HealthBody {
  service: 'mission-control';
  db: 'up' | 'down';
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  connectedClients: number;
  database: 'connected' | 'unavailable';
  lastIngestAt: string | null;
  /** apps/api/package.json version. */
  version: string;
  /** Git commit, or null when this process has no SHA. */
  gitSha: string | null;
  /** OpenClaw version from the latest models.snapshot, or null. */
  openclawVersion: string | null;
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
    const info = buildInfo();
    try {
      if (!this.prisma.dbReady) {
        throw new HttpException(
          this.payload(false, null, null, info),
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const row = await this.prisma.activityEvent.findFirst({
        where: { source: 'openclaw' },
        orderBy: { ts: 'desc' },
        select: { ts: true },
      });
      return this.payload(
        true,
        row?.ts ? row.ts.toISOString() : null,
        await this.openclawVersion(),
        info,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException(
        this.payload(false, null, null, info),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async openclawVersion(): Promise<string | null> {
    try {
      const row = await this.prisma.setting.findUnique({
        where: { id: SETTING_ID },
        select: { openclawVersion: true },
      });
      const version = row?.openclawVersion?.trim() ?? '';
      return version || null;
    } catch {
      return null;
    }
  }

  private payload(
    dbUp: boolean,
    lastIngestAt: string | null,
    openclawVersion: string | null,
    info: BuildInfo,
  ): HealthBody {
    return {
      service: 'mission-control',
      db: dbUp ? 'up' : 'down',
      status: dbUp ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      connectedClients: this.gateway.clientCount,
      database: dbUp ? 'connected' : 'unavailable',
      lastIngestAt,
      version: info.version,
      gitSha: info.gitSha,
      openclawVersion,
      ts: Date.now(),
    };
  }
}
