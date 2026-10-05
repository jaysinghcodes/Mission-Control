import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TicketsController — Kanban + Backlog backend.
 *  - GET /tickets?status=  → todo|inprogress|done for the board, backlog for Backlog
 *  - POST /tickets         → create from the UI (status: todo|backlog; default todo)
 *  - PATCH /tickets/:id     → move / update (kanban pipeline)
 */
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { tickets, ts: Date.now() };
  }

  @Post()
  async create(
    @Body()
    body: {
      title?: string;
      priority?: string;
      assignee?: string;
      tags?: string[];
      /** Only `todo` (kanban) or `backlog` (Backlog page) on create — pipeline
       *  statuses (build/qa/…) are reached via PATCH, not inventable here. */
      status?: string;
    },
  ) {
    const title = body?.title?.trim();
    if (!title) {
      return { error: 'title is required' };
    }
    // Whitelist create-time statuses so Backlog can land on /backlog while the
    // kanban "+ New ticket" CTA (no status) still defaults to To-Do. Rejecting
    // unknown values avoids accidentally creating cards mid-pipeline.
    // Schema default is `backlog`, but the product default for an omitted
    // status stays `todo` — that matches ONBOARDING Step 8 ("create → To-Do")
    // and keeps Tickets.tsx unchanged.
    const allowedCreateStatus = new Set(['todo', 'backlog']);
    const requested = body.status?.trim();
    const status =
      requested && allowedCreateStatus.has(requested) ? requested : 'todo';
    const count = await this.prisma.ticket.count();
    const ticket = await this.prisma.ticket.create({
      data: {
        title,
        key: `MC-${150 + count}`,
        priority: body.priority ?? 'med',
        assignee: body.assignee ?? 'Jarvis Singh',
        tags: body.tags ?? [],
        status,
      },
    });
    await this.persist('run.queued', { name: `ticket ${ticket.key}`, ticket: ticket.key });
    this.gateway.broadcast('run.queued', { name: `ticket ${ticket.key}`, ticket: ticket.key });
    return { ticket, ts: Date.now() };
  }

  /** Move a ticket through the pipeline: todo → inprogress → done (Jay fix #9). */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { status?: string; assignee?: string; priority?: string },
  ) {
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'ticket not found' };
    }
    const status = body.status ?? existing.status;
    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: {
        status,
        assignee: body.assignee ?? existing.assignee,
        priority: body.priority ?? existing.priority,
      },
    });
    await this.persist('run.progress', { name: `ticket ${ticket.key} → ${status}`, ticket: ticket.key });
    this.gateway.broadcast('run.progress', { name: `ticket ${ticket.key} → ${status}`, ticket: ticket.key });
    return { ticket, ts: Date.now() };
  }

  /** Write a run.* event to the persisted activity stream. */
  private async persist(type: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.activityEvent.create({ data: { type, payload: payload as object, source: 'api' } });
    } catch {
      // best-effort — never fail the transition over persistence
    }
  }
}
