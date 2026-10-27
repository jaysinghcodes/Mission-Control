import { Prisma } from '@prisma/client';
import { offlineAfterMs } from '../time/runtime';
import { wireText } from '../wire-text';

/**
 * Source aware roster merge.
 *
 * `default` is the seeded roster. `snapshot` is the OpenClaw bridge.
 * `registered` is POST /agents/register. Identity is a lowercase slug.
 * A snapshot may create, update, or remove only snapshot rows. Registering
 * an existing id updates that row in place and marks it registered, keeping
 * position, color, and emoji (the roster position and robot visual).
 */

export const AGENT_SOURCES = ['default', 'snapshot', 'registered'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/** Bridge rows used randomUUID(). Seeded rows did not. */
export const SNAPSHOT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGENT_SLUG = /^[a-z0-9_]{1,64}$/;

/** Same cap as run names (#43). Counted in Unicode code points. */
export const NAME_MAX = 200;

/** Optional register strings. Same cap as name. */
export const TEXT_MAX = 200;

/** A registered bot with no register or heartbeat for this long is offline. */
export { offlineAfterMs };

export const REGISTER_FIELDS = [
  'id',
  'name',
  'role',
  'model',
  'avatar',
] as const;

export interface RosterAgent {
  id: string;
  name: string;
  color: string;
  role: string | null;
  status: string;
  parentId: string | null;
  emoji: string | null;
  personalityTags: string[] | null;
  currentTask: string | null;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: string | null;
  channel: string | null;
  source: AgentSource;
  model: string | null;
  avatar: string | null;
  position: number;
  lastSeenAt: Date | null;
}

export interface RegisterInput {
  id: string;
  name: string;
  role?: string;
  model?: string;
  avatar?: string;
}

export type RegisterPlan =
  | { ok: true; created: boolean; row: RosterAgent }
  | { ok: false; status: 409; message: string };

export type DeletePlan =
  { ok: true } | { ok: false; status: 404; message: string };

export type HeartbeatPlan =
  { ok: true; row: RosterAgent } | { ok: false; status: 404; message: string };

/**
 * Optional POST /agents/:id/heartbeat fields. Absent keys stay as stored.
 * status idle, or currentTask null, blank, or whitespace only, clears the
 * task and sets status idle.
 */
export interface HeartbeatPatch {
  currentTask?: string | null;
  status?: string;
}

export interface StatusPatch {
  status?: string;
  currentTask?: string | null;
  recentActivity?: string | null;
  tasksCompleted?: number;
  totalCost?: number;
}

export interface NormalizedSnapshotAgent {
  id: string;
  name: string;
  role: string | null;
  color: string;
  status: string;
  parentName: string | null;
  emoji: string | null;
  personalityTags: string[] | null;
  currentTask: string | null;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: string | null;
  channel: string | null;
  statusPresent: {
    status: boolean;
    currentTask: boolean;
    recentActivity: boolean;
    tasksCompleted: boolean;
    totalCost: boolean;
  };
}

export interface SnapshotPlan {
  deleteIds: string[];
  creates: RosterAgent[];
  /** Full replacement of a snapshot owned row. parentId is applied separately. */
  snapshotWrites: RosterAgent[];
  /** Status fields only. Source, name, role, position, and visual stay. */
  statusWrites: { id: string; data: StatusPatch }[];
  parentLinks: { id: string; parentId: string | null }[];
}

export function codePointLength(value: string): number {
  return [...value].length;
}

export function isAgentSlug(id: string): boolean {
  return AGENT_SLUG.test(id);
}

/** UUID ids from the bridge backfill to snapshot. Everything else is default. */
export function backfillSource(id: string): 'default' | 'snapshot' {
  return SNAPSHOT_ID.test(id) ? 'snapshot' : 'default';
}

function asSource(value: string): AgentSource {
  if (value === 'snapshot' || value === 'registered' || value === 'default') {
    return value;
  }
  return 'default';
}

/**
 * Lowercase slug, 1 to 64 characters, a to z, 0 to 9, and underscores.
 * Empty or too long after trimming separators is null.
 */
export function slugFromName(raw: string): string | null {
  let slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  slug = slug.slice(0, 64).replace(/_+$/g, '');
  return isAgentSlug(slug) ? slug : null;
}

export function isOnline(
  source: string,
  lastSeenAt: Date | null,
  now: Date,
): boolean {
  if (source !== 'registered') return true;
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() < offlineAfterMs();
}

export function asRosterAgent(row: {
  id: string;
  name: string;
  color: string;
  role: string | null;
  status: string;
  parentId: string | null;
  emoji: string | null;
  personalityTags: unknown;
  currentTask: string | null;
  tasksCompleted: number;
  totalCost: number;
  recentActivity: string | null;
  channel: string | null;
  source: string;
  model: string | null;
  avatar: string | null;
  position: number;
  lastSeenAt: Date | null;
}): RosterAgent {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    role: row.role,
    status: row.status,
    parentId: row.parentId,
    emoji: row.emoji,
    personalityTags: tagsOrNull(row.personalityTags),
    currentTask: row.currentTask,
    tasksCompleted: row.tasksCompleted,
    totalCost: row.totalCost,
    recentActivity: row.recentActivity,
    channel: row.channel,
    source: asSource(row.source),
    model: row.model,
    avatar: row.avatar,
    position: row.position,
    lastSeenAt: row.lastSeenAt,
  };
}

