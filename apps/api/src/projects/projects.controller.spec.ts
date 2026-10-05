import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * ProjectsController unit tests — no database.
 *
 * The fake enforces the same nameKey uniqueness the migration's unique
 * index does, and can miss one lookup so we can prove a lost race still
 * comes back as 409 (P2002) rather than 201.
 */

type ProjectRow = {
  id: string;
  name: string;
  nameKey: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TicketRow = { id: string; projectId: string | null; status: string; title: string };

function makeFake() {
  const projects = new Map<string, ProjectRow>();
  const tickets: TicketRow[] = [];
  let nextId = 1;
  /** When > 0, the next nameKey lookup returns null (the other request
   *  has not inserted yet) and the following create raises P2002. */
  let raceMisses = 0;

  function publicProject(row: ProjectRow) {
    return row;
  }

  const project = {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where?: { archivedAt?: null | { not: null } };
      }) => {
        let list = [...projects.values()];
        if (where && Object.prototype.hasOwnProperty.call(where, 'archivedAt')) {
          const archivedAt = where.archivedAt;
          if (archivedAt === null) list = list.filter((p) => p.archivedAt === null);
          else if (archivedAt && 'not' in archivedAt) {
            list = list.filter((p) => p.archivedAt !== null);
          }
        }
        list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return list.map((p) => ({
          ...publicProject(p),
          _count: {
            tickets: tickets.filter((t) => t.projectId === p.id).length,
          },
        }));
      },
    ),
    findUnique: jest.fn(
      async ({
        where,
        include,
      }: {
        where: { id?: string; nameKey?: string };
        include?: { tickets?: unknown };
      }) => {
        if (where.nameKey !== undefined) {
          if (raceMisses > 0) {
            raceMisses -= 1;
            return null;
          }
          return (
            [...projects.values()].find((p) => p.nameKey === where.nameKey) ??
            null
          );
        }
        const row = where.id ? projects.get(where.id) : undefined;
        if (!row) return null;
        if (!include?.tickets) return { ...row };
        const own = tickets.filter((t) => t.projectId === row.id);
        return { ...row, tickets: own };
      },
    ),
    create: jest.fn(async ({ data }: { data: { name: string; nameKey: string } }) => {
      if ([...projects.values()].some((p) => p.nameKey === data.nameKey)) {
        const err = new Error('unique') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const now = new Date();
      const row: ProjectRow = {
        id: `proj-${nextId++}`,
        name: data.name,
        nameKey: data.nameKey,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      projects.set(row.id, row);
      return { ...row };
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Pick<ProjectRow, 'name' | 'nameKey' | 'archivedAt'>>;
      }) => {
        const row = projects.get(where.id);
        if (!row) throw new Error('missing');
        if (
          data.nameKey &&
          [...projects.values()].some(
            (p) => p.nameKey === data.nameKey && p.id !== row.id,
          )
        ) {
          const err = new Error('unique') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    ),
  };

  const ticket = {
    count: jest.fn(async ({ where }: { where: { projectId: string; status?: string } }) => {
      return tickets.filter(
        (t) =>
          t.projectId === where.projectId &&
          (where.status === undefined || t.status === where.status),
      ).length;
    }),
    groupBy: jest.fn(
      async ({
        where,
      }: {
        where: { status: string; projectId: { in: string[] } };
      }) => {
        const counts = new Map<string, number>();
        for (const t of tickets) {
          if (t.status !== where.status || !t.projectId) continue;
          if (!where.projectId.in.includes(t.projectId)) continue;
          counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1);
        }
        return [...counts.entries()].map(([projectId, n]) => ({
          projectId,
          _count: { _all: n },
        }));
      },
    ),
  };

  const prisma = { project, ticket };
  return { prisma, projects, tickets, setRaceMisses: (n: number) => (raceMisses = n) };
}

function makeController() {
  const fake = makeFake();
  const controller = new ProjectsController(fake.prisma as unknown as PrismaService);
  return { controller, ...fake };
}

