import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  asRosterAgent,
  normalizeSnapshotAgents,
  planSnapshot,
  tagsValue,
  type RosterAgent,
} from '../agents/agent-merge';
import { wireText } from '../wire-text';
import { PrismaService } from '../prisma/prisma.service';
import { loadAgentNames, resolveIngestAgent } from '../agents/agent-ref';
import { SETTING_ID } from '../team/mission';
import { TimezoneService } from '../time/timezone.service';
import { usageBucketsFromPayload } from '../usage/usage-points';
import { usageTimeZone } from '../usage/zone-time';

/**
 * SnapshotsService — applies state snapshots pushed by the OpenClaw bridge.
 *
 * The bridge (an OpenClaw cron job) collects REAL state from the instance —
 * agent roster, sessions, cron jobs, usage, pending approvals — and POSTs it
 * as `*.snapshot` events. Session, calendar, and approval handlers replace
 * their rows. agents.snapshot merges by id and only removes snapshot rows,
 * so a default or registered bot survives a partial roster.
 */
@Injectable()
export class SnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly zones?: TimezoneService,
  ) {}

  /**
   * Merge an agents.snapshot into the roster.
   *
   * Snapshot rows may be created, updated, or removed. Default and
   * registered rows are never deleted and never change source. Match is
   * by id. An entry with no id uses the slug of its name. When that id
   * is default or registered, only status fields change. Parent links
   * are applied to snapshot rows after they exist, so a child listed
   * before its parent does not trip the foreign key.
   *
   * Profile fields stay optional. A snapshot owned row mirrors the payload.
   * A protected row keeps name, role, color, emoji, position, avatar,
   * and parent.
   */
  async applyAgents(payload: Record<string, unknown>): Promise<void> {
    const existing = (await this.prisma.agent.findMany()).map(asRosterAgent);
    const plan = planSnapshot(existing, normalizeSnapshotAgents(payload));
    await this.prisma.$transaction(async (tx) => {
      if (plan.deleteIds.length > 0) {
        await tx.agent.deleteMany({ where: { id: { in: plan.deleteIds } } });
      }
      for (const row of plan.creates) {
        await tx.agent.create({ data: snapshotCreate(row) });
      }
      for (const row of plan.snapshotWrites) {
        await tx.agent.update({
          where: { id: row.id },
          data: snapshotUpdate(row),
        });
      }
      for (const write of plan.statusWrites) {
        await tx.agent.update({
          where: { id: write.id },
          data: write.data,
        });
      }
      for (const link of plan.parentLinks) {
        await tx.agent.update({
          where: { id: link.id },
          data: { parentId: link.parentId },
        });
      }
    });
  }

  /** Replace the active sessions table. */
  async applySessions(payload: Record<string, unknown>): Promise<void> {
    const sessions = Array.isArray(payload.sessions)
      ? (payload.sessions as Record<string, unknown>[])
      : [];
    const roster = await loadAgentNames(this.prisma);
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({}),
      ...sessions.map((s) => {
        const raw = wireText(s.agent ?? 'main');
        return this.prisma.session.create({
          data: {
            name: wireText(s.name ?? 'session'),
            agent: resolveIngestAgent(raw, roster) ?? raw,
            model: s.model ? wireText(s.model) : null,
            ctx: Number(s.ctx ?? 0),
            lastActivity: s.lastActivity ? wireText(s.lastActivity) : null,
            hot: Boolean(s.hot ?? false),
          },
        });
      }),
    ]);
  }

  /** Replace the calendar (cron jobs) table. */
  async applyCalendar(payload: Record<string, unknown>): Promise<void> {
    const jobs = Array.isArray(payload.jobs)
      ? (payload.jobs as Record<string, unknown>[])
      : [];
    await this.prisma.$transaction([
      this.prisma.cronJob.deleteMany({}),
      ...jobs.map((j) =>
        this.prisma.cronJob.create({
          data: {
            name: wireText(j.name ?? 'job'),
            schedule: j.schedule ? wireText(j.schedule) : null,
            day: j.day != null ? Number(j.day) : null,
            time: j.time ? wireText(j.time) : null,
            color: j.color ? wireText(j.color) : null,
            enabled: j.enabled !== false,
          },
        }),
      ),
    ]);
  }

  /**
   * Upsert daily usage points. A payload without timestamps is ignored,
   * including a bare 7d or month total. Days that are not in this payload
   * stay, so a later sync cannot wipe the days already collected.
   */
  async applyUsage(
    payload: Record<string, unknown>,
    now: Date = new Date(),
    timeZone?: string,
  ): Promise<void> {
    const zone =
      timeZone ?? (this.zones ? await this.zones.current() : usageTimeZone());
    const buckets = usageBucketsFromPayload(payload, now, zone);
    for (const bucket of buckets) {
      await this.prisma.usageBucket.upsert({
        where: { day: bucket.day },
        create: {
          day: bucket.day,
          at: bucket.at,
          totalCost: bucket.totalCost,
          tokensIn: bucket.tokensIn,
          tokensOut: bucket.tokensOut,
          providers: bucket.providers as unknown as Prisma.InputJsonValue,
        },
        update: {
          at: bucket.at,
          totalCost: bucket.totalCost,
          tokensIn: bucket.tokensIn,
          tokensOut: bucket.tokensOut,
          providers: bucket.providers as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  /** Sync pending approvals — PRESERVES decided ones (approve/reject history). */
  async applyApprovals(payload: Record<string, unknown>): Promise<void> {
    const approvals = Array.isArray(payload.approvals)
      ? (payload.approvals as Record<string, unknown>[])
      : [];
    // Drop stale pending rows; keep approved/rejected history.
    await this.prisma.approval.deleteMany({ where: { status: 'pending' } });
    const existing = await this.prisma.approval.findMany({
      select: { tag: true, status: true },
    });
    const decided = new Set(
      existing.filter((a) => a.status !== 'pending').map((a) => a.tag),
    );
    const fresh = approvals.filter((a) => !decided.has(wireText(a.tag ?? '')));
    if (fresh.length > 0) {
      await this.prisma.approval.createMany({
        data: fresh.map((a) => ({
          kind: wireText(a.kind ?? 'exec'),
          tag: wireText(a.tag ?? 'Request'),
          desc: wireText(a.desc ?? ''),
          status: wireText(a.status ?? 'pending'),
          meta: a.meta ? a.meta : undefined,
        })),
      });
    }
  }

  /**
   * Replace memory with the bridge snapshot.
   *
   * Ids are the caller's stable ids (agent + path), namespaced so they
   * cannot land on a demo id. Re-posting the same id updates that row.
   * Ids missing from this payload are removed only for agents that appear
   * in the payload, so a Forge sync cannot drop Aegis.
   *
   * A payload without an `entries` array is ignored. An empty array — a
   * readable workspace with zero notes, or a sync that names nobody — is
   * a no-op. It must not delete every agent's rows. Demo and seed rows
   * are never updated, even when the payload reuses their id.
   */
  async applyMemory(payload: Record<string, unknown>): Promise<void> {
    if (!Array.isArray(payload.entries)) return;
    const rows = dedupeMemory(
      payload.entries.map(normalizeMemory).filter(isMemoryRow),
    );
    // No storable rows means there is nobody to replace. Deleting here
    // would be a delete-all of every bridge note.
    if (rows.length === 0) return;
    const roster = await loadAgentNames(this.prisma);
    const agentKeys = new Set<string>();
    for (const row of rows) {
      agentKeys.add(row.agent);
      const resolved = resolveIngestAgent(row.agent, roster);
      if (resolved && resolved !== row.agent) {
        agentKeys.add(resolved);
        row.agent = resolved;
      }
    }
    const ids = rows.map((row) => row.id);
    const agents = [...agentKeys];
    await this.prisma.$transaction(async (tx) => {
      // Replace bridge rows only, and only for agents named in this
      // payload. Legacy source=openclaw is the same writer from before
      // this was named bridge. `agent: { in }` is required: an empty
      // agent list must not match every row.
      await tx.memoryEntry.deleteMany({
        where: {
          source: { in: ['bridge', 'openclaw'] },
          agent: { in: agents },
          id: { notIn: ids },
        },
      });
      for (const row of rows) {
        const existing = await tx.memoryEntry.findUnique({
          where: { id: row.id },
          select: { source: true },
        });
        // A demo/seed row keeps its id, body, and source. Live ingest
        // cannot overwrite it by reusing the id.
        if (isDemoMemory(existing?.source, row.id)) continue;
        await tx.memoryEntry.upsert({
          where: { id: row.id },
          create: row,
          update: {
            title: row.title,
            body: row.body,
            agent: row.agent,
            createdAt: row.createdAt,
            kind: row.kind,
            source: row.source,
            ref: row.ref,
          },
        });
      }
    });
  }

  /**
   * Replace provider and model rows from models.snapshot.
   *
   * A payload with neither `agents` nor `models` is ignored, so a bad
   * event cannot wipe the table. An empty list is a real reading and
   * clears the rows. `openclawVersion`, when it is a non empty string,
   * is stored on the settings row and does not change the mission text.
   */
  async applyModels(payload: Record<string, unknown>): Promise<void> {
    const rows = modelRowsFromPayload(payload);
    if (!rows) return;
    const version = openclawVersionFrom(payload);
    const stamp = Date.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.modelConfig.deleteMany({});
      if (rows.length > 0) {
        await tx.modelConfig.createMany({
          data: rows.map((row, index) => ({
            ...row,
            createdAt: new Date(stamp + index),
          })),
        });
      }
      if (version) {
        await tx.setting.upsert({
          where: { id: SETTING_ID },
          create: { id: SETTING_ID, mission: '', openclawVersion: version },
          update: { openclawVersion: version },
        });
      }
    });
  }

  /**
   * Replace live devices and nodes from devices.snapshot.
   *
   * A payload with neither array is ignored, so a bad event cannot wipe
   * the table. An empty array is a real reading and clears that kind.
   * Sample rows (source demo) are removed when either array is present,
   * because a bridge report replaces the seed only list. A devices array
   * does not delete node rows, and a nodes array does not delete device
   * rows, so one failed CLI cannot erase the other list.
   */
  async applyDevices(payload: Record<string, unknown>): Promise<void> {
    const parsed = deviceRowsFromPayload(payload);
    if (!parsed) return;
    const { rows, sawDevices, sawNodes } = parsed;
    await this.prisma.$transaction(async (tx) => {
      await tx.device.deleteMany({ where: { source: 'demo' } });
      if (sawDevices) {
        await tx.device.deleteMany({
          where: { source: 'bridge', kind: 'device' },
        });
      }
      if (sawNodes) {
        await tx.device.deleteMany({
          where: { source: 'bridge', kind: 'node' },
        });
      }
      if (rows.length > 0) {
        await tx.device.deleteMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        await tx.device.createMany({ data: rows });
      }
    });
  }
}

const MEMORY_KINDS = new Set(['long-term', 'daily', 'other']);

type ModelWrite = {
  provider: string;
  model: string;
  label: string | null;
  agentId: string | null;
  agentName: string | null;
  local: boolean;
};

/**
 * Rows for models.snapshot, or null when the payload is not a snapshot.
 * Agent rows come first. A catalog row is kept when no agent already
 * uses that same provider and model.
 */
export function modelRowsFromPayload(
  payload: Record<string, unknown>,
): ModelWrite[] | null {
  const hasAgents = Array.isArray(payload.agents);
  const hasModels = Array.isArray(payload.models);
  if (!hasAgents && !hasModels) return null;
  const rows: ModelWrite[] = [];
  if (hasAgents) {
    for (const item of payload.agents as unknown[]) {
      const row = modelRow(item, true);
      if (row) rows.push(row);
    }
  }
  if (hasModels) {
    for (const item of payload.models as unknown[]) {
      const row = modelRow(item, false);
      if (!row) continue;
      if (
        rows.some(
          (prev) => prev.provider === row.provider && prev.model === row.model,
        )
      ) {
        continue;
      }
      rows.push(row);
    }
  }
  return rows;
}

function modelRow(item: unknown, withAgent: boolean): ModelWrite | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const provider = clip(rec.provider, 80);
  const model = clip(rec.model, 200);
  if (!provider || !model) return null;
  const local = rec.local === true || provider.toLowerCase() === 'ollama';
  if (!withAgent) {
    return {
      provider,
      model,
      label: null,
      agentId: null,
      agentName: null,
      local,
    };
  }
  const name = clip(rec.name ?? rec.agentName ?? '', 200);
  const idRaw = clip(rec.id ?? rec.agentId ?? '', 64);
  const agentId = /^[a-z0-9_]{1,64}$/.test(idRaw) ? idRaw : null;
  return {
    provider,
    model,
    label: name || null,
    agentId,
    agentName: name || null,
    local,
  };
}

function clip(value: unknown, max: number): string {
  return wireText(value).trim().slice(0, max);
}

export type DeviceWrite = {
  id: string;
  name: string;
  type: string;
  online: boolean;
  lastSeenAt: Date | null;
  pairedAt: Date | null;
  requestedAt: Date | null;
  source: 'bridge';
  kind: 'device' | 'node';
};

export type DeviceSnapshot = {
  rows: DeviceWrite[];
  sawDevices: boolean;
  sawNodes: boolean;
};

/**
 * Rows for devices.snapshot, or null when the payload is not a snapshot.
 * Node rows replace a device row with the same id. A demo id is dropped
 * so ingest cannot take a seed row's key.
 */
export function deviceRowsFromPayload(
  payload: Record<string, unknown>,
): DeviceSnapshot | null {
  const sawDevices = Array.isArray(payload.devices);
  const sawNodes = Array.isArray(payload.nodes);
  if (!sawDevices && !sawNodes) return null;
  const byId = new Map<string, DeviceWrite>();
  if (sawDevices) {
    for (const item of payload.devices as unknown[]) {
      const row = oneDevice(item, 'device');
      if (row) byId.set(row.id, row);
    }
  }
  if (sawNodes) {
    for (const item of payload.nodes as unknown[]) {
      const row = oneDevice(item, 'node');
      if (row) byId.set(row.id, row);
    }
  }
  return { rows: [...byId.values()], sawDevices, sawNodes };
}

function oneDevice(item: unknown, kind: 'device' | 'node'): DeviceWrite | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const id = textField(rec.id, 200);
  if (!id || id.startsWith('demo-')) return null;
  const fallback = kind === 'node' ? 'node' : 'device';
  const name = textField(rec.name, 200) || id;
  const type = textField(rec.type, 80) || fallback;
  const online = rec.online === true;
  return {
    id,
    name,
    type,
    online,
    lastSeenAt: online ? null : seenAt(rec.lastSeenAt),
    pairedAt: seenAt(rec.pairedAt),
    requestedAt: seenAt(rec.requestedAt),
    source: 'bridge',
    kind,
  };
}

