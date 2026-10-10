import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { operatorName } from '../config/operator';
import { isRunStatus, RUN_STATUSES } from './run-status';

/** Stored run name, in Unicode code points. Longer input is 400 and the message names `name`. */
const NAME_MAX = 200;

/** Stored run agent, in Unicode code points. Longer input is 400 and the message names `agent`. */
const AGENT_MAX = 100;

/** One emoji is one character. `String.length` would count it as two UTF-16 units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** POST /runs fields. `status` is not one of them: create always queues. */
const CREATE_FIELDS = new Set(['name', 'agent', 'ticketId']);

/** PATCH /runs/:id fields. Anything else, including `name`, is 400. */
const UPDATE_FIELDS = new Set(['status', 'progress', 'agent', 'ticketId']);

/**
 * RunsController — task rows the board and the bridge share.
 *  - GET /runs              → list (optional ?status= and ?ticketId=)
 *  - POST /runs             → 201 { run, ts }. Missing name is 400. Unknown ticketId is 404.
 *  - PATCH /runs/:id        → 200 { run, ts }. Unknown run or ticketId is 404.
 * Success bodies have no `error` key. Failures throw, so they are not HTTP 200.
 * A real change broadcasts a run.* event so open dashboards update live.
 * A PATCH that changes nothing returns the same run and writes no activity event.
 * Unknown fields are 400 and are not stored.
 */
