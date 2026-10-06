import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CustomToolsController } from './custom-tools.controller';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CustomToolsController — no database, and no network.
 * The fake enforces the unique name the migration's index does, including
 * a missed pre-check so a lost race is still 409.
 */

type ToolRow = {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  inputs: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function makeFake() {
  const tools = new Map<string, ToolRow>();
  let nextId = 1;
  let clock = 1_000;
  /** Next name lookup misses, so the following create/update hits P2002. */
  let raceMisses = 0;

  const customTool = {
    findMany: jest.fn(async () => {
      return [...tools.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),
    findUnique: jest.fn(async ({ where }: { where: { id?: string; name?: string } }) => {
      if (where.name !== undefined) {
        if (raceMisses > 0) {
          raceMisses -= 1;
          return null;
        }
        return [...tools.values()].find((row) => row.name === where.name) ?? null;
      }
      if (!where.id) return null;
      return tools.get(where.id) ?? null;
    }),
    create: jest.fn(async ({ data }: { data: Omit<ToolRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
      if ([...tools.values()].some((row) => row.name === data.name)) {
        const err = new Error('unique') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const now = new Date(clock);
      clock += 1_000;
      const row: ToolRow = {
        id: `tool-${nextId++}`,
        name: data.name,
        description: data.description,
        promptTemplate: data.promptTemplate,
        inputs: data.inputs,
        createdAt: now,
        updatedAt: now,
      };
      tools.set(row.id, row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<ToolRow> }) => {
      const row = tools.get(where.id);
      if (!row) {
        const err = new Error('missing') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      if (data.name && [...tools.values()].some((other) => other.name === data.name && other.id !== row.id)) {
        const err = new Error('unique') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      Object.assign(row, data, { updatedAt: new Date(clock) });
      clock += 1_000;
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = tools.get(where.id);
      if (!row) {
        const err = new Error('missing') as Error & { code: string };
        err.code = 'P2025';
        throw err;
      }
      tools.delete(where.id);
      return { ...row };
    }),
  };

  return {
    prisma: { customTool },
    tools,
    setRaceMisses: (n: number) => {
      raceMisses = n;
    },
  };
}

function makeController() {
  const fake = makeFake();
  const controller = new CustomToolsController(fake.prisma as unknown as PrismaService);
  return { controller, ...fake };
}

const twoInputs = {
  name: 'Brief writer',
  description: 'A short brief',
  promptTemplate: 'Write about {{topic}} for {{audience}}.',
  inputs: [
    { name: 'topic', label: 'Topic' },
    { name: 'audience', label: 'Audience' },
  ],
};

async function expectStatus(run: () => Promise<unknown>, status: number, message: string) {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(
      status === 409 ? ConflictException : status === 404 ? NotFoundException : BadRequestException,
    );
    const http = err as BadRequestException;
    expect(http.getStatus()).toBe(status);
    expect(http.message).toBe(message);
    return;
  }
  throw new Error(`expected HTTP ${status}`);
}

describe('CustomToolsController', () => {
  it('creates, lists, edits, and deletes a tool', async () => {
    const { controller } = makeController();
    const created = await controller.create(twoInputs);
    expect(created.tool.name).toBe('Brief writer');
    expect(created.tool.inputs).toEqual(twoInputs.inputs);

    const listed = await controller.list();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['Brief writer']);

    const edited = await controller.update(created.tool.id, {
      description: 'Edited',
      promptTemplate: 'Write about {{topic}}.',
      inputs: [{ name: 'topic', label: 'Topic' }],
    });
    expect(edited.tool.description).toBe('Edited');
    expect(edited.tool.promptTemplate).toBe('Write about {{topic}}.');
    expect((await controller.list()).tools[0].description).toBe('Edited');

    const removed = await controller.remove(created.tool.id);
    expect(removed).toEqual({ deleted: created.tool.id });
    expect((await controller.list()).tools).toEqual([]);
  });

  it.each([undefined, '', '   ', 4])('rejects missing name %p with 400', async (name) => {
    const { controller, prisma } = makeController();
    await expectStatus(
      () => controller.create({ name, promptTemplate: 'Hello' }),
      400,
      'name is required',
    );
    expect(prisma.customTool.create).not.toHaveBeenCalled();
  });

  it.each(['', '   ', undefined])('rejects empty template %p with 400', async (promptTemplate) => {
    const { controller, prisma } = makeController();
    await expectStatus(
      () => controller.create({ name: 'Brief', promptTemplate }),
      400,
      'prompt template is empty',
    );
    expect(prisma.customTool.create).not.toHaveBeenCalled();
  });

  it('rejects a placeholder with no matching input', async () => {
    const { controller, prisma } = makeController();
    await expectStatus(
      () => controller.create({ name: 'Brief', promptTemplate: 'Hello {{topic}}', inputs: [] }),
      400,
      'placeholder {{topic}} has no matching input',
    );
    expect(prisma.customTool.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name with 409 and does not insert a second row', async () => {
    const { controller, tools } = makeController();
    await controller.create({ name: 'Brief', promptTemplate: 'Hello' });
    await expectStatus(
      () => controller.create({ name: 'Brief', promptTemplate: 'Other' }),
      409,
      'a tool named "Brief" already exists',
    );
    expect(tools.size).toBe(1);
  });

  it('a lost race on the unique index is still 409', async () => {
    const { controller, setRaceMisses, tools } = makeController();
    await controller.create({ name: 'Brief', promptTemplate: 'Hello' });
    setRaceMisses(1);
    await expectStatus(
      () => controller.create({ name: 'Brief', promptTemplate: 'Hello' }),
      409,
      'a tool named "Brief" already exists',
    );
    expect(tools.size).toBe(1);
  });

  it('rejects renaming onto an existing name', async () => {
    const { controller } = makeController();
    const first = await controller.create({ name: 'Brief', promptTemplate: 'Hello' });
    const second = await controller.create({ name: 'Notes', promptTemplate: 'Hello' });
    await expectStatus(
      () => controller.update(second.tool.id, { name: 'Brief' }),
      409,
      'a tool named "Brief" already exists',
    );
    expect((await controller.get(first.tool.id)).tool.name).toBe('Brief');
    expect((await controller.get(second.tool.id)).tool.name).toBe('Notes');
  });

  it('preview fills a draft and does not write or call out', async () => {
    const { controller, prisma, tools } = makeController();
    const fetchMock = jest.fn();
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await controller.preview({
        promptTemplate: 'Write about {{topic}} for {{audience}}. See {{topic}}.',
        inputs: twoInputs.inputs,
        values: {
          topic: '<script>alert(1)</script>',
          audience: 'ops',
        },
      });
      expect(result.prompt).toBe(
        'Write about <script>alert(1)</script> for ops. See <script>alert(1)</script>.',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.customTool.create).not.toHaveBeenCalled();
      expect(prisma.customTool.update).not.toHaveBeenCalled();
      expect(prisma.customTool.delete).not.toHaveBeenCalled();
      expect(tools.size).toBe(0);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('test-run of a saved tool substitutes text and does not call out', async () => {
    const { controller, prisma } = makeController();
    const created = await controller.create(twoInputs);
    prisma.customTool.create.mockClear();
    const fetchMock = jest.fn();
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await controller.previewSaved(created.tool.id, {
        values: { topic: 'https://example.invalid/secret', audience: '<img src=x onerror=alert(1)>' },
      });
      expect(result.prompt).toBe(
        'Write about https://example.invalid/secret for <img src=x onerror=alert(1)>.',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.customTool.create).not.toHaveBeenCalled();
      expect(prisma.customTool.update).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('does not import a network client', () => {
    const dir = __dirname;
    const combined = ['custom-tools.controller.ts', 'prompt-template.ts']
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    expect(combined).not.toMatch(/node:http|node:https|axios|node-fetch|from 'http'|from 'https'/);
    expect(combined).not.toMatch(/\bfetch\s*\(/);
  });

  it('HTTP preview is 200 text and HTTP validation is 4xx', async () => {
    const fake = makeFake();
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomToolsController],
      providers: [{ provide: PrismaService, useValue: fake.prisma }],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();
    const fetchMock = jest.fn();
    const previousFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const filled = await request(app.getHttpServer())
        .post('/custom-tools/preview')
        .send({
          promptTemplate: 'Hi {{topic}}',
          inputs: [{ name: 'topic' }],
          values: { topic: '<script>alert(1)</script>' },
        });
      expect(filled.status).toBe(200);
      expect(filled.body.prompt).toBe('Hi <script>alert(1)</script>');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.prisma.customTool.create).not.toHaveBeenCalled();

      const missing = await request(app.getHttpServer())
        .post('/custom-tools')
        .send({ promptTemplate: 'Hi' });
      expect(missing.status).toBe(400);
      expect(missing.body.message).toBe('name is required');

      const empty = await request(app.getHttpServer())
        .post('/custom-tools')
        .send({ name: 'Brief', promptTemplate: '  ' });
      expect(empty.status).toBe(400);
      expect(empty.body.message).toBe('prompt template is empty');

      const placeholder = await request(app.getHttpServer())
        .post('/custom-tools')
        .send({ name: 'Brief', promptTemplate: 'Hi {{topic}}', inputs: [] });
      expect(placeholder.status).toBe(400);
      expect(placeholder.body.message).toBe('placeholder {{topic}} has no matching input');

      const created = await request(app.getHttpServer())
        .post('/custom-tools')
        .send({ name: 'Brief', promptTemplate: 'Hi' });
      expect(created.status).toBe(201);

      const duplicate = await request(app.getHttpServer())
        .post('/custom-tools')
        .send({ name: 'Brief', promptTemplate: 'Hi again' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toBe('a tool named "Brief" already exists');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it('returns 404 for an unknown tool', async () => {
    const { controller } = makeController();
    await expectStatus(() => controller.remove('missing'), 404, 'tool missing not found');
    await expectStatus(() => controller.update('missing', { name: 'X' }), 404, 'tool missing not found');
    await expectStatus(() => controller.previewSaved('missing', { values: {} }), 404, 'tool missing not found');
  });
});
