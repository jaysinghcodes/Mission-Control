import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadPriceTable,
  lookupPrice,
  mergePriceTables,
  parsePriceTable,
  tokenCost,
} from './prices';

const BASE = parsePriceTable({
  unit: 'usd_per_million_tokens',
  models: {
    'openai/gpt-4.1': { input: 2, output: 8 },
    'anthropic/claude-sonnet-4-6': { input: 3, output: 15 },
  },
});

describe('tokenCost', () => {
  it('multiplies input and output tokens by the per million rates', () => {
    const price = lookupPrice(BASE, 'openai/gpt-4.1', 'openai');
    expect(price).toEqual({ input: 2, output: 8 });
    expect(tokenCost(1_000_000, 500_000, price!)).toBe(6);
    expect(tokenCost(180_000, 36_000, price!)).toBe(0.648);
  });

  it('looks up provider/model when the line stores the bare model id', () => {
    expect(lookupPrice(BASE, 'gpt-4.1', 'openai')).toEqual({
      input: 2,
      output: 8,
    });
    expect(lookupPrice(BASE, 'missing-model', 'openai')).toBeNull();
  });
});

describe('mergePriceTables', () => {
  it('lets the override replace one field and add a model', () => {
    const override = parsePriceTable({
      models: {
        'openai/gpt-4.1': { input: 1 },
        'google/gemini-2.5-flash': { input: 0.15, output: 0.6 },
      },
    });
    const merged = mergePriceTables(BASE, override);
    expect(merged.models['openai/gpt-4.1']).toEqual({ input: 1, output: 8 });
    expect(merged.models['anthropic/claude-sonnet-4-6']).toEqual({
      input: 3,
      output: 15,
    });
    expect(merged.models['google/gemini-2.5-flash']).toEqual({
      input: 0.15,
      output: 0.6,
    });
  });

  it('reads prices.local.json on top of prices.json without a rebuild', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-prices-'));
    writeFileSync(
      join(dir, 'prices.json'),
      JSON.stringify({
        models: { 'openai/gpt-4.1': { input: 2, output: 8 } },
      }),
    );
    expect(loadPriceTable(dir).models['openai/gpt-4.1'].input).toBe(2);
    writeFileSync(
      join(dir, 'prices.local.json'),
      JSON.stringify({
        models: { 'openai/gpt-4.1': { output: 1 } },
      }),
    );
    const next = loadPriceTable(dir);
    expect(next.models['openai/gpt-4.1']).toEqual({ input: 2, output: 1 });
    expect(tokenCost(0, 1_000_000, next.models['openai/gpt-4.1'])).toBe(1);
  });

  it('treats null, blank, and true in the override as missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-prices-'));
    writeFileSync(
      join(dir, 'prices.json'),
      JSON.stringify({
        models: { 'openai/gpt-4.1': { input: 2, output: 8 } },
      }),
    );
    for (const bad of [null, '', true]) {
      writeFileSync(
        join(dir, 'prices.local.json'),
        JSON.stringify({
          models: { 'openai/gpt-4.1': { output: bad } },
        }),
      );
      expect(loadPriceTable(dir).models['openai/gpt-4.1']).toEqual({
        input: 2,
        output: 8,
      });
    }
    writeFileSync(
      join(dir, 'prices.local.json'),
      JSON.stringify({
        models: {
          'openai/gpt-4.1': { input: 1, output: null },
          'custom/not-priced': { input: null, output: true },
          'custom/blank': { input: '', output: '' },
        },
      }),
    );
    const table = loadPriceTable(dir);
    expect(table.models['openai/gpt-4.1']).toEqual({ input: 1, output: 8 });
    expect(lookupPrice(table, 'custom/not-priced', 'custom')).toBeNull();
    expect(lookupPrice(table, 'custom/blank', 'custom')).toBeNull();
    expect(table.models['custom/not-priced']?.input ?? null).not.toBe(0);
    expect(table.models['custom/blank']?.output ?? null).not.toBe(0);
  });

  it('ignores a missing override file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-prices-'));
    writeFileSync(
      join(dir, 'prices.json'),
      JSON.stringify({
        models: { 'openai/gpt-4.1': { input: 2, output: 8 } },
      }),
    );
    expect(loadPriceTable(dir).models['openai/gpt-4.1'].output).toBe(8);
  });
});
