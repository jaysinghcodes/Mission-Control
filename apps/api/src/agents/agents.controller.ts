import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  agentRegistered,
  agentStatusName,
  agentWentOffline,
} from '../activity/activity-text';
import { AGENT_STATUSES, isAgentStatus } from './agent-status';
import {
  NAME_MAX,
  REGISTER_FIELDS,
  TEXT_MAX,
  asRosterAgent,
  codePointLength,
  isAgentSlug,
  isOnline,
  planDelete,
  planHeartbeat,
  planRegister,
  tagsValue,
  type HeartbeatPatch,
  type RegisterInput,
  type RosterAgent,
} from './agent-merge';

const REGISTER_FIELD_SET = new Set<string>(REGISTER_FIELDS);
const HEARTBEAT_FIELD_SET = new Set<string>(['currentTask', 'status']);

/**
 * AgentsController. The roster is the seeded defaults, OpenClaw snapshot
 * rows, and bots that register themselves. GET stays open. Register,
 * heartbeat, and delete are writes, so the shared token middleware covers
 * them.
 */
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LiveActivityGateway,
  ) {}

  @Get()
  async list() {
    const now = new Date();
    const agents = await this.prisma.agent.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return {
      agents: agents.map((agent) => this.present(agent, now)),
      ts: Date.now(),
    };
  }

  /**
   * GET /agents/:id. :id is the agent id. When no row has that id, a name
   * match is used so older links keep working.
   */
  @Get(':id')
  async one(@Param('id') id: string) {
    const now = new Date();
    const include = { children: { orderBy: { name: 'asc' as const } } };
    const agent =
      (await this.prisma.agent.findUnique({ where: { id }, include })) ??
      (await this.prisma.agent.findFirst({ where: { name: id }, include }));
    if (!agent) {
      throw new NotFoundException(`agent "${id}" not found`);
    }
    const { children, ...rest } = agent;
    return {
      agent: {
        ...this.present(rest, now),
        children: children.map((child) => this.present(child, now)),
      },
      ts: Date.now(),
    };
  }

  /**
   * POST /agents/register. 201 when the id is new, 200 when it already
   * exists. An existing default or snapshot row becomes registered in
   * place. Position, color, and emoji stay.
   */
  @Post('register')
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = this.registerInput(body);
    const now = new Date();
    const existing = (await this.prisma.agent.findMany()).map(asRosterAgent);
    const plan = planRegister(existing, input, now);
    if (!plan.ok) throw new ConflictException(plan.message);
    const saved = plan.created
      ? await this.insertRegistered(plan.row)
      : await this.updateRegistered(plan.row);
    await this.emit('register', saved.id, saved.source, true, saved.name);
    res.status(plan.created ? 201 : 200);
    return { agent: this.present(saved, now), ts: Date.now() };
  }

  /**
   * POST /agents/:id/heartbeat. 204 for a registered bot, 404 otherwise.
   * Sets lastSeenAt. An optional body may set currentTask and status.
   * No body leaves those fields as they are. status idle clears
   * currentTask. Null or a blank currentTask clears it. A non blank
   * string stores it. Does not create a row. A bad body is 400 before
   * the id is checked.
   */
  @Post(':id/heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  async heartbeat(
    @Param('id') id: string,
    @Body() body: unknown = {},
  ): Promise<void> {
    const patch = this.heartbeatInput(body);
    const now = new Date();
    const found = await this.prisma.agent.findUnique({ where: { id } });
    const plan = planHeartbeat(found ? asRosterAgent(found) : null, now, patch);
    if (!plan.ok) throw new NotFoundException(plan.message);
    const previousStatus = found?.status;
    await this.prisma.agent.update({
      where: { id },
      data: {
        lastSeenAt: plan.row.lastSeenAt,
        ...(patch.status !== undefined ? { status: plan.row.status } : {}),
        ...(patch.status === 'idle' || patch.currentTask !== undefined
          ? { currentTask: plan.row.currentTask }
          : {}),
      },
    });
    await this.emit('heartbeat', id, 'registered', false);
    if (
      patch.status !== undefined &&
      patch.status !== previousStatus &&
      found
    ) {
      await this.persistStatus(found.name, patch.status);
    }
  }

  /**
   * DELETE /agents/:id. 204 for a registered bot. 409 for a default or
   * snapshot row. 404 when the id is missing. Nothing is auto deleted.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    const found = await this.prisma.agent.findUnique({ where: { id } });
    const plan = planDelete(found ? asRosterAgent(found) : null);
    if (!plan.ok) {
      if (plan.status === 404) throw new NotFoundException(plan.message);
      throw new ConflictException(plan.message);
    }
    await this.prisma.agent.delete({ where: { id } });
    await this.emit('delete', id, 'registered', true, found?.name);
  }

  private present<T extends { source: string; lastSeenAt: Date | null }>(
    agent: T,
    now: Date,
  ): Omit<T, 'lastSeenAt'> & { lastSeenAt: string | null; online: boolean } {
    return {
      ...agent,
      lastSeenAt: agent.lastSeenAt ? agent.lastSeenAt.toISOString() : null,
      online: isOnline(agent.source, agent.lastSeenAt, now),
    };
  }

  private registerInput(body: unknown): RegisterInput {
    const payload = this.payload(body);
    this.rejectUnknown(payload);
    return {
      id: this.requireSlug(payload.id),
      name: this.requireName(payload.name),
      ...this.optionalText(payload, 'role'),
      ...this.optionalText(payload, 'model'),
      ...this.optionalText(payload, 'avatar'),
    };
  }

  private payload(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  }

  private heartbeatInput(body: unknown): HeartbeatPatch {
    const payload = this.payload(body);
    this.rejectUnknown(payload, HEARTBEAT_FIELD_SET);
    const patch: HeartbeatPatch = {};
    if ('currentTask' in payload) {
      patch.currentTask = this.requireTask(payload.currentTask);
    }
    if ('status' in payload) {
      patch.status = this.requireAgentStatus(payload.status);
    }
    return patch;
  }

  private rejectUnknown(
    body: Record<string, unknown>,
    allowed: ReadonlySet<string> = REGISTER_FIELD_SET,
  ): void {
    const unknown = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknown.length === 0) return;
    const label = unknown.length === 1 ? 'unknown field' : 'unknown fields';
    throw new BadRequestException(`${label} ${unknown.join(', ')}`);
  }

  private requireSlug(raw: unknown): string {
    if (typeof raw !== 'string') {
      if (raw === undefined || raw === null) {
        throw new BadRequestException('id is required');
      }
      throw new BadRequestException('id must be a string');
    }
    const id = raw.trim();
    if (!id) throw new BadRequestException('id is required');
    if (!isAgentSlug(id)) {
      throw new BadRequestException(
        'id must be a lowercase slug of 1 to 64 characters',
      );
    }
    return id;
  }

  private requireName(raw: unknown): string {
    if (typeof raw !== 'string') {
      if (raw === undefined || raw === null) {
        throw new BadRequestException('name is required');
      }
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

  private requireAgentStatus(raw: unknown): string {
    if (typeof raw !== 'string') {
      throw new BadRequestException('status must be a string');
    }
    const status = raw.trim();
    if (!isAgentStatus(status)) {
      throw new BadRequestException(
        `status must be one of ${AGENT_STATUSES.join(', ')}`,
      );
    }
    return status;
  }

  private requireTask(raw: unknown): string | null {
    if (raw === null) return null;
    if (typeof raw !== 'string') {
      throw new BadRequestException('currentTask must be a string');
    }
    const text = raw.trim();
    if (!text) return null;
    if (codePointLength(text) > TEXT_MAX) {
      throw new BadRequestException(
        `currentTask must be ${TEXT_MAX} characters or fewer`,
      );
    }
    return text;
  }

  private optionalText(
    body: Record<string, unknown>,
    key: 'role' | 'model' | 'avatar',
  ): Partial<RegisterInput> {
    if (!(key in body)) return {};
    const raw = body[key];
    if (typeof raw !== 'string') {
      throw new BadRequestException(`${key} must be a string`);
    }
    const text = raw.trim();
    if (!text)
      throw new BadRequestException(`${key} must be a non blank string`);
    if (codePointLength(text) > TEXT_MAX) {
      throw new BadRequestException(
        `${key} must be ${TEXT_MAX} characters or fewer`,
      );
    }
    return { [key]: text };
  }

  private async insertRegistered(row: RosterAgent) {
    try {
      return await this.prisma.agent.create({ data: this.writeData(row) });
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  private async updateRegistered(row: RosterAgent) {
    try {
      return await this.prisma.agent.update({
        where: { id: row.id },
        data: {
          name: row.name,
          role: row.role,
          model: row.model,
          avatar: row.avatar,
          source: 'registered',
          lastSeenAt: row.lastSeenAt,
        },
      });
    } catch (err) {
      this.rethrowUnique(err);
    }
  }

  private writeData(row: RosterAgent): Prisma.AgentCreateInput {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      role: row.role,
      status: row.status,
      emoji: row.emoji,
      personalityTags: tagsValue(row.personalityTags),
      currentTask: row.currentTask,
      tasksCompleted: row.tasksCompleted,
      totalCost: row.totalCost,
      recentActivity: row.recentActivity,
      channel: row.channel,
      source: row.source,
      model: row.model,
      avatar: row.avatar,
      position: row.position,
      lastSeenAt: row.lastSeenAt,
    };
  }

  private rethrowUnique(err: unknown): never {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictException('name already exists');
    }
    throw err;
  }

  /** A real status change leaves a sentence on the activity rail. */
  private async persistStatus(name: string, status: string): Promise<void> {
    const payload = {
      name: agentStatusName(name, status),
      agent: name,
      status,
    };
    try {
      await this.prisma.activityEvent.create({
        data: { type: 'agent.status', payload, source: 'api' },
      });
    } catch {
      // History is best effort. The live line still goes out.
    }
    this.gateway.broadcast('agent.status', payload);
  }

  private async emit(
    action: 'register' | 'heartbeat' | 'delete',
    id: string,
    source: string,
    persist: boolean,
    agentName?: string,
  ): Promise<void> {
    const name = agentName?.trim() ?? '';
    const sentence =
      action === 'register' && name
        ? agentRegistered(name)
        : action === 'delete' && name
          ? agentWentOffline(name)
          : '';
    const payload = {
      id,
      source,
      action,
      ...(name ? { agent: name } : {}),
      ...(sentence ? { name: sentence } : {}),
    };
    if (persist) {
      try {
        await this.prisma.activityEvent.create({
          data: {
            type: 'agents.snapshot',
            payload,
            source: 'api',
          },
        });
      } catch {
        // The live event still goes out. A history write must not fail the route.
      }
    }
    this.gateway.broadcast('agents.snapshot', payload);
  }
}