function textField(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replaceAll('\0', '').trim().slice(0, max);
}

function seenAt(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  if (typeof value === 'string' && value.trim()) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

function openclawVersionFrom(payload: Record<string, unknown>): string | null {
  const version = payload.openclawVersion;
  if (typeof version !== 'string') return null;
  const text = version.trim().slice(0, 80);
  return text || null;
}

type MemoryWrite = {
  id: string;
  title: string;
  body: string;
  agent: string;
  createdAt: Date;
  kind: string;
  source: string | null;
  ref: string | null;
};

function isMemoryRow(row: MemoryWrite | null): row is MemoryWrite {
  return row !== null;
}

function dedupeMemory(rows: MemoryWrite[]): MemoryWrite[] {
  const byId = new Map<string, MemoryWrite>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * Live ids live outside the demo namespace.
 * `mem-` is the bridge's own stable prefix. Anything else is stored as
 * `bridge-…`. A `demo-` id is refused so ingest cannot take a seed row's key.
 */
export function namespaceBridgeId(id: string): string | null {
  if (!id || id.startsWith('demo-')) return null;
  if (id.startsWith('bridge-') || id.startsWith('mem-')) return id;
  const namespaced = `bridge-${id}`;
  return namespaced.length > 200 ? null : namespaced;
}

function isDemoMemory(source: string | null | undefined, id: string): boolean {
  if (id.startsWith('demo-')) return true;
  const src = (source ?? '').toLowerCase();
  return src === 'demo' || src === 'seed';
}

/**
 * One snapshot entry → a row, or null when the entry cannot be stored.
 * Missing id, title, body, or a createdAt that is not a real instant is
 * dropped. Unknown kinds become `other` so a future file shape still lands.
 * A demo id is dropped here so it never reaches the upsert.
 */
function normalizeMemory(value: unknown): MemoryWrite | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!rawId || rawId.length > 200) return null;
  const id = namespaceBridgeId(rawId);
  if (!id) return null;
  const title = wireText(entry.title ?? '')
    .trim()
    .slice(0, 200);
  const body = typeof entry.body === 'string' ? entry.body : '';
  if (!title || !body.trim()) return null;
  const createdAt = new Date(wireText(entry.createdAt ?? ''));
  if (Number.isNaN(createdAt.getTime())) return null;
  const kindRaw = wireText(entry.kind ?? 'other');
  const kind = MEMORY_KINDS.has(kindRaw) ? kindRaw : 'other';
  const agent =
    wireText(entry.agent ?? 'agent')
      .trim()
      .slice(0, 120) || 'agent';
  const ref = entry.ref ? wireText(entry.ref).slice(0, 300) : null;
  // Every snapshot row is a bridge row. The replace below only deletes
  // source=bridge, so a payload cannot hide a note by labeling it demo.
  return { id, title, body, agent, createdAt, kind, source: 'bridge', ref };
}

function snapshotCreate(row: RosterAgent): Prisma.AgentCreateInput {
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
    source: 'snapshot',
    model: row.model,
    avatar: row.avatar,
    position: row.position,
    lastSeenAt: row.lastSeenAt,
  };
}

function snapshotUpdate(row: RosterAgent): Prisma.AgentUpdateInput {
  return {
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
    source: 'snapshot',
  };
}
