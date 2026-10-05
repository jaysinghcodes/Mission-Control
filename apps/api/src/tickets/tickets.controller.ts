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
import { operatorName } from '../config/operator';
import { KeyedMutex } from './keyed-mutex';
import {
  CREATE_STATUSES,
  DEFAULT_CREATE_STATUS,
  TICKET_STATUSES,
  isCreateStatus,
  isTicketStatus,
} from './ticket-status';

/**
 * Name of the Postgres advisory lock that serializes ticket-key allocation
 * (QA-1 #5). Hashed with `hashtext()` in SQL, so any other writer that wants
 * to mint MC-<n> keys safely just has to take the same named lock.
 */
const TICKET_KEY_LOCK = 'mission-control:ticket-key';

/** First number handed out on an empty board — matches the old `150 + 0`. */
const FIRST_TICKET_NUMBER = 150;

/** Body accepted by POST /tickets. Everything is optional at the type level
 *  because it arrives as untrusted JSON — validation happens in the handler. */
interface CreateTicketBody {
  title?: unknown;
  priority?: unknown;
  assignee?: unknown;
  tags?: unknown;
  /** Only `backlog` or `todo` (CREATE_STATUSES). Omitted → DEFAULT_CREATE_STATUS. */
  status?: unknown;
  /** Omit or null → no project. A string must be an active project's id. */
  projectId?: unknown;
}

/** Body accepted by PATCH /tickets/:id (partial update). */
interface UpdateTicketBody {
  status?: unknown;
  assignee?: unknown;
  priority?: unknown;
  /** string → move to that project. null → unassign. Omit → leave it. */
  projectId?: unknown;
}

/** Fields a PATCH may write. projectId null means "clear the project". */
interface TicketPatch {
  status?: string;
  assignee?: string;
  priority?: string;
  projectId?: string | null;
}

