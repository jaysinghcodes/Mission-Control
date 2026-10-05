import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogLine, parseLogLine, tailNewestOpenclawLog } from '../logs/openclaw-log';
import { escapeLike } from './escape-like';

/**
 * SearchController — global dashboard search (topbar).
 *
 * Postgres ILIKE across all live tables (case-insensitive `contains`), plus a
 * tail-grep over the real gateway log. At this dataset size this is
 * sub-millisecond with zero extra infra; if the corpus ever outgrows Postgres
 * the endpoint can be swapped to Elasticsearch/Meilisearch behind the same
 * response shape without touching the UI.
 *
 * Ticket 2: the log group is OPTIONAL. On a machine without OpenClaw
 * (/tmp/openclaw missing — always the case inside docker unless mounted) the
 * log grep returns [] via the never-throwing `openclaw-log` helper, and the
 * response carries `logsAvailable: false` so the UI can say "no log source"
 * rather than implying the query matched nothing. DB groups are unaffected.
 *
 * QA-1 polish item 8 (QA-2 search):
 *  - `%` and `_` in the query now match LITERALLY (escapeLike). Prisma's
 *    `contains` passes them straight into LIKE, so `%%` used to return every
 *    row and `a_b` matched `axb`.
 *  - Activity search is case-insensitive on BOTH fields. `type` already used
 *    `mode: 'insensitive'`, but the event name lives in JSON
 *    (`payload.name`), and Prisma's JSON `string_contains` has no insensitive
 *    mode — so "deploy" missed "Deploy MC-151". That group now uses a small
 *    raw `ILIKE` query (see searchActivity).
 */
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async search(@Query('q') q?: string) {
    const query = (q ?? '').trim();
    const empty = { tasks: [], tickets: [], agents: [], sessions: [], approvals: [], activity: [], logs: [] };
    // `logsAvailable` is additive (old clients ignore it). For short queries we
    // skip all work, so we don't claim anything about the log source either.
    if (query.length < 2) {
      return { query, results: empty, logsAvailable: null, logsHint: null };
    }
    // Escaped once, used by every LIKE below (Prisma adds the surrounding %…%).
    const pattern = escapeLike(query);
    const like = { contains: pattern, mode: 'insensitive' as const };

    const [tasks, tickets, agents, sessions, approvals, activity, logs] = await Promise.all([
      this.prisma.run.findMany({ where: { OR: [{ name: like }, { agent: like }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
      this.prisma.ticket.findMany({ where: { OR: [{ title: like }, { key: like }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
      this.prisma.agent.findMany({ where: { OR: [{ name: like }, { role: like }] }, take: 6 }),
      this.prisma.session.findMany({ where: { OR: [{ name: like }, { agent: like }, { model: like }] }, take: 6 }),
      this.prisma.approval.findMany({ where: { OR: [{ tag: like }, { desc: like }] }, take: 6 }),
      this.searchActivity(pattern),
      Promise.resolve(this.grepLogs(query)),
    ]);

    return {
      query,
      results: { tasks, tickets, agents, sessions, approvals, activity, logs: logs.hits },
      logsAvailable: logs.available,
      // Human-readable reason when the log group is empty because there is no
      // log SOURCE (not because nothing matched). null when logs are available.
      logsHint: logs.available ? null : logs.reason,
    };
  }

  /**
   * Activity events whose `type` OR `payload.name` contains the query,
   * case-insensitively, newest first (item 8).
   *
   * Two steps on purpose:
   *  1. Raw SQL finds the matching ids. `payload->>'name'` extracts the JSON
   *     string as text so ILIKE can work on it. Backslash is Postgres'
   *     DEFAULT LIKE escape character, which is exactly what escapeLike
   *     emits, so `%`/`_` stay literal with no ESCAPE clause (one is
   *     deliberately not written: `'\\'` inside a JS template literal is
   *     an easy-to-botch double escape). `${needle}` is a
   *     BOUND parameter (tagged template), never string-concatenated SQL.
   *  2. Prisma loads those rows normally, so the response shape (Json
   *     payload, Date ts) is byte-for-byte what findMany returned before.
   */
  private async searchActivity(pattern: string) {
    const needle = `%${pattern}%`;
    const hits = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ActivityEvent"
      WHERE "type" ILIKE ${needle}
         OR ("payload"->>'name') ILIKE ${needle}
      ORDER BY "ts" DESC
      LIMIT 6`;
    if (hits.length === 0) return [];
    return this.prisma.activityEvent.findMany({
      where: { id: { in: hits.map((h) => h.id) } },
      orderBy: { ts: 'desc' },
    });
  }

  /**
   * Tail the newest gateway log (last 2000 lines) and keep lines containing
   * the query. Never throws: a missing /tmp/openclaw → `{ available: false, reason, hits: [] }`.
   */
  private grepLogs(query: string): { available: boolean; reason: string | null; hits: LogLine[] } {
    const tail = tailNewestOpenclawLog(2000);
    const needle = query.toLowerCase();
    const hits = tail.lines
      .map((line) => parseLogLine(line))
      .filter((l) => l.msg.toLowerCase().includes(needle))
      .slice(0, 6);
    return { available: tail.available, reason: tail.reason, hits };
  }
}
