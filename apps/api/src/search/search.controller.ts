import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogLine, parseLogLine, tailNewestOpenclawLog } from '../logs/openclaw-log';

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
    const like = { contains: query, mode: 'insensitive' as const };

    const [tasks, tickets, agents, sessions, approvals, activity, logs] = await Promise.all([
      this.prisma.run.findMany({ where: { OR: [{ name: like }, { agent: like }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
      this.prisma.ticket.findMany({ where: { OR: [{ title: like }, { key: like }] }, orderBy: { createdAt: 'desc' }, take: 6 }),
      this.prisma.agent.findMany({ where: { OR: [{ name: like }, { role: like }] }, take: 6 }),
      this.prisma.session.findMany({ where: { OR: [{ name: like }, { agent: like }, { model: like }] }, take: 6 }),
      this.prisma.approval.findMany({ where: { OR: [{ tag: like }, { desc: like }] }, take: 6 }),
      this.prisma.activityEvent.findMany({ where: { OR: [{ type: like }, { payload: { path: ['name'], string_contains: query } }] }, orderBy: { ts: 'desc' }, take: 6 }),
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
