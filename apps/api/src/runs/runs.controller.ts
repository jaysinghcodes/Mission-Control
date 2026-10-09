import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { operatorName } from '../config/operator';

/**
 * RunsController — Tasks screen backend. Runs are real work items:
 *  - GET /runs          → list (filter by ?status=)
 *  - POST /runs         → create a task from the UI (queued → bridge picks it up)
 *  - PATCH /runs/:id    → status/progress transitions (bridge + UI actions)
 * Every mutation broadcasts a run.* event so open dashboards update live.
 */
@Controller('runs')
export class RunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    const runs = await this.prisma.run.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { runs, ts: Date.now() };
  }

  @Post()
  async create(@Body() body: { name?: string; agent?: string; ticketId?: string | null } = {}) {
    const name = body?.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }
    const ticketId = await this.ticketLink(body.ticketId);
    const run = await this.prisma.run.create({
      // Default agent = the configured operator (OPERATOR_NAME env, neutral
      // "Operator" fallback) — no personal name baked into a fresh clone.
      data: {
        name,
        agent: body.agent ?? operatorName(),
        status: 'queued',
        ...(ticketId ? { ticketId } : {}),
      },
    });
    await this.persist('run.queued', { id: run.id, name: run.name });
    this.gateway.broadcast('run.queued', { id: run.id, name: run.name });
    return { run, ts: Date.now() };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { status?: string; progress?: number; agent?: string; ticketId?: string | null } = {},
  ) {
    const existing = await this.prisma.run.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('run not found');
    }
    const status = body.status ?? existing.status;
    const ticketId = body.ticketId !== undefined ? await this.ticketLink(body.ticketId) : undefined;
    const run = await this.prisma.run.update({
      where: { id },
      data: {
        status,
        agent: body.agent ?? existing.agent,
        progress: body.progress ?? existing.progress,
        startedAt: status === 'running' && !existing.startedAt ? new Date() : existing.startedAt,
        finishedAt: ['done', 'failed'].includes(status) ? new Date() : null,
        ...(ticketId !== undefined ? { ticketId } : {}),
      },
    });
    // Broadcast the transition so every open dashboard updates instantly.
    const eventType =
      status === 'running'
        ? 'run.started'
        : status === 'done'
          ? 'run.completed'
          : status === 'failed'
            ? 'run.failed'
            : 'run.queued';
    const payload = { id: run.id, name: run.name, status, progress: run.progress };
    // Persist too — the Activity page / Office build log load history from the
    // DB, so a run that moves fast must still leave a visible trail (review fix #3/#6).
    await this.persist(eventType, payload);
    this.gateway.broadcast(eventType, payload);
    return { run, ts: Date.now() };
  }

  /**
   * Pipeline links a run to a ticket by id only. Blank means no link.
   * An unknown id is 400 so a typo does not create an orphan pointer.
   */
  private async ticketLink(ticketId: string | null | undefined): Promise<string | null> {
    if (ticketId == null) return null;
    const id = ticketId.trim();
    if (!id) return null;
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new BadRequestException('ticket not found');
    return id;
  }

  /** Write a run.* event to the persisted activity stream. */
  private async persist(type: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.activityEvent.create({ data: { type, payload: payload as object, source: 'api' } });
    } catch {
      // Persistence is best-effort — never fail a state transition over it.
    }
  }
}
