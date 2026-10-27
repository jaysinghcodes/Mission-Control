import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLike } from '../search/escape-like';
import { TimezoneService } from '../time/timezone.service';
import { resolveTimeZone, zoneDay, zoneDayBounds } from '../usage/zone-time';

/**
 * MemoryController — read-only agent memory (ticket 5).
 *
 * Writes happen in memory.snapshot (bridge) and seed:demo. This controller
 * only lists and reads. An empty table is 200 with `entries: []`, which the
 * page renders as the empty state. 400 is a bad query. 404 is an unknown id.
 * Never a 200 body shaped like `{ error }`.
 *
 * Day filters use the saved timezone (the server timezone when unset),
 * so 23:58 and 00:02 land on different days, including across daylight saving.
 */

const KINDS = ['long-term', 'daily', 'other'] as const;
type MemoryKind = (typeof KINDS)[number];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Optional page size. Omitted means the whole filtered list (the Memory page). */
const MAX_LIMIT = 200;

type MemoryRow = {
  id: string;
  title: string;
  body: string;
  agent: string;
  createdAt: Date;
  kind: string;
  source: string | null;
  ref: string | null;
};

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly zones?: TimezoneService,
  ) {}

  private async timeZone(): Promise<string> {
    if (this.zones) return this.zones.current();
    return resolveTimeZone(null);
  }

  @Get()
  async list(
    @Query('day') day?: string,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const timeZone = await this.timeZone();
    const where = memoryListWhere(day, kind, q, timeZone);
    const take = parseLimit(limit);
    const skip = parseOffset(offset);
    const [rows, total] = await Promise.all([
      this.prisma.memoryEntry.findMany({
        where,
        // id is the tie-break so two notes saved in the same instant
        // stay in a stable order across pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(take != null ? { take } : {}),
        ...(skip ? { skip } : {}),
      }),
      this.prisma.memoryEntry.count({ where }),
    ]);
    return {
      entries: rows.map((row) => toListEntry(row, timeZone)),
      total,
      ts: Date.now(),
    };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await this.prisma.memoryEntry.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`memory "${id}" not found`);
    }
    return {
      entry: toDetailEntry(row, await this.timeZone()),
      ts: Date.now(),
    };
  }
}

/** Query object for GET /memory. */
function memoryListWhere(
  day?: string,
  kind?: string,
  q?: string,
  timeZone: string = resolveTimeZone(null),
) {
  const where: {
    kind?: MemoryKind;
    createdAt?: { gte: Date; lt: Date };
    OR?: {
      title?: { contains: string; mode: 'insensitive' };
      body?: { contains: string; mode: 'insensitive' };
      agent?: { contains: string; mode: 'insensitive' };
    }[];
  } = {};

  const dayText = (day ?? '').trim();
  if (dayText) {
    assertDay(dayText);
    const bounds = zoneDayBounds(dayText, timeZone);
    where.createdAt = { gte: bounds.start, lt: bounds.end };
  }

  const kindText = (kind ?? '').trim();
  if (kindText) {
    if (!KINDS.includes(kindText as MemoryKind)) {
      throw new BadRequestException('kind must be long-term, daily, or other');
    }
    where.kind = kindText as MemoryKind;
  }

  const query = (q ?? '').trim();
  if (query) {
    const pattern = escapeLike(query);
    const like = { contains: pattern, mode: 'insensitive' as const };
    where.OR = [{ title: like }, { body: like }, { agent: like }];
  }

  return where;
}

function parseLimit(raw?: string): number | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException('limit must be a non-negative integer');
  }
  const n = Number(text);
  if (n > MAX_LIMIT) {
    throw new BadRequestException(`limit must be at most ${MAX_LIMIT}`);
  }
  return n;
}

function parseOffset(raw?: string): number {
  const text = (raw ?? '').trim();
  if (!text) return 0;
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException('offset must be a non-negative integer');
  }
  return Number(text);
}

function assertDay(day: string): void {
  const match = DAY_RE.exec(day);
  if (!match) {
    throw new BadRequestException('day must be YYYY-MM-DD');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, date));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== date
  ) {
    throw new BadRequestException('day is not a real calendar date');
  }
}

export function memorySnippet(body: string, max = 180): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function toListEntry(row: MemoryRow, timeZone: string) {
  return {
    id: row.id,
    title: row.title,
    snippet: memorySnippet(row.body),
    agent: row.agent,
    createdAt: row.createdAt.toISOString(),
    day: zoneDay(row.createdAt, timeZone),
    kind: row.kind,
    source: row.source,
    ref: row.ref,
  };
}

function toDetailEntry(row: MemoryRow, timeZone: string) {
  return {
    ...toListEntry(row, timeZone),
    body: row.body,
  };
}
