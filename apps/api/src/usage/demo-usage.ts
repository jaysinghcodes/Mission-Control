import { chicagoDay, chicagoWallTime, shiftChicagoDay } from '../memory/chicago-day';

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
  { name: 'zai', model: 'glm-5.2', agents: ['Speedy', 'Atlas', 'Quill'], cents: 40, tokensIn: 10_000, tokensOut: 4_000 },
  { name: 'deepseek', model: 'deepseek-v4-flash', agents: ['Forge', 'Sentinel', 'Pixel', 'Aegis'], cents: 25, tokensIn: 8_000, tokensOut: 3_000 },
  { name: 'ollama', model: 'qwen3:8b', agents: ['Ledger', 'Bolt'], cents: 0, tokensIn: 1_000, tokensOut: 400 },
] as const;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Thirty daily buckets ending on `now`'s America/Chicago date.
 * Noon Central, unless that instant is still in the future, in which case
 * today is stamped one minute before `now` so the rolling 24h window sees it.
 */
export function demoUsageBuckets(now: Date): DemoUsageBucket[] {
  const today = chicagoDay(now);
  const out: DemoUsageBucket[] = [];
  for (let ago = 0; ago < 30; ago++) {
    const day = shiftChicagoDay(today, -ago);
    let at = chicagoWallTime(day, 12, 0);
    if (at.getTime() > now.getTime()) at = new Date(now.getTime() - 60_000);
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
