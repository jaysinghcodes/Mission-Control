import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ToolValidationError,
  assertPlaceholdersMatch,
  fillPrompt,
  normalizeDescription,
  normalizeInputs,
  normalizeName,
  normalizeTemplate,
  valuesFor,
} from './prompt-template';
import type { ToolInput } from './prompt-template';

/**
 * CustomToolsController — ticket 10 (experimental).
 *
 *  - GET    /custom-tools              → saved tools
 *  - POST   /custom-tools              → create (201)
 *  - PATCH  /custom-tools/:id          → edit
 *  - DELETE /custom-tools/:id          → delete
 *  - POST   /custom-tools/preview      → fill a draft template
 *  - POST   /custom-tools/:id/preview  → test-run a saved tool
 *
 * Preview and test-run substitute `{{name}}` with the posted text and
 * return the string. They do not insert a row and they do not call
 * OpenClaw, the bridge, or any other host. Live execution is out of scope.
 *
 *  - 400 missing name, empty template, placeholder with no matching input
 *  - 404 unknown id
 *  - 409 duplicate name
 */

interface ToolBody {
  name?: unknown;
  description?: unknown;
  promptTemplate?: unknown;
  inputs?: unknown;
}

interface PreviewBody {
  promptTemplate?: unknown;
  inputs?: unknown;
  values?: unknown;
}

interface RunBody {
  values?: unknown;
}

interface ToolJson {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  inputs: ToolInput[];
  createdAt: Date;
  updatedAt: Date;
}

type ToolRow = {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  inputs: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

@Controller('custom-tools')
export class CustomToolsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const tools = await this.prisma.customTool.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { tools: tools.map((row) => this.toJson(row)), ts: Date.now() };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const row = await this.prisma.customTool.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`tool ${id} not found`);
    return { tool: this.toJson(row), ts: Date.now() };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: ToolBody) {
    const draft = this.parseDraft(body);
    await this.assertNameAvailable(draft.name);
    try {
      const row = await this.prisma.customTool.create({
        data: {
          name: draft.name,
          description: draft.description,
          promptTemplate: draft.promptTemplate,
          inputs: draft.inputs as unknown as Prisma.InputJsonValue,
        },
      });
      return { tool: this.toJson(row), ts: Date.now() };
    } catch (err) {
      throw this.nameConflictOrRethrow(err, draft.name);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: ToolBody) {
    const existing = await this.prisma.customTool.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`tool ${id} not found`);
    if (
      body?.name === undefined &&
      body?.description === undefined &&
      body?.promptTemplate === undefined &&
      body?.inputs === undefined
    ) {
      throw new BadRequestException('nothing to update — send name, description, promptTemplate, and/or inputs');
    }
    const current = this.toJson(existing);
    const draft = this.parseDraft({
      name: body?.name === undefined ? current.name : body.name,
      description: body?.description === undefined ? current.description : body.description,
      promptTemplate: body?.promptTemplate === undefined ? current.promptTemplate : body.promptTemplate,
      inputs: body?.inputs === undefined ? current.inputs : body.inputs,
    });
    if (draft.name !== existing.name) await this.assertNameAvailable(draft.name);
    try {
      const row = await this.prisma.customTool.update({
        where: { id },
        data: {
          name: draft.name,
          description: draft.description,
          promptTemplate: draft.promptTemplate,
          inputs: draft.inputs as unknown as Prisma.InputJsonValue,
        },
      });
      return { tool: this.toJson(row), ts: Date.now() };
    } catch (err) {
      throw this.nameConflictOrRethrow(err, draft.name);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      await this.prisma.customTool.delete({ where: { id } });
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException(`tool ${id} not found`);
      throw err;
    }
    return { deleted: id };
  }

  /**
   * Dry-run a draft. No database write. The returned `prompt` is the
   * template with values substituted — the caller renders it as text.
   */
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: PreviewBody) {
    const promptTemplate = this.guard(() => normalizeTemplate(body?.promptTemplate));
    const inputs = this.guard(() => normalizeInputs(body?.inputs));
    this.guard(() => assertPlaceholdersMatch(promptTemplate, inputs));
    const prompt = fillPrompt(promptTemplate, this.guard(() => valuesFor(inputs, body?.values)));
    return { prompt, ts: Date.now() };
  }

  /** Dry-run a saved tool. Same substitution, still no outbound call. */
  @Post(':id/preview')
  @HttpCode(200)
  async previewSaved(@Param('id') id: string, @Body() body: RunBody) {
    const row = await this.prisma.customTool.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`tool ${id} not found`);
    const tool = this.toJson(row);
    const prompt = fillPrompt(tool.promptTemplate, this.guard(() => valuesFor(tool.inputs, body?.values)));
    return { prompt, ts: Date.now() };
  }

  private parseDraft(body: ToolBody | undefined): {
    name: string;
    description: string;
    promptTemplate: string;
    inputs: ToolInput[];
  } {
    return this.guard(() => {
      const name = normalizeName(body?.name);
      const description = normalizeDescription(body?.description);
      const promptTemplate = normalizeTemplate(body?.promptTemplate);
      const inputs = normalizeInputs(body?.inputs);
      assertPlaceholdersMatch(promptTemplate, inputs);
      return { name, description, promptTemplate, inputs };
    });
  }

  private guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ToolValidationError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const clash = await this.prisma.customTool.findUnique({ where: { name } });
    if (clash) throw new ConflictException(`a tool named "${clash.name}" already exists`);
  }

  private nameConflictOrRethrow(err: unknown, name: string): Error {
    if (this.isUnique(err)) return new ConflictException(`a tool named "${name}" already exists`);
    return err instanceof Error ? err : new Error(String(err));
  }

  private isUnique(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
  }

  private isNotFound(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025';
  }

  private toJson(row: ToolRow): ToolJson {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      promptTemplate: row.promptTemplate,
      inputs: this.guard(() => normalizeInputs(row.inputs)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
