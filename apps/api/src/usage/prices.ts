import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * USD per one million tokens. The shipped file is config/prices.json.
 * config/prices.local.json is gitignored and merged on top at read time,
 * so an edit changes totals without a rebuild.
 */
export interface ModelPrice {
  input: number;
  output: number;
}

export interface PriceTable {
  models: Record<string, ModelPrice>;
}

const EMPTY: PriceTable = { models: {} };

export function pricesDir(): string {
  const override = process.env.MC_PRICES_DIR?.trim();
  if (override) return override;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'config', 'prices.json'))) {
      return join(dir, 'config');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), 'config');
}

function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePriceTable(raw: unknown): PriceTable {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY;
  const modelsRaw = (raw as { models?: unknown }).models;
  if (!modelsRaw || typeof modelsRaw !== 'object' || Array.isArray(modelsRaw)) {
    return EMPTY;
  }
  const models: Record<string, ModelPrice> = {};
  for (const [key, value] of Object.entries(modelsRaw)) {
    const id = key.trim();
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const input = finite((value as { input?: unknown }).input);
    const output = finite((value as { output?: unknown }).output);
    if (input == null && output == null) continue;
    models[id] = {
      input: input ?? Number.NaN,
      output: output ?? Number.NaN,
    };
  }
  return { models };
}

/**
 * Local keys replace the same field. A missing field keeps the base value.
 * A model that exists only in the override is added.
 */
export function mergePriceTables(
  base: PriceTable,
  override: PriceTable,
): PriceTable {
  const models: Record<string, ModelPrice> = {};
  for (const [key, price] of Object.entries(base.models)) {
    models[key] = { ...price };
  }
  for (const [key, price] of Object.entries(override.models)) {
    const prev = models[key];
    models[key] = {
      input: Number.isFinite(price.input)
        ? price.input
        : (prev?.input ?? Number.NaN),
      output: Number.isFinite(price.output)
        ? price.output
        : (prev?.output ?? Number.NaN),
    };
  }
  return { models };
}

export function readPriceFile(path: string): PriceTable {
  if (!existsSync(path)) return EMPTY;
  try {
    return parsePriceTable(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return EMPTY;
  }
}

/** Base table plus the local override. Read on each call so a file edit applies immediately. */
export function loadPriceTable(dir = pricesDir()): PriceTable {
  const base = readPriceFile(join(dir, 'prices.json'));
  const localPath = join(dir, 'prices.local.json');
  if (!existsSync(localPath)) return base;
  return mergePriceTables(base, readPriceFile(localPath));
}

export function lookupPrice(
  table: PriceTable,
  model: string,
  provider: string,
): ModelPrice | null {
  const keys: string[] = [];
  const modelId = model.trim();
  const providerId = provider.trim();
  if (modelId) keys.push(modelId);
  if (providerId && modelId && !modelId.startsWith(`${providerId}/`)) {
    keys.push(`${providerId}/${modelId}`);
  }
  for (const key of keys) {
    const hit = table.models[key];
    if (!hit) continue;
    if (!Number.isFinite(hit.input) || !Number.isFinite(hit.output)) continue;
    return hit;
  }
  return null;
}

/** Tokens times the per million rates. Linear, so a sum of runs matches one combined line. */
export function tokenCost(
  tokensIn: number,
  tokensOut: number,
  price: ModelPrice,
): number {
  const raw = (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
  return Math.round(raw * 1_000_000) / 1_000_000;
}
