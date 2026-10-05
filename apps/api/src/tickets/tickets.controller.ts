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
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { KeyedMutex } from './keyed-mutex';
import {
  CREATE_STATUSES,
  DEFAULT_CREATE_STATUS,
  TICKET_STATUSES,
  isCreateStatus,
  isTicketStatus,
} from './ticket-status';

/** Body accepted by POST /tickets. Everything is optional at the type level
 *  because it arrives as untrusted JSON — validation happens in the handler. */
interface CreateTicketBody {
  title?: unknown;
  priority?: unknown;
  assignee?: unknown;
  tags?: unknown;
  /** Only `backlog` or `todo` (CREATE_STATUSES). Omitted → DEFAULT_CREATE_STATUS. */
  status?: unknown;
}

/** Body accepted by PATCH /tickets/:id (partial update). */
interface UpdateTicketBody {
  status?: unknown;
  assignee?: unknown;
  priority?: unknown;
}

/**
 * TicketsController — Kanban + Backlog backend.
 *  - GET   /tickets?status=  → board columns (todo|build|qa|review|done) or backlog
 *  - POST  /tickets          → create (status ∈ CREATE_STATUSES, default DEFAULT_CREATE_STATUS)
 *  - PATCH /tickets/:id      → move / update (any TICKET_STATUSES value)
 *
 * Error contract (QA finding E on PR #20): failures are REAL HTTP errors via
 * Nest's HttpExceptions — never a 200/201 carrying `{ error }`:
 *  - 400 BadRequestException → missing/invalid title, unknown status, bad types
 *  - 404 NotFoundException   → PATCH for an id that does not exist
 * Nest serializes these as `{ statusCode, message, error }`, which the web
 * `apiSend` helper reads to surface a human message.
 */
@Controller('tickets')
export class TicketsController {
  /**
   * Per-ticket FIFO write queue (QA finding B). Every PATCH for a given id
   * runs strictly after the previous one finished, in the order the requests
   * were received — so the last-received move is the one that persists.
   * Controllers are singletons in Nest, so one queue serves the whole process.
   */
  private readonly writes = new KeyedMutex();

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
  @HttpCode(201)
  async create(@Body() body: CreateTicketBody) {
    // ── title: required, non-blank string ────────────────────────────────
    // Previously a missing title returned 201 + { error } (finding E), which
    // the web helper treated as success. Now it is a real 400.
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      throw new BadRequestException('title is required');
    }

    // ── status: optional, but if present must be a create-time status ────
    // Finding C: the old code silently coerced anything unknown (e.g. `done`)
    // to `todo` even though its comment claimed such values were rejected.
    // Now: omitted (undefined/null) → DEFAULT_CREATE_STATUS; anything else
    // must be exactly one of CREATE_STATUSES (after trimming) or we 400.
    // Mid-pipeline statuses are only reachable through PATCH moves.
    const status = this.resolveCreateStatus(body?.status);

    // ── optional fields: type-check so junk cannot reach Prisma (→ 500) ──
    const priority = this.optionalString(body?.priority, 'priority') ?? 'med';
    const assignee =
      this.optionalString(body?.assignee, 'assignee') ?? 'Jarvis Singh';
    const tags = this.optionalStringArray(body?.tags, 'tags') ?? [];