describe('ProjectsController', () => {
  it('creates a project and lists it with 0 of 0', async () => {
    const { controller } = makeController();
    const created = await controller.create({ name: 'Roadmap' });
    expect(created.project.name).toBe('Roadmap');
    expect(created.project.ticketCount).toBe(0);
    expect(created.project.doneCount).toBe(0);
    expect(created.project).not.toHaveProperty('nameKey');

    const { projects } = await controller.list();
    expect(projects.map((p) => p.name)).toEqual(['Roadmap']);
  });

  it.each([undefined, '', '   ', 4])(
    'rejects blank name %p with 400 and does not save',
    async (name) => {
      const { controller, prisma } = makeController();
      await expect(controller.create({ name })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.project.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an over-long name with 400', async () => {
    const { controller, prisma } = makeController();
    await expect(
      controller.create({ name: 'x'.repeat(81) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name with 409, including a different case', async () => {
    const { controller, prisma } = makeController();
    await controller.create({ name: 'Roadmap' });
    prisma.project.create.mockClear();
    await expect(controller.create({ name: 'roadmap' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(controller.create({ name: '  Roadmap  ' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('a lost race on the unique index is still 409, not 201', async () => {
    const { controller, setRaceMisses, projects } = makeController();
    await controller.create({ name: 'Roadmap' });
    // The pre-check misses (as if it ran before the row existed) and the
    // insert then hits the unique index.
    setRaceMisses(1);
    await expect(controller.create({ name: 'Roadmap' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect([...projects.values()]).toHaveLength(1);
  });

  it('renames a project', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    const renamed = await controller.update(project.id, { name: 'Launch plan' });
    expect(renamed.project.name).toBe('Launch plan');
    const { projects } = await controller.list();
    expect(projects.map((p) => p.name)).toEqual(['Launch plan']);
  });

  it('rename to the same name with different case is allowed (it is the same project)', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    const renamed = await controller.update(project.id, { name: 'roadmap' });
    expect(renamed.project.name).toBe('roadmap');
  });

  it('rename onto another project’s name is 409 and keeps the old name', async () => {
    const { controller } = makeController();
    await controller.create({ name: 'Roadmap' });
    const other = await controller.create({ name: 'Launch' });
    await expect(
      controller.update(other.project.id, { name: 'roadmap' }),
    ).rejects.toBeInstanceOf(ConflictException);
    const { projects } = await controller.list();
    expect(projects.map((p) => p.name).sort()).toEqual(['Launch', 'Roadmap']);
  });

  it('blank rename is 400', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    await expect(controller.update(project.id, { name: '  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('unknown id is 404', async () => {
    const { controller } = makeController();
    await expect(controller.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.update('nope', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('empty PATCH is 400', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    await expect(controller.update(project.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('archive hides the project from the default list and does not delete its tickets', async () => {
    const { controller, tickets } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    tickets.push(
      { id: 't1', projectId: project.id, status: 'done', title: 'Shipped' },
      { id: 't2', projectId: project.id, status: 'todo', title: 'Open' },
    );

    const archived = await controller.update(project.id, { archived: true });
    expect(archived.project.archivedAt).not.toBeNull();
    expect(archived.project.ticketCount).toBe(2);
    expect(archived.project.doneCount).toBe(1);

    const def = await controller.list();
    expect(def.projects).toEqual([]);

    const only = await controller.list('only');
    expect(only.projects.map((p) => p.id)).toEqual([project.id]);

    // Direct link still returns the tickets — archive is not delete.
    const detail = await controller.get(project.id);
    expect(detail.tickets.map((t) => t.title).sort()).toEqual(['Open', 'Shipped']);
    expect(detail.project.doneCount).toBe(1);
    expect(detail.project.ticketCount).toBe(2);
    expect(tickets).toHaveLength(2);
  });

  it('unarchive puts the project back on the default list', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    await controller.update(project.id, { archived: true });
    await controller.update(project.id, { archived: false });
    const { projects } = await controller.list();
    expect(projects.map((p) => p.name)).toEqual(['Roadmap']);
    expect(projects[0].archivedAt).toBeNull();
  });

  it('archived=all returns both, and a bad filter is 400', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    await controller.update(project.id, { archived: true });
    await controller.create({ name: 'Launch' });
    const all = await controller.list('all');
    expect(all.projects.map((p) => p.name).sort()).toEqual(['Launch', 'Roadmap']);
    await expect(controller.list('maybe')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('non-boolean archived is 400', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Roadmap' });
    await expect(
      controller.update(project.id, { archived: 'yes' as unknown as boolean }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a project with no tickets returns an empty ticket list (no throw)', async () => {
    const { controller } = makeController();
    const { project } = await controller.create({ name: 'Ideas' });
    const detail = await controller.get(project.id);
    expect(detail.tickets).toEqual([]);
    expect(detail.project.ticketCount).toBe(0);
    expect(detail.project.doneCount).toBe(0);
  });

  it('counts done tickets as 1 of 2', async () => {
    const { controller, tickets } = makeController();
    const { project } = await controller.create({ name: 'Onboarding' });
    tickets.push(
      { id: 't1', projectId: project.id, status: 'done', title: 'A' },
      { id: 't2', projectId: project.id, status: 'todo', title: 'B' },
    );
    const { projects } = await controller.list();
    expect(projects[0].doneCount).toBe(1);
    expect(projects[0].ticketCount).toBe(2);
  });
});
