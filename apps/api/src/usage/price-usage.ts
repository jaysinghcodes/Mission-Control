import type { AggregateResult, UsageProvider } from './aggregate-usage';
import { lookupPrice, tokenCost, type PriceTable } from './prices';

export const PRICE_NOT_SET = 'Price not set';
/** Shown next to the known total on System and Usage when any model has no price. */
export const PRICE_NOT_SET_SOME = 'Price not set for some models';

export interface RawUsageLine {
  day: string;
  bot: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  reportedCost: number | null;
  local: boolean;
}

export interface PricedUsageLine {
  day: string;
  bot: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  cost: number | null;
  priceLabel: string | null;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isLocalLine(
  line: Pick<RawUsageLine, 'provider' | 'model' | 'local'>,
  localProviders: ReadonlySet<string>,
): boolean {
  if (line.local) return true;
  const names = new Set<string>();
  const provider = (line.provider || '').trim().toLowerCase();
  if (provider) names.add(provider);
  const model = (line.model || '').trim();
  if (model.includes('/')) names.add(model.split('/')[0].trim().toLowerCase());
  for (const name of names) {
    if (name === 'ollama') return true;
    if (localProviders.has(name)) return true;
  }
  return false;
}

/**
 * One line of tokens.
 * A reported costUsd wins. Otherwise a local provider is $0.
 * Otherwise the price table. Otherwise the label is exactly "Price not set".
 * A legacy `cost` number is used only when none of those apply.
 */
export function priceRawLine(
  line: RawUsageLine,
  table: PriceTable,
  localProviders: ReadonlySet<string>,
): PricedUsageLine {
  const base = {
    day: line.day,
    bot: line.bot,
    model: line.model,
    provider: line.provider,
    tokensIn: line.tokensIn,
    tokensOut: line.tokensOut,
  };
  if (line.costUsd != null && Number.isFinite(line.costUsd)) {
    return { ...base, cost: round6(line.costUsd), priceLabel: null };
  }
  if (isLocalLine(line, localProviders)) {
    return { ...base, cost: 0, priceLabel: null };
  }
  const price = lookupPrice(table, line.model, line.provider);
  if (price) {
    return {
      ...base,
      cost: tokenCost(line.tokensIn, line.tokensOut, price),
      priceLabel: null,
    };
  }
  if (line.reportedCost != null && Number.isFinite(line.reportedCost)) {
    return { ...base, cost: round6(line.reportedCost), priceLabel: null };
  }
  return { ...base, cost: null, priceLabel: PRICE_NOT_SET };
}

/** Sum tokens and costs that share a day, bot, and model. */
export function groupPricedLines(lines: PricedUsageLine[]): PricedUsageLine[] {
  const byKey = new Map<string, PricedUsageLine>();
  for (const line of lines) {
    const key = `${line.day}\n${line.bot}\n${line.model}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...line });
      continue;
    }
    prev.tokensIn += line.tokensIn;
    prev.tokensOut += line.tokensOut;
    if (!prev.provider && line.provider) prev.provider = line.provider;
    const costs = [prev.cost, line.cost].filter(
      (n): n is number => n != null && Number.isFinite(n),
    );
    const unpriced =
      prev.priceLabel === PRICE_NOT_SET || line.priceLabel === PRICE_NOT_SET;
    if (unpriced && costs.length === 0) {
      prev.cost = null;
      prev.priceLabel = PRICE_NOT_SET;
    } else {
      prev.cost = round6(costs.reduce((sum, n) => sum + n, 0));
      prev.priceLabel = null;
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.bot.localeCompare(b.bot) ||
      a.model.localeCompare(b.model),
  );
}

export function rawLineFromProvider(
  day: string,
  raw: UsageProvider,
): RawUsageLine {
  const model = (raw.model || raw.name || 'unknown').trim() || 'unknown';
  const provider = (
    raw.provider ||
    (model.includes('/') ? model.split('/')[0] : raw.name) ||
    ''
  ).trim();
  const bot = (raw.bot || raw.agents?.[0] || 'No bot').trim() || 'No bot';
  const costUsd =
    typeof raw.costUsd === 'number' && Number.isFinite(raw.costUsd)
      ? raw.costUsd
      : null;
  const reportedCost =
    costUsd == null && typeof raw.cost === 'number' && Number.isFinite(raw.cost)
      ? raw.cost
      : null;
  return {
    day,
    bot,
    model,
    provider,
    tokensIn: Math.round(num(raw.tokensIn)),
    tokensOut: Math.round(num(raw.tokensOut)),
    costUsd,
    reportedCost,
    local: raw.local === true,
  };
}

interface PricedProvider {
  name?: string;
  model?: string;
  provider?: string;
  cost: number | null;
  priceLabel: string | null;
  tokensIn: number;
  tokensOut: number;
  agents: string[];
}

function rollupProviders(lines: PricedUsageLine[]): PricedProvider[] {
  const byModel = new Map<
    string,
    PricedProvider & { sawPrice: boolean; sawMissing: boolean }
  >();
  for (const line of lines) {
    const prev = byModel.get(line.model) ?? {
      name: line.provider || undefined,
      model: line.model,
      provider: line.provider || undefined,
      cost: 0,
      priceLabel: null,
      tokensIn: 0,
      tokensOut: 0,
      agents: [] as string[],
      sawPrice: false,
      sawMissing: false,
    };
    prev.tokensIn += line.tokensIn;
    prev.tokensOut += line.tokensOut;
    if (line.bot && line.bot !== 'No bot' && !prev.agents.includes(line.bot)) {
      prev.agents.push(line.bot);
    }
    if (line.priceLabel === PRICE_NOT_SET || line.cost == null) {
      prev.sawMissing = true;
    } else {
      prev.cost = round6((prev.cost ?? 0) + line.cost);
      prev.sawPrice = true;
    }
    byModel.set(line.model, prev);
  }
  return [...byModel.values()]
    .map((row) => {
      const missingOnly = row.sawMissing && !row.sawPrice;
      return {
        name: row.name,
        model: row.model,
        provider: row.provider,
        cost: missingOnly ? null : row.cost,
        priceLabel: missingOnly ? PRICE_NOT_SET : null,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        agents: row.agents,
      };
    })
    .sort((a, b) => (a.model || '').localeCompare(b.model || ''));
}

/**
 * The one cost function for a period. GET /usage returns it, and the System
 * header and the Usage page both read that response.
 * Replace stored dollar totals with the price table. totalCost is the known
 * total. When any model has no price, priceNote is exactly
 * "Price not set for some models" and unpricedModels names them, so a
 * missing price never reads as a plain $0.
 * Rows that have no lines keep the stored total (older snapshots and tests).
 */
export function applyUsagePrices(
  agg: AggregateResult,
  table: PriceTable,
  localProviders: ReadonlySet<string>,
): AggregateResult {
  const raw = agg.rawLines;
  if (!agg.usage || raw.length === 0) return agg;
  const lines = raw.map((line) => priceRawLine(line, table, localProviders));
  const unpricedModels = [
    ...new Set(
      lines
        .filter((line) => line.priceLabel === PRICE_NOT_SET)
        .map((line) => line.model),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const priced = groupPricedLines(lines);
  const known = priced.filter(
    (line): line is PricedUsageLine & { cost: number } => line.cost != null,
  );
  const allUnpriced = priced.length > 0 && known.length === 0;
  const totalCost = round6(known.reduce((sum, line) => sum + line.cost, 0));
  const byDay = new Map<string, number>();
  for (const line of known) {
    byDay.set(line.day, round6((byDay.get(line.day) ?? 0) + line.cost));
  }
  const dayLines = new Map<string, { all: number; unpriced: number }>();
  for (const line of priced) {
    const seen = dayLines.get(line.day) ?? { all: 0, unpriced: 0 };
    seen.all += 1;
    if (line.cost == null) seen.unpriced += 1;
    dayLines.set(line.day, seen);
  }
  const providers = rollupProviders(priced);
  return {
    ...agg,
    usage: {
      ...agg.usage,
      totalCost,
      priceLabel: allUnpriced ? PRICE_NOT_SET : null,
      priceNote: unpricedModels.length > 0 ? PRICE_NOT_SET_SOME : null,
      unpricedModels,
      tokensIn: priced.reduce((sum, line) => sum + line.tokensIn, 0),
      tokensOut: priced.reduce((sum, line) => sum + line.tokensOut, 0),
      providers,
      groups: priced,
    },
    days: agg.days.map((day) => {
      const seen = dayLines.get(day.day);
      const unpriced = seen ? seen.unpriced : 0;
      return {
        day: day.day,
        totalCost: byDay.get(day.day) ?? 0,
        priceLabel: seen && unpriced === seen.all ? PRICE_NOT_SET : null,
        priceNote: unpriced > 0 ? PRICE_NOT_SET_SOME : null,
      };
    }),
  };
}