    const count = await this.prisma.ticket.count();
    const ticket = await this.prisma.ticket.create({
      data: {
        title,
        key: `MC-${150 + count}`,
        priority,
        assignee,
        tags,
        status,
      },
    });
    await this.persist('run.queued', {
      name: `ticket ${ticket.key}`,
      ticket: ticket.key,
    });
    this.gateway.broadcast('run.queued', {
      name: `ticket ${ticket.key}`,
      ticket: ticket.key,
    });
    return { ticket, ts: Date.now() };
  }

  /**
   * Move a ticket through the pipeline (backlog → todo → build → qa → review
   * → done, plus the "↺" moves back) or update assignee/priority.
   *
   * Concurrency (finding B — "last write wins, UI matches server on refresh"):
   *  1. Validate synchronously (cheap 400s never wait in the queue).
   *  2. Enter the per-ticket FIFO queue SYNCHRONOUSLY — there is no `await`
   *     before `this.writes.run(...)`, so queue order == receive order.
   *  3. Inside the queue, run a transaction that row-locks the ticket with
   *     `SELECT … FOR UPDATE` before writing. That covers writers outside
   *     this process (other api replicas, psql) without any schema change.
   *  4. Only the fields the caller sent are written — no read-modify-write of
   *     assignee/priority from a possibly stale read.
   *  5. The response carries the committed row, and the web UI applies it /
   *     refetches, so a browser refresh never disagrees with what it shows.
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateTicketBody) {
    // NB: `async` is fine for ordering — an async function runs synchronously
    // up to its first `await`, and there is none before `writes.run(...)`.
    // It also turns validation throws into rejected promises (uniform for
    // callers/tests); Nest maps both to the same HTTP response.
    const data = this.validateUpdate(body);
    return this.writes.run(id, () => this.applyUpdate(id, data));
  }

  /** The serialized part of PATCH — only ever runs one-at-a-time per id. */
  private async applyUpdate(
    id: string,
    data: { status?: string; assignee?: string; priority?: string },
  ) {
    const ticket = await this.prisma.$transaction(async (tx) => {
      // Row lock: blocks any other transaction that wants this row until we
      // commit. Table/column names are quoted because Prisma created them
      // with PascalCase ("Ticket"). `${id}` is a bound parameter (tagged
      // template), not string concatenation — safe from SQL injection.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        // Finding E: this used to be a 200 { error }. Throwing inside the
        // transaction rolls it back and Prisma rethrows our exception as-is.
        throw new NotFoundException(`ticket ${id} not found`);
      }
      return tx.ticket.update({ where: { id }, data });
    });

    const label = data.status
      ? `ticket ${ticket.key} → ${ticket.status}`
      : `ticket ${ticket.key} updated`;
    await this.persist('run.progress', { name: label, ticket: ticket.key });
    this.gateway.broadcast('run.progress', { name: label, ticket: ticket.key });
    return { ticket, ts: Date.now() };
  }

  /**
   * Validate a PATCH body and return only the fields to write.
   * Finding D: `{ status: "banana" }` used to save and make the card vanish
   * from every column; unknown statuses are now a 400.
   */
  private validateUpdate(body: UpdateTicketBody): {
    status?: string;
    assignee?: string;
    priority?: string;
  } {
    const data: { status?: string; assignee?: string; priority?: string } = {};

    if (body?.status !== undefined && body?.status !== null) {
      const status = typeof body.status === 'string' ? body.status.trim() : '';
      if (!isTicketStatus(status)) {
        throw new BadRequestException(
          `invalid status ${JSON.stringify(body.status)} — expected one of: ${TICKET_STATUSES.join(', ')}`,
        );
      }
      data.status = status;
    }
    const assignee = this.optionalString(body?.assignee, 'assignee');
    if (assignee !== undefined) data.assignee = assignee;
    const priority = this.optionalString(body?.priority, 'priority');
    if (priority !== undefined) data.priority = priority;

    // An empty/irrelevant body would be a silent no-op 200 — make it explicit.
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'nothing to update — send status, assignee and/or priority',
      );
    }
    return data;
  }

  /** Resolve POST's status: omitted → default; otherwise must be a create status. */
  private resolveCreateStatus(raw: unknown): string {
    if (raw === undefined || raw === null) return DEFAULT_CREATE_STATUS;
    const status = typeof raw === 'string' ? raw.trim() : '';
    if (!isCreateStatus(status)) {
      throw new BadRequestException(
        `invalid create status ${JSON.stringify(raw)} — new tickets may only start in: ${CREATE_STATUSES.join(', ')}`,
      );
    }
    return status;
  }

  /** undefined/null → undefined; string → string; anything else → 400. */
  private optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }
    return value;
  }

  /** undefined/null → undefined; string[] → string[]; anything else → 400. */
  private optionalStringArray(
    value: unknown,
    field: string,
  ): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      throw new BadRequestException(`${field} must be an array of strings`);
    }
    return value; // narrowed by the checks above
  }

  /** Write a run.* event to the persisted activity stream. */
  private async persist(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: { type, payload: payload as object, source: 'api' },
      });
    } catch {
      // best-effort — never fail the transition over persistence
    }
  }
}