export function planRegister(
  existing: readonly RosterAgent[],
  input: RegisterInput,
  now: Date,
): RegisterPlan {
  // Display names are not unique. A second bot named Forge keeps its own id.
  const current = existing.find((row) => row.id === input.id) ?? null;
  if (!current) {
    const position =
      existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    return {
      ok: true,
      created: true,
      row: {
        id: input.id,
        name: input.name,
        color: '#58A6FF',
        role: input.role ?? null,
        status: 'idle',
        parentId: null,
        emoji: null,
        personalityTags: null,
        currentTask: null,
        tasksCompleted: 0,
        totalCost: 0,
        recentActivity: null,
        channel: null,
        source: 'registered',
        model: input.model ?? null,
        avatar: input.avatar ?? null,
        position,
        lastSeenAt: now,
      },
    };
  }
  return {
    ok: true,
    created: false,
    row: {
      ...current,
      name: input.name,
      role: input.role !== undefined ? input.role : current.role,
      model: input.model !== undefined ? input.model : current.model,
      avatar: input.avatar !== undefined ? input.avatar : current.avatar,
      source: 'registered',
      lastSeenAt: now,
    },
  };
}

/** Null, blank, and whitespace only clear the task, same as status idle. */
function clearsTask(task: string | null | undefined): boolean {
  return task !== undefined && (task === null || task.trim() === '');
}

export function planHeartbeat(
  row: RosterAgent | null,
  now: Date,
  patch: HeartbeatPatch = {},
): HeartbeatPlan {
  if (!row || row.source !== 'registered') {
    return {
      ok: false,
      status: 404,
      message: row ? 'agent is not registered' : 'agent not found',
    };
  }
  const clear = patch.status === 'idle' || clearsTask(patch.currentTask);
  const nextTask = clear ? null : patch.currentTask;
  const nextStatus = clear ? 'idle' : patch.status;
  return {
    ok: true,
    row: {
      ...row,
      lastSeenAt: now,
      ...(nextTask !== undefined ? { currentTask: nextTask } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
    },
  };
}

export function planDelete(row: RosterAgent | null): DeletePlan {
  if (!row) return { ok: false, status: 404, message: 'agent not found' };
  return { ok: true };
}

export function normalizeSnapshotAgents(
  payload: Record<string, unknown>,
): NormalizedSnapshotAgent[] {
  const agents = Array.isArray(payload.agents) ? payload.agents : [];
  const used = new Set<string>();
  const out: NormalizedSnapshotAgent[] = [];
  for (const value of agents) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const name = clipName(optionalText(record.name) ?? 'agent');
    const id = uniqueSlug(snapshotId(record, name), used);
    const statusPresent = {
      status: 'status' in record,
      currentTask: 'currentTask' in record,
      recentActivity: 'recentActivity' in record,
      tasksCompleted: 'tasksCompleted' in record,
      totalCost: 'totalCost' in record,
    };
    out.push({
      id,
      name,
      role: optionalText(record.role),
      color: optionalText(record.color) ?? '#58A6FF',
      status: optionalText(record.status) ?? 'idle',
      parentName: optionalText(record.parent),
      emoji: optionalText(record.emoji),
      personalityTags: toTags(record.personalityTags),
      currentTask: optionalText(record.currentTask),
      tasksCompleted: finiteNumber(record.tasksCompleted, 0),
      totalCost: finiteNumber(record.totalCost, 0),
      recentActivity: optionalText(record.recentActivity),
      channel: optionalText(record.channel),
      statusPresent,
    });
  }
  return out;
}