/**
 * TicketsController — Kanban + Backlog backend.
 *  - GET   /tickets?status=&projectId=  → board, optionally one project
 *  - POST  /tickets                     → create (status ∈ CREATE_STATUSES, default DEFAULT_CREATE_STATUS)
 *  - PATCH /tickets/:id                 → move / update (any TICKET_STATUSES value, optional projectId)
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
   * Controllers are singletons in Nest, so one queue serves the whole process
   * (in-process only: fine for today's single api container; multi-instance
   * deployments would need a DB-level lock — see keyed-mutex.ts).
   */
  private readonly writes = new KeyedMutex();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  /**
   * `status` filters one column (the Backlog page sends `backlog`).
   * `projectId` filters to one project. `projectId=none` is the unassigned
   * tickets. An unknown project id is an EMPTY list, not a 404: this is a
   * filter, and a project that was just archived should not crash the board.
   */
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
  ) {
    const where: { status?: string; projectId?: string | null } = {};
    if (status) where.status = status;
    if (projectId === 'none') where.projectId = null;
    else if (projectId) where.projectId = projectId;
    const tickets = await this.prisma.ticket.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
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
    // Default assignee = the configured operator (OPERATOR_NAME env, neutral
    // "Operator" fallback). Previously hardcoded to the original author's
    // agent name, which leaked into every fresh clone (ticket 3).
    const assignee =
      this.optionalString(body?.assignee, 'assignee') ?? operatorName();
    const tags = this.optionalStringArray(body?.tags, 'tags') ?? [];
    // Omit and explicit null both mean "create with no project". A string
    // is checked inside the insert transaction (see lockAssignableProject)
    // so we never attach a ticket to a project that was archived first.
    const projectRef = this.parseProjectRef(body?.projectId);
    const projectId = projectRef.kind === 'id' ? projectRef.id : undefined;

    // ── key allocation (QA-1 #5) ─────────────────────────────────────────
    // The old code did `count()` then `create({ key: MC-${150 + count} })` as
    // two separate, unlocked round-trips. Every create that read the count
    // before any of the others committed got the SAME number — QA fired 10
    // parallel creates and got MC-306 six times. (Counting rows was also
    // wrong after deletes: count goes down, so a fresh key could collide
    // with a surviving older one.)
    //
    // Fix, without a schema change: allocate the key and insert the row in
    // ONE transaction that first takes a transaction-scoped Postgres
    // advisory lock (see allocateKeyAndCreate). Concurrent creates queue on
    // that lock, so each one sees the previous one's committed MC-N.
    const ticket = await this.allocateKeyAndCreate({
      title,
      priority,
      assignee,
      tags,
      status,
      projectId,
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
   * Insert a ticket with the next free `MC-<n>` key, race-free (QA-1 #5).
   *
   * How it works, step by step, inside ONE interactive transaction:
   *  1. `pg_advisory_xact_lock(hashtext('mission-control:ticket-key'))`
   *     — an application-level mutex that lives in Postgres, not in this
   *     Node process, so it also serializes creates coming from a second api
   *     replica, the seed script, or anything else that adopts the same
   *     lock name. `_xact_` means Postgres releases it automatically on
   *     COMMIT or ROLLBACK — no unlock call to forget, no leak on errors.
   *     `hashtext(...)` turns a readable name into the int key the function
   *     needs, so nobody has to remember a magic number.
   *  2. Read the highest existing `MC-<digits>` key (other prefixes such as
   *     the demo seed's `DEMO-1` and NULL keys are ignored) and add 1. Using
   *     MAX instead of COUNT means deleted tickets never cause a reuse.
   *  3. Insert the row and COMMIT, which releases the lock; the next waiting
   *     create then reads our key as the new maximum.
   *
   * Numbering keeps the historical starting point: an empty table (or one
   * with only non-MC keys) yields MC-150, exactly what `150 + count` gave.
   *
   * Still no DB-level guarantee: rows inserted by something that skips this
   * lock (raw psql, an old api build) could duplicate a key. The PR body
   * proposes a partial unique index on "Ticket"."key" for Jay to approve —
   * schema changes are human-reviewed, so it is deliberately not here.
   */
  private allocateKeyAndCreate(data: {
    title: string;
    priority: string;
    assignee: string;
    tags: string[];
    status: string;
    /** Set only when the caller named a project. Checked before the key lock
     *  so a 400/404 does not queue behind unrelated creates — but still
     *  inside this transaction, so the project row lock is held until the
     *  insert commits. */
    projectId?: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        if (data.projectId !== undefined) {
          await this.lockAssignableProject(tx, data.projectId);
        }
        // (1) Serialize every key allocation. `pg_advisory_xact_lock`
        // returns `void`, which $queryRaw cannot deserialize, so the call is
        // made via $executeRaw (we only need its side effect: the lock).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${TICKET_KEY_LOCK}))`;

        // (2) Highest MC-<n> currently stored. The regex both filters to our
        // key format and extracts the number; `::bigint` avoids int4
        // overflow on hand-typed huge keys. MAX over zero rows is NULL.
        const [{ max }] = await tx.$queryRaw<{ max: bigint | null }[]>`
          SELECT MAX(SUBSTRING("key" FROM '^MC-([0-9]+)$')::bigint) AS "max"
          FROM "Ticket"
          WHERE "key" ~ '^MC-[0-9]+$'`;
        const next =
          max === null || max === undefined
            ? FIRST_TICKET_NUMBER
            : Math.max(Number(max) + 1, FIRST_TICKET_NUMBER);

        // (3) Insert while still holding the lock; COMMIT releases it.
        // projectId is included only when the caller sent one, so an omitted
        // field stays NULL (the column default) rather than being forced.
        return tx.ticket.create({
          data: {
            title: data.title,
            priority: data.priority,
            assignee: data.assignee,
            tags: data.tags,
            status: data.status,
            ...(data.projectId !== undefined
              ? { projectId: data.projectId }
              : {}),
            key: `MC-${next}`,
          },
        });
      },
      {
        // Creates now queue behind each other on the lock. Prisma's default
        // interactive-transaction budget (2 s to get a connection, 5 s to
        // finish) is generous for one insert, but a burst of parallel
        // creates waits in line — give the tail of the queue some headroom
        // instead of failing a perfectly valid create with a 500.
        maxWait: 10_000,
        timeout: 10_000,
      },
    );
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
   *     `SELECT … FOR UPDATE` before writing. That stops writers outside this
   *     process (psql, a second replica) interleaving with us mid-write, but
   *     it does NOT order them by receive time.
   *     ⚠ The ordering guarantee is IN-PROCESS: correct for the single api
   *     instance docker-compose runs. Running several api instances would
   *     need a DB-level ordering lock (advisory lock / version column) —
   *     see keyed-mutex.ts "Scope / limits".
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
  private async applyUpdate(id: string, data: TicketPatch) {
    const { ticket, changed } = await this.prisma.$transaction(async (tx) => {
      // Row lock: blocks any other transaction that wants this row until we
      // commit. Table/column names are quoted because Prisma created them
      // with PascalCase ("Ticket"). `${id}` is a bound parameter (tagged
      // template), not string concatenation — safe from SQL injection.
      // QA-1 #3: we also read the CURRENT values under the lock so we can
      // tell a real change from a repeat of what is already stored.
      // projectId is in the same SELECT so "assign the project it already
      // has" is a no-op (no second activity event), same as a repeated move.
      const locked = await tx.$queryRaw<
        {
          id: string;
          status: string;
          assignee: string | null;
          priority: string;
          projectId: string | null;
        }[]
      >`
        SELECT "id", "status", "assignee", "priority", "projectId"
        FROM "Ticket" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) {
        // Finding E: this used to be a 200 { error }. Throwing inside the
        // transaction rolls it back and Prisma rethrows our exception as-is.
        throw new NotFoundException(`ticket ${id} not found`);
      }
      // Assigning to a project locks THAT row too, before we write. If it
      // was archived (or never existed) we throw and the ticket lock rolls
      // back — the previous projectId stays. Unassign (null) skips this.
      if (typeof data.projectId === 'string') {
        await this.lockAssignableProject(tx, data.projectId);
      }
      const before = locked[0];
      // A field counts as changed only if it was SENT and differs from the
      // locked (i.e. current, committed) value.
      const changed = (Object.keys(data) as (keyof typeof data)[]).some(
        (field) => data[field] !== before[field],
      );
      // The write itself is still issued even for a no-op (cheap, and it
      // returns the full committed row for the response in one place).
      const row = await tx.ticket.update({ where: { id }, data });
      return { ticket: row, changed };
    });

    // QA-1 #3: a double-clicked "▶ Start" sends two identical PATCHes. The
    // per-ticket queue runs them one after the other, so the second one finds
    // the ticket ALREADY in `build`. It still answers 200 with the row
    // (idempotent PUT-like semantics — the client's intent is satisfied), but
    // it must not persist/broadcast a second `run.progress` "→ build" event:
    // nothing happened, and the activity feed should only show real moves.
    if (!changed) return { ticket, ts: Date.now() };

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
  private validateUpdate(body: UpdateTicketBody): TicketPatch {
    const data: TicketPatch = {};

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

    // projectId is special: null is a real write (unassign), a string is a
    // move, and a missing field means "leave the project alone". The
    // existence/archive check happens later, under the row lock.
    if (body && 'projectId' in body && body.projectId !== undefined) {
      const ref = this.parseProjectRef(body.projectId);
      // `undefined` was excluded above, so this is null or an id.
      data.projectId = ref.kind === 'id' ? ref.id : null;
    }

    // An empty/irrelevant body would be a silent no-op 200 — make it explicit.
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'nothing to update — send status, assignee, priority and/or projectId',
      );
    }
    return data;
  }

  /**
   * `undefined` → field was not sent. `null` → unassign. A non-blank string
   * → that id (the caller still has to prove the project exists and is
   * active). Blank strings and non-strings are 400, never coerced.
   */
  private parseProjectRef(
    raw: unknown,
  ): { kind: 'omit' } | { kind: 'none' } | { kind: 'id'; id: string } {
    if (raw === undefined) return { kind: 'omit' };
    if (raw === null) return { kind: 'none' };
    if (typeof raw !== 'string') {
      throw new BadRequestException('projectId must be a string or null');
    }
    const id = raw.trim();
    if (!id) {
      throw new BadRequestException('projectId must be a project id or null');
    }
    return { kind: 'id', id };
  }

  /**
   * Lock the project row and refuse the assignment when it is missing or
   * archived.
   *
   * Why a lock, not a plain read: archive is `UPDATE Project SET archivedAt`.
   * Without FOR UPDATE, that update can commit after we have decided the
   * project is active and before our ticket write commits — the ticket would
   * land on an archived project, which ticket 4 forbids. Holding this row
   * lock until our transaction ends makes the archive wait, and we see its
   * committed archivedAt if it got there first.
   *
   * The message names the project so the board can show it verbatim.
   */
  private async lockAssignableProject(
    tx: {
      $queryRaw: <T>(
        query: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<T>;
    },
    projectId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string; name: string; archivedAt: Date | null }[]
    >`
      SELECT "id", "name", "archivedAt"
      FROM "Project"
      WHERE "id" = ${projectId}
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new NotFoundException(`project ${projectId} not found`);
    }
    if (rows[0].archivedAt) {
      throw new BadRequestException(
        `project "${rows[0].name}" is archived — unarchive it before assigning tickets`,
      );
    }
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
