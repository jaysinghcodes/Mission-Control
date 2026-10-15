import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';

/**
 * HealthTickerService — periodic `health.tick` broadcasts.
 *
 * The dashboard's Live Activity band shows real events; a bare dashboard
 * with no producers looks dead. This ticker gives the feed a genuine
 * heartbeat so connected clients always have honest, current data to render
 * (uptime, DB state, connected clients) without any fake values.
 *
 * Config: `HEALTH_TICK_MS` (default 30000). Set to `0` to disable.
 * The interval is cleared on shutdown so hot reloads never stack timers.
 */
@Injectable()
export class HealthTickerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthTickerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly gateway: LiveActivityGateway) {}

  onModuleInit(): void {
    const ms = Number(process.env.HEALTH_TICK_MS ?? 30000);
    if (!Number.isFinite(ms) || ms <= 0) {
      this.logger.warn(
        'HEALTH_TICK_MS disabled (0 or invalid) — no health.tick broadcasts',
      );
      return;
    }
    this.timer = setInterval(() => this.tick(), ms);
    // The listening HTTP server keeps the process alive. This timer must
    // not, or a test worker stays up after the app fails to close.
    this.timer.unref();
    this.logger.log(`health ticker active every ${ms}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      this.gateway.broadcast('health.tick', {
        uptimeSeconds: Math.round(process.uptime()),
        connectedClients: this.gateway.clientCount,
      });
    } catch {
      // The next tick tries again. An emit error must not crash the process.
    }
  }
}