@Controller('runs')
export class RunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('ticketId') ticketId?: string,
  ) {
    const where: { status?: string; ticketId?: string } = {};
    if (typeof status === 'string' && status.trim())
      where.status = status.trim();
    if (typeof ticketId === 'string' && ticketId.trim())
      where.ticketId = ticketId.trim();
    const runs = await this.prisma.run.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { runs, ts: Date.now() };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown = {}) {
    const payload = this.payload(body);
    this.rejectUnknown(payload, CREATE_FIELDS);
    const name = this.requireName(payload.name);
    const agent =
      'agent' in payload ? this.requireAgent(payload.agent) : operatorName();
    const ticketId =
      'ticketId' in payload ? await this.resolveTicket(payload.ticketId) : null;
    const run = await this.prisma.run.create({
      // Default agent = the configured operator (OPERATOR_NAME env, neutral
      // "Operator" fallback). No personal name baked into a fresh clone.
      data: {
        name,
        agent,
        status: 'queued',
        ...(ticketId ? { ticketId } : {}),
      },
    });
    const event = {
      id: run.id,
      name: run.name,
      ...(run.ticketId ? { ticketId: run.ticketId } : {}),
    };
    await this.persist('run.queued', event);
    this.gateway.broadcast('run.queued', event);
    return { run, ts: Date.now() };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown = {}) {
    const payload = this.payload(body);
    // Shape checks first so a bad field is 400 even when the id is also wrong.
    this.rejectUnknown(payload, UPDATE_FIELDS);
    const status = this.parseStatus(payload.status, 'status' in payload);
    const progress = this.parseProgress(
      payload.progress,
      'progress' in payload,
    );
    const agent = this.parseAgent(payload.agent, 'agent' in payload);
    const ticketRaw = 'ticketId' in payload ? payload.ticketId : undefined;

    const existing = await this.prisma.run.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('run not found');
    }
    const ticketId =
      ticketRaw !== undefined ? await this.resolveTicket(ticketRaw) : undefined;
    const nextStatus = status ?? existing.status;
    const nextAgent = agent ?? existing.agent;
    const nextProgress = progress ?? existing.progress;
    const nextTicketId = ticketId !== undefined ? ticketId : existing.ticketId;
    // Same values are a no-op: 200 with the row already stored, and no
    // activity event. A repeat click must not look like a new transition.
    if (
      nextStatus === existing.status &&
      nextAgent === existing.agent &&
      nextProgress === existing.progress &&
      nextTicketId === existing.ticketId
    ) {
      return { run: existing, ts: Date.now() };
    }
    const run = await this.prisma.run.update({
      where: { id },
      data: {
        status: nextStatus,
        agent: nextAgent,
        progress: nextProgress,
        startedAt:
          nextStatus === 'running' && !existing.startedAt
            ? new Date()
            : existing.startedAt,
        finishedAt: ['done', 'failed'].includes(nextStatus) ? new Date() : null,
        ...(ticketId !== undefined ? { ticketId } : {}),
      },
    });
    // Broadcast the transition so every open dashboard updates instantly.
    const eventType =
      nextStatus === 'running'
        ? 'run.started'
        : nextStatus === 'done'
          ? 'run.completed'
          : nextStatus === 'failed'
            ? 'run.failed'
            : 'run.queued';
    const event = {
      id: run.id,
      name: run.name,
      status: nextStatus,
      progress: run.progress,
      ...(run.ticketId ? { ticketId: run.ticketId } : {}),
    };
    // Persist too. The Activity page and Office build log load history from
    // the DB, so a run that moves fast must still leave a visible trail.
    await this.persist(eventType, event);
    this.gateway.broadcast(eventType, event);
    return { run, ts: Date.now() };
  }

  private payload(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  }

  /** A key this route does not accept is 400. The message names the field. */
  private rejectUnknown(
    body: Record<string, unknown>,
    allowed: ReadonlySet<string>,
  ): void {
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length === 0) return;
    const label = unknown.length === 1 ? 'unknown field' : 'unknown fields';
    throw new BadRequestException(`${label} ${unknown.join(', ')}`);
  }

  /** Missing or blank is 400. A non string is 400. The message names `name`. */
  private requireName(raw: unknown): string {
    if (typeof raw !== 'string') {
      if (raw === undefined || raw === null)
        throw new BadRequestException('name is required');
      throw new BadRequestException('name must be a string');
    }
    const name = raw.trim();
    if (!name) throw new BadRequestException('name is required');
    if (codePointLength(name) > NAME_MAX) {
      throw new BadRequestException(
        `name must be ${NAME_MAX} characters or fewer`,
      );
    }
    return name;
  }

  /** Present agent must be a non blank string. The message names `agent`. */
  private requireAgent(raw: unknown): string {
    return this.parseAgent(raw, true) as string;
  }

  private parseAgent(raw: unknown, present: boolean): string | undefined {
    if (!present) return undefined;
    if (typeof raw !== 'string')
      throw new BadRequestException('agent must be a string');
    const agent = raw.trim();
    if (!agent) throw new BadRequestException('agent is required');
    if (codePointLength(agent) > AGENT_MAX) {
      throw new BadRequestException(
        `agent must be ${AGENT_MAX} characters or fewer`,
      );
    }
    return agent;
  }

  private parseStatus(raw: unknown, present: boolean): string | undefined {
    if (!present) return undefined;
    if (typeof raw !== 'string')
      throw new BadRequestException('status must be a string');
    const status = raw.trim();
    if (!isRunStatus(status)) {
      throw new BadRequestException(
        `status must be one of ${RUN_STATUSES.join(', ')}`,
      );
    }
    return status;
  }

  private parseProgress(raw: unknown, present: boolean): number | undefined {
    if (!present) return undefined;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      throw new BadRequestException('progress must be an integer');
    }
    if (raw < 0 || raw > 100)
      throw new BadRequestException('progress must be from 0 to 100');
    return raw;
  }

  /**
   * Blank or null means no link. An unknown id is 404 and names `ticketId`.
   * A non string is 400 and names `ticketId`.
   */
  private async resolveTicket(raw: unknown): Promise<string | null> {
    if (raw === null) return null;
    if (typeof raw !== 'string')
      throw new BadRequestException('ticketId must be a string or null');
    const id = raw.trim();
    if (!id) return null;
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('ticketId not found');
    return id;
  }

  /** Write a run.* event to the persisted activity stream. */
  private async persist(
    type: string,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: { type, payload, source: 'api' },
      });
    } catch {
      // Persistence is best-effort. Never fail a state transition over it.
    }
  }
}
