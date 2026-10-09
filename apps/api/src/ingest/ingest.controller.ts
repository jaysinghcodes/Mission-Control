import { Body, Controller, HttpCode, HttpException, HttpStatus, Post } from '@nestjs/common';
import { LiveActivityGateway, ActivityEventType } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotsService } from '../snapshots/snapshots.service';

/**
 * IngestController — external event intake for the live feed.
 *
 * This is the door OpenClaw (and any other trusted producer) uses to push
 * real activity into the dashboard: producers POST a typed event, the
 * gateway broadcasts it to every connected client over Socket.IO, and the
 * event is PERSISTED so pages can load history (v2).
 *
 * Auth lives in WriteAuthMiddleware, the same check as every other write.
 * Send header `x-ingest-token` when INGEST_TOKEN is set. This controller
 * only validates the event. Event `type` is a fixed list, so producers
 * cannot invent arbitrary event names.
 */
@Controller('events')
export class IngestController {
  constructor(
    private readonly gateway: LiveActivityGateway,
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotsService,
  ) {}

  /**
   * POST /events — accept one activity event, persist it, broadcast it.
   * Body: { type: ActivityEventType, payload?: Record<string, unknown> }
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Body() body: { type?: string; payload?: Record<string, unknown> },
  ) {
    const type = body?.type;
    if (!type || !this.isKnownType(type)) {
      throw new HttpException(
        `unknown event type "${type ?? '(missing)'}" — allowed: ${KNOWN_TYPES.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const payload = body.payload ?? {};
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new HttpException('payload must be a JSON object', HttpStatus.BAD_REQUEST);
    }

    // Persist for history (Activity page loads recent events on mount).
    await this.prisma.activityEvent.create({
      data: { type, payload: payload as object, source: 'openclaw' },
    });

    // Snapshot events sync tables instead of just broadcasting.
    await this.applySnapshot(type, payload);

    this.gateway.broadcast(type, { ...payload, source: 'openclaw' });
    return { accepted: true, type, ts: Date.now() };
  }

  /** Route snapshot events to their table sync handlers. */
  private async applySnapshot(type: ActivityEventType, payload: Record<string, unknown>): Promise<void> {
    switch (type) {
      case 'agents.snapshot':
        await this.snapshots.applyAgents(payload);
        break;
      case 'sessions.snapshot':
        await this.snapshots.applySessions(payload);
        break;
      case 'calendar.snapshot':
        await this.snapshots.applyCalendar(payload);
        break;
      case 'usage.snapshot':
        await this.snapshots.applyUsage(payload);
        break;
      case 'approvals.snapshot':
        await this.snapshots.applyApprovals(payload);
        break;
      case 'memory.snapshot':
        await this.snapshots.applyMemory(payload);
        break;
      default:
        break;
    }
  }

  private isKnownType(type: string): type is ActivityEventType {
    return KNOWN_TYPES.includes(type as ActivityEventType);
  }
}

/** Single source of truth for accepted event names (mirrors the gateway union). */
const KNOWN_TYPES: ActivityEventType[] = [
  'run.started',
  'run.queued',
  'run.running',
  'run.progress',
  'run.completed',
  'run.done',
  'run.failed',
  'health.tick',
  'hello',
  'message.sent',
  'message.received',
  'session.patch',
  'command.new',
  'approval.new',
  'approval.decided',
  'agents.snapshot',
  'sessions.snapshot',
  'calendar.snapshot',
  'usage.snapshot',
  'approvals.snapshot',
  'memory.snapshot',
];
