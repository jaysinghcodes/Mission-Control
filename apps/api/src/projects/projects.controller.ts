import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { projectNameKey } from './project-name';

/**
 * ProjectsController — ticket 4.
 *
 *  - GET   /projects?archived=active|only|all  → list (default: active only)
 *  - GET   /projects/:id                       → one project + its tickets
 *  - POST  /projects                           → create (201)
 *  - PATCH /projects/:id                       → rename and/or archive
 *
 * There is no DELETE. Archiving sets `archivedAt` and hides the project
 * from the default list; its tickets keep `projectId`. That is the whole
 * point of archive vs delete.
 *
 * Error contract — same rule as TicketsController (QA finding E): failures
 * are real HTTP errors, never a 200/201 body with `{ error }`.
 *  - 400 blank/invalid name, bad `archived` flag, empty PATCH
 *  - 404 unknown id
 *  - 409 duplicate name (case-insensitive)
 *
 * Writes are last-write-wins: there is no version column. Two renames of
 * the same project both commit; the later one is what a refresh shows.
 * The unique index on `nameKey` is what stops two projects from landing
 * on the same name when their requests overlap — the loser gets 409, not
 * a second row.
 */

/** How long a project name may be. Long enough for a label, short enough
 *  that the list row stays one line. Enforced here, not in the schema, so
 *  the failure is a 400 with a message. */
const NAME_MAX = 80;

interface CreateProjectBody {
  name?: unknown;
}

interface UpdateProjectBody {
  name?: unknown;
  /** true = archive (hide from the default list). false = unarchive. */
  archived?: unknown;
}

/** What the web app is allowed to see. `nameKey` stays server-side. */
interface ProjectJson {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ticketCount: number;
  doneCount: number;
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Default list is active projects only (`archivedAt` is null).
   *  - `archived=only` → the archived ones (the UI's "Show archived")
   *  - `archived=all`  → both
   * Anything else is a 400, so a typo cannot silently look like "no projects".
   */
  @Get()
  async list(@Query('archived') archived?: string) {
    const where = this.archiveWhere(archived);
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tickets: true } } },
    });
    const doneByProject = await this.doneCounts(projects.map((p) => p.id));
    return {
      projects: projects.map((p) =>
        this.toJson(p, p._count.tickets, doneByProject.get(p.id) ?? 0),
      ),
      ts: Date.now(),
    };
  }

  /** One project and every ticket on it. Works for archived projects too
   *  (a direct link must not 404 just because the list hides the row). */
  @Get(':id')
  async get(@Param('id') id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        tickets: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            key: true,
            title: true,
            status: true,
            priority: true,
            assignee: true,
            createdAt: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException(`project ${id} not found`);
    const { tickets, ...rest } = project;
    const done = tickets.filter((t) => t.status === 'done').length;
    return {
      project: this.toJson(rest, tickets.length, done),
      tickets,
      ts: Date.now(),
    };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: CreateProjectBody) {
    const name = this.normalizeName(body?.name);
    const nameKey = projectNameKey(name);
    await this.assertNameAvailable(nameKey);
    try {
      const project = await this.prisma.project.create({
        data: { name, nameKey },
      });
      return { project: this.toJson(project, 0, 0), ts: Date.now() };
    } catch (err) {
      // Lost a race with another create of the same name. The unique index
      // rejected the row; answer 409, never 201 and never 500.
      throw this.nameConflictOrRethrow(err, name);
    }
  }

  /**
   * Rename (`name`) and/or archive (`archived: true|false`).
   * Omitted fields are left alone — same partial-update rule as PATCH /tickets.
   * An empty body is 400, not a silent 200.
   */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProjectBody) {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`project ${id} not found`);

    const data: { name?: string; nameKey?: string; archivedAt?: Date | null } =
      {};

    // `undefined` (field absent) means "don't touch the name". A present
    // name — even "" — is validated, so a blank rename is 400.
    if (body?.name !== undefined) {
      const name = this.normalizeName(body.name);
      const nameKey = projectNameKey(name);
      if (nameKey !== existing.nameKey) {
        await this.assertNameAvailable(nameKey);
      }
      data.name = name;
      data.nameKey = nameKey;
    }

    if (body?.archived !== undefined) {
      if (typeof body.archived !== 'boolean') {
        throw new BadRequestException('archived must be a boolean');
      }
      // Re-archiving keeps the original timestamp so a double-click does
      // not look like a new archive. Unarchive clears it.
      data.archivedAt = body.archived ? (existing.archivedAt ?? new Date()) : null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'nothing to update — send name and/or archived',
      );
    }

    try {
      const project = await this.prisma.project.update({ where: { id }, data });
      const [ticketCount, doneCount] = await Promise.all([
        this.prisma.ticket.count({ where: { projectId: id } }),
        this.prisma.ticket.count({ where: { projectId: id, status: 'done' } }),
      ]);
      return { project: this.toJson(project, ticketCount, doneCount), ts: Date.now() };
    } catch (err) {
      throw this.nameConflictOrRethrow(err, data.name ?? existing.name);
    }
  }

  /** Active-only unless the caller asks otherwise. See list(). */
  private archiveWhere(raw: string | undefined): {
    archivedAt?: null | { not: null };
  } {
    const value = (raw ?? '').trim() || 'active';
    if (value === 'active') return { archivedAt: null };
    if (value === 'only') return { archivedAt: { not: null } };
    if (value === 'all') return {};
    throw new BadRequestException(
      `invalid archived filter ${JSON.stringify(raw)} — expected active, only, or all`,
    );
  }

  /** Done tickets per project. One grouped query, not one query per row.
   *  "Done" is the canonical status only (`inprogress` is not done). */
  private async doneCounts(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) return map;
    const groups = await this.prisma.ticket.groupBy({
      by: ['projectId'],
      where: { status: 'done', projectId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (g.projectId) map.set(g.projectId, g._count._all);
    }
    return map;
  }

  /** Trim, reject blank, reject over-long. Returns the stored display name. */
  private normalizeName(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new BadRequestException('name is required');
    }
    const name = raw.trim();
    if (!name) throw new BadRequestException('name is required');
    if (name.length > NAME_MAX) {
      throw new BadRequestException(`name must be ${NAME_MAX} characters or fewer`);
    }
    return name;
  }

  /**
   * Friendly 409 before we hit the database. The unique index is still the
   * backstop (see create/update catch) for two requests that both pass
   * this check before either inserts.
   */
  private async assertNameAvailable(nameKey: string): Promise<void> {
    const clash = await this.prisma.project.findUnique({ where: { nameKey } });
    if (clash) {
      throw new ConflictException(
        `a project named "${clash.name}" already exists`,
      );
    }
  }

  /** Prisma P2002 (unique violation) → 409. Every other error propagates. */
  private nameConflictOrRethrow(err: unknown, name: string): Error {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 'P2002'
    ) {
      return new ConflictException(`a project named "${name}" already exists`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  /** Strip `nameKey` so clients rename through `name` only. */
  private toJson(
    project: {
      id: string;
      name: string;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    ticketCount: number,
    doneCount: number,
  ): ProjectJson {
    return {
      id: project.id,
      name: project.name,
      archivedAt: project.archivedAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      ticketCount,
      doneCount,
    };
  }
}
