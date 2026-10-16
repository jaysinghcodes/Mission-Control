import { demoAgentId } from '../seed/demo-assignees';
import { calendarDay, shiftCalendarDay } from './aggregate-usage';
import { usageTimeZone, zoneClock, zoneWallTime } from './zone-time';

export interface DemoProvider {
  name: string;
  provider: string;
  model: string;
  bot: string;
  tokensIn: number;
  tokensOut: number;
  agents: string[];
  local?: boolean;
  /**
   * Marker on an untouched sample day. A usage.snapshot overwrite replaces
   * providers and drops this flag, so seed:clear leaves that day alone.
   */
  demo: true;
}

/** Stable id for one seeded usage day. The unique key in the table is still `day`. */
export function demoUsageId(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`demo usage day is not YYYY-MM-DD: ${day}`);
  }
  return `demo-usage-${day}`;
}

/**
 * True only for a usage row seed:demo created and nothing has overwritten.
 * The id prefix is not enough: the bridge updates that same row in place.
 */
export function isUntouchedDemoUsage(row: {
  id: string;
  providers: unknown;
}): boolean {
  if (!row.id.startsWith('demo-usage-')) return false;
  if (!Array.isArray(row.providers) || row.providers.length === 0) return false;
  return row.providers.every(
    (provider) =>
      !!provider &&
      typeof provider === 'object' &&
      (provider as { demo?: unknown }).demo === true,
  );
}

export interface DemoUsageBucket {
  day: string;
  at: Date;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: DemoProvider[];
}

/**
 * Sample lines. Model ids match config/prices.json except Ollama, which is
 * local and costs $0. Dollars are not stored: GET /usage prices the tokens.
 */
const LINES = [
  {
    bot: 'Quill',
    provider: 'openai',
    model: 'openai/gpt-4.1',
    tokensIn: 180_000,
    tokensOut: 36_000,
  },
  {
    bot: 'Sage',
    provider: 'anthropic',
    model: 'anthropic/claude-sonnet-4-6',
    tokensIn: 90_000,
    tokensOut: 18_000,
  },
  {
    bot: 'Nova',
    provider: 'deepseek',
    model: 'deepseek/deepseek-chat',
    tokensIn: 420_000,
    tokensOut: 70_000,
  },
  {
    bot: 'Lens',
    provider: 'google',
    model: 'google/gemini-2.5-flash',
    tokensIn: 260_000,
    tokensOut: 40_000,
  },
  {
    bot: 'Local',
    provider: 'ollama',
    model: 'ollama/llama3.1',
    tokensIn: 40_000,
    tokensOut: 8_000,
    local: true,
  },
] as const;

const CREW_BOTS = new Set([
  'Speedy',
  'Atlas',
  'Forge',
  'Sentinel',
  'Echo',
  'Pixel',
  'Bolt',
  'Ledger',
  'Quill',
  'Aegis',
  'Patch',
  'Scout',
]);

/** Sticker id for a crew bot. Other sample bots stay a label and draw generic. */
function stickerAgent(bot: string): string {
  return CREW_BOTS.has(bot) ? demoAgentId(bot) : bot;
}

/**
 * Place a past day at the same clock time as the seed.
 * If that clock time does not exist on the day, use one minute after midnight.
 */
function stampDay(
  day: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const at = zoneWallTime(day, hour, minute, timeZone);
  if (calendarDay(at, timeZone) === day) return at;
  return zoneWallTime(day, 0, 1, timeZone);
}

/**
 * Thirty daily buckets ending on `now` in `timeZone` (the API process zone).
 * Today's row is stamped at `now`. Earlier days use that same clock time.
 * No dollar amount is stored. The price table supplies it on read.
 */
export function demoUsageBuckets(
  now: Date,
  timeZone: string = usageTimeZone(),
): DemoUsageBucket[] {
  const today = calendarDay(now, timeZone);
  const clock = zoneClock(now, timeZone);
  const out: DemoUsageBucket[] = [];
  for (let ago = 0; ago < 30; ago++) {
    const day = shiftCalendarDay(today, -ago);
    const at =
      ago === 0 ? now : stampDay(day, clock.hour, clock.minute, timeZone);
    const scale = 1 + (ago % 5) * 0.08;
    const providers: DemoProvider[] = LINES.map((line) => ({
      name: line.provider,
      provider: line.provider,
      model: line.model,
      bot: line.bot,
      tokensIn: Math.round(line.tokensIn * scale),
      tokensOut: Math.round(line.tokensOut * scale),
      agents: [stickerAgent(line.bot)],
      local: 'local' in line ? line.local : undefined,
      demo: true,
    }));
    out.push({
      day,
      at,
      totalCost: 0,
      tokensIn: providers.reduce((sum, p) => sum + p.tokensIn, 0),
      tokensOut: providers.reduce((sum, p) => sum + p.tokensOut, 0),
      providers,
    });
  }
  return out;
}
