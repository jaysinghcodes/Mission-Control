import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { usageBucketsFromPayload } from '../usage/usage-points';

/**
 * SnapshotsService — applies state snapshots pushed by the OpenClaw bridge.
 *
 * The bridge (an OpenClaw cron job) collects REAL state from the instance —
 * agent roster, sessions, cron jobs, usage, pending approvals — and POSTs it
 * as `*.snapshot` events. Each handler replaces the relevant table rows so
 * the dashboard always mirrors the live instance, never stale wireframes.
 */
@Injectable()
export class SnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replace the agent roster (family tree: main on top, sub-agents below).
   *
   * MC-200: accepts the new profile fields (emoji, personalityTags, currentTask,
   * tasksCompleted, totalCost, recentActivity, channel). Every one of them is
   * optional on the wire: absent fields fall back to schema defaults / null, so
   * legacy snapshots that predate MC-200 keep working unchanged (backward
   * compatible). personalityTags arrives as a JSON array of short strings and is
   * coerced defensively (never trusted raw) before being stored in the Json column.
   *
   * Order-independent tree wiring: rows are created WITHOUT parentId first, then
   * the parent links are set by name — a snapshot that lists children before
   * their parent used to violate Agent_parentId_fkey (inserts run sequentially);
   * two-phase wiring can't. The bridge already sends parents first, but relying
   * on producer ordering is fragile (GET /agents itself returns children first).
   */
  async applyAgents(payload: Record<string, unknown>): Promise<void> {
    const agents = Array.isArray(payload.agents)
      ? (payload.agents as Record<string, unknown>[])
      : [];
    // Bridge sends parent as a NAME; the FK column needs an id, so resolve names first.
    const ids = new Map<string, string>();
    for (const a of agents) {
      ids.set(String(a.name ?? 'unknown'), randomUUID());
    }
    await this.prisma.$transaction([
      this.prisma.agent.deleteMany({}),
      // Phase 1 — create every row without a parent edge (FK-safe in any order).
      ...agents.map((a) =>
        this.prisma.agent.create({
          data: {
            id: ids.get(String(a.name ?? 'unknown'))!,
            name: String(a.name ?? 'unknown'),
            color: String(a.color ?? '#58A6FF'),
            role: a.role ? String(a.role) : null,
            status: String(a.status ?? 'idle'),
            parentId: null,
            // MC-200 profile fields — optional on the wire; defaults/null when absent.
            emoji: a.emoji ? String(a.emoji) : null,
            personalityTags: toTags(a.personalityTags),
            currentTask: a.currentTask ? String(a.currentTask) : null,
            tasksCompleted:
              a.tasksCompleted != null ? Number(a.tasksCompleted) : undefined,
            totalCost: a.totalCost != null ? Number(a.totalCost) : undefined,
            recentActivity: a.recentActivity ? String(a.recentActivity) : null,
            channel: a.channel ? String(a.channel) : null,
          },
        }),
      ),
      // Phase 2 — wire the tree now that every row exists (name → fresh id).
      ...agents
        .filter((a) => a.parent && ids.has(String(a.parent)))
        .map((a) =>
          this.prisma.agent.update({
            where: { name: String(a.name ?? 'unknown') },
            data: { parentId: ids.get(String(a.parent))! },
          }),
        ),
    ]);
  }

  /** Replace the active sessions table. */
  async applySessions(payload: Record<string, unknown>): Promise<void> {
    const sessions = Array.isArray(payload.sessions)
      ? (payload.sessions as Record<string, unknown>[])
      : [];
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({}),
      ...sessions.map((s) =>
        this.prisma.session.create({
          data: {
            name: String(s.name ?? 'session'),
            agent: String(s.agent ?? 'main'),
            model: s.model ? String(s.model) : null,
            ctx: Number(s.ctx ?? 0),
            lastActivity: s.lastActivity ? String(s.lastActivity) : null,
            hot: Boolean(s.hot ?? false),
          },
        }),
      ),
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
            name: String(j.name ?? 'job'),
            schedule: j.schedule ? String(j.schedule) : null,
            day: j.day != null ? Number(j.day) : null,
            time: j.time ? String(j.time) : null,
            color: j.color ? String(j.color) : null,
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
  ): Promise<void> {
    const buckets = usageBucketsFromPayload(payload, now);
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
    const fresh = approvals.filter((a) => !decided.has(String(a.tag ?? '')));
    if (fresh.length > 0) {
      await this.prisma.approval.createMany({
        data: fresh.map((a) => ({
          kind: String(a.kind ?? 'exec'),
          tag: String(a.tag ?? 'Request'),
          desc: String(a.desc ?? ''),
          status: String(a.status ?? 'pending'),
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
    const rows = dedupeMemory(payload.entries.map(normalizeMemory).filter(isMemoryRow));
    // No storable rows means there is nobody to replace. Deleting here
    // would be a delete-all of every bridge note.
    if (rows.length === 0) return;
    const ids = rows.map((row) => row.id);
    const agents = [...new Set(rows.map((row) => row.agent))];
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
}

const MEMORY_KINDS = new Set(['long-term', 'daily', 'other']);

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
  const title = String(entry.title ?? '').trim().slice(0, 200);
  const body = typeof entry.body === 'string' ? entry.body : '';
  if (!title || !body.trim()) return null;
  const createdAt = new Date(String(entry.createdAt ?? ''));
  if (Number.isNaN(createdAt.getTime())) return null;
  const kindRaw = String(entry.kind ?? 'other');
  const kind = MEMORY_KINDS.has(kindRaw) ? kindRaw : 'other';
  const agent = String(entry.agent ?? 'agent').trim().slice(0, 120) || 'agent';
  const ref = entry.ref ? String(entry.ref).slice(0, 300) : null;
  // Every snapshot row is a bridge row. The replace below only deletes
  // source=bridge, so a payload cannot hide a note by labeling it demo.
  return { id, title, body, agent, createdAt, kind, source: 'bridge', ref };
}

/**
 * Coerce a snapshot's personalityTags into a stored Json value.
 *
 * Accepts an array of short strings (e.g. ["strategist","daily"]); anything
 * else (absent, null, non-array, garbage) becomes undefined so the field is
 * omitted from the insert (column → NULL) and the ingest never rejects a
 * snapshot over an unexpected tags shape. Items are stringified and trimmed;
 * empty strings are dropped.
 */
function toTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value.map((t) => String(t).trim()).filter((t) => t.length > 0);
  return tags.length > 0 ? tags : undefined;
}