export function planSnapshot(
  existing: readonly RosterAgent[],
  incoming: readonly NormalizedSnapshotAgent[],
): SnapshotPlan {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const matched = new Set<string>();
  let nextPosition =
    existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const creates: RosterAgent[] = [];
  const snapshotWrites: RosterAgent[] = [];
  const statusWrites: { id: string; data: StatusPatch }[] = [];
  const parentNames: { id: string; parentName: string | null }[] = [];

  for (const item of incoming) {
    // Identity is the id only. An entry with no id already carries the
    // slug of its name. A different id never claims a row by display name.
    const row = byId.get(item.id) ?? null;
    if (row) {
      matched.add(row.id);
      if (row.source === 'snapshot') {
        snapshotWrites.push(snapshotOwned(row, item));
        parentNames.push({ id: row.id, parentName: item.parentName });
      } else {
        // Default and registered rows take status fields only.
        // Parent stays where seed:demo or register put it.
        const data = statusPatch(item);
        if (Object.keys(data).length > 0) {
          statusWrites.push({ id: row.id, data });
        }
      }
      continue;
    }
    const created = blankSnapshot(item, nextPosition);
    nextPosition += 1;
    creates.push(created);
    matched.add(created.id);
    parentNames.push({ id: created.id, parentName: item.parentName });
  }

  const deleteIds = existing
    .filter((row) => row.source === 'snapshot' && !matched.has(row.id))
    .map((row) => row.id);
  const deleted = new Set(deleteIds);

  const nameToId = new Map<string, string>();
  for (const row of existing) {
    if (deleted.has(row.id)) continue;
    nameToId.set(row.name, row.id);
  }
  for (const row of creates) nameToId.set(row.name, row.id);
  for (const row of snapshotWrites) nameToId.set(row.name, row.id);

  const parentLinks = parentNames.map((link) => {
    const parentId =
      link.parentName && link.parentName.length > 0
        ? (nameToId.get(link.parentName) ?? null)
        : null;
    return {
      id: link.id,
      parentId: parentId === link.id ? null : parentId,
    };
  });

  return { deleteIds, creates, snapshotWrites, statusWrites, parentLinks };
}

/** Prisma JSON null, so an omitted tag list clears a snapshot owned row. */
export function tagsValue(
  tags: string[] | null,
): string[] | typeof Prisma.JsonNull {
  return tags ?? Prisma.JsonNull;
}

function snapshotOwned(
  row: RosterAgent,
  item: NormalizedSnapshotAgent,
): RosterAgent {
  return {
    ...row,
    name: item.name,
    role: item.role,
    color: item.color,
    status: item.status,
    emoji: item.emoji,
    personalityTags: item.personalityTags,
    currentTask: item.currentTask,
    tasksCompleted: item.tasksCompleted,
    totalCost: item.totalCost,
    recentActivity: item.recentActivity,
    channel: item.channel,
    source: 'snapshot',
  };
}

function blankSnapshot(
  item: NormalizedSnapshotAgent,
  position: number,
): RosterAgent {
  return {
    id: item.id,
    name: item.name,
    color: item.color,
    role: item.role,
    status: item.status,
    parentId: null,
    emoji: item.emoji,
    personalityTags: item.personalityTags,
    currentTask: item.currentTask,
    tasksCompleted: item.tasksCompleted,
    totalCost: item.totalCost,
    recentActivity: item.recentActivity,
    channel: item.channel,
    source: 'snapshot',
    model: null,
    avatar: null,
    position,
    lastSeenAt: null,
  };
}

function statusPatch(item: NormalizedSnapshotAgent): StatusPatch {
  const data: StatusPatch = {};
  if (item.statusPresent.status) data.status = item.status;
  if (item.statusPresent.currentTask) data.currentTask = item.currentTask;
  if (item.statusPresent.recentActivity) {
    data.recentActivity = item.recentActivity;
  }
  if (item.statusPresent.tasksCompleted) {
    data.tasksCompleted = item.tasksCompleted;
  }
  if (item.statusPresent.totalCost) data.totalCost = item.totalCost;
  return data;
}

function snapshotId(record: Record<string, unknown>, name: string): string {
  if (typeof record.id === 'string') {
    const trimmed = record.id.trim();
    if (isAgentSlug(trimmed)) return trimmed;
    const fromId = slugFromName(trimmed);
    if (fromId) return fromId;
  }
  return slugFromName(name) ?? 'agent';
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (n < 1000) {
    const suffix = `_${n}`;
    const cut = base.slice(0, 64 - suffix.length).replace(/_+$/g, '');
    const candidate = `${cut}${suffix}`;
    if (!used.has(candidate) && isAgentSlug(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
  return base;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = wireText(value).trim();
  return text ? text : null;
}

function clipName(name: string): string {
  const chars = [...name];
  return chars.length <= NAME_MAX ? name : chars.slice(0, NAME_MAX).join('');
}

function finiteNumber(value: unknown, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tagsOrNull(value: unknown): string[] | null {
  return toTags(value);
}

function toTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags = value.map((tag) => String(tag).trim()).filter((tag) => tag);
  return tags.length > 0 ? tags : null;
}
