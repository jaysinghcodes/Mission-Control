import {
  chicagoDay,
  chicagoWallTime,
  shiftChicagoDay,
} from '../memory/chicago-day';

export interface DemoProvider {
  name: string;
  model: string;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  agents: string[];
}

export interface DemoUsageBucket {
  day: string;
  at: Date;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  providers: DemoProvider[];
}

const MODELS = [
  {
    name: 'zai',
    model: 'glm-5.2',
    agents: ['Speedy', 'Atlas', 'Quill'],
    cents: 40,
    tokensIn: 10_000,
    tokensOut: 4_000,
  },
  {
    name: 'deepseek',
    model: 'deepseek-v4-flash',
    agents: ['Forge', 'Sentinel', 'Pixel', 'Aegis'],
    cents: 25,
    tokensIn: 8_000,
    tokensOut: 3_000,
  },
  {
    name: 'ollama',
    model: 'qwen3:8b',
    agents: ['Ledger', 'Bolt'],
    cents: 0,
    tokensIn: 1_000,
    tokensOut: 400,
  },
] as const;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Hour and minute of `now` on the America/Chicago clock. */
function chicagoClock(now: Date): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  let hour = pick('hour');
  if (hour === 24) hour = 0;
  return { hour, minute: pick('minute') };
}

/**
 * Place a past day at the same Chicago clock time as the seed.
 * If that clock time does not exist on the day, use one minute after midnight.
 */
function stampDay(day: string, hour: number, minute: number): Date {
  const at = chicagoWallTime(day, hour, minute);
  if (chicagoDay(at) === day) return at;
  return chicagoWallTime(day, 0, 1);
}

/**
 * Thirty daily buckets ending on `now`'s America/Chicago date.
 * Today's spend is stamped at `now`. Earlier days use that same clock time.
 */
export function demoUsageBuckets(now: Date): DemoUsageBucket[] {
  const today = chicagoDay(now);
  const clock = chicagoClock(now);
  const out: DemoUsageBucket[] = [];
  for (let ago = 0; ago < 30; ago++) {
    const day = shiftChicagoDay(today, -ago);
    const at = ago === 0 ? now : stampDay(day, clock.hour, clock.minute);
    const wobble = ago % 4;
    const providers: DemoProvider[] = MODELS.map((model) => {
      const extra = model.cents === 0 ? 0 : wobble * 5;
      return {
        name: model.name,
        model: model.model,
        cost: (model.cents + extra) / 100,
        tokensIn: model.tokensIn + wobble * 100,
        tokensOut: model.tokensOut + wobble * 40,
        agents: [...model.agents],
      };
    });
    out.push({
      day,
      at,
      totalCost: round4(providers.reduce((sum, p) => sum + p.cost, 0)),
      tokensIn: providers.reduce((sum, p) => sum + p.tokensIn, 0),
      tokensOut: providers.reduce((sum, p) => sum + p.tokensOut, 0),
      providers,
    });
  }
  return out;
}
