import { readFileSync } from 'fs';
import { join } from 'path';
import { aggregateUsage, type UsageProvider } from './aggregate-usage';
import {
  PRICE_NOT_SET,
  PRICE_NOT_SET_SOME,
  applyUsagePrices,
} from './price-usage';
import { loadPriceTable, lookupPrice, readPriceFile } from './prices';

/**
 * The shipped config/prices.json, read the way the API reads it.
 * One cost function: applyUsagePrices. GET /usage returns it, and the System
 * header and Usage both format that response with apps/web/src/lib/cost.ts.
 */
const CONFIG = join(__dirname, '..', '..', '..', '..', 'config');
const SHIPPED = readPriceFile(join(CONFIG, 'prices.json'));
const NOW = Date.parse('2026-10-20T18:00:00.000Z');

function priced(providers: UsageProvider[], local = new Set<string>()) {
  const agg = aggregateUsage(
    [
      {
        at: '2026-10-20T16:00:00.000Z',
        totalCost: 0,
        tokensIn: 0,
        tokensOut: 0,
        providers,
      },
    ],
    '24h',
    NOW,
    'UTC',
  );
  return applyUsagePrices(agg, SHIPPED, local).usage;
}

describe('shipped config/prices.json', () => {
  it('has a source date and a source for each provider', () => {
    const raw = JSON.parse(
      readFileSync(join(CONFIG, 'prices.json'), 'utf8'),
    ) as {
      sourceDate?: string;
      sources?: Record<string, string>;
    };
    expect(raw.sourceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const provider of [
      'openai',
      'anthropic',
      'google',
      'deepseek',
      'openrouter',
    ]) {
      expect(raw.sources?.[provider]).toMatch(/^https:\/\//);
    }
  });

  it('prices current DeepSeek, OpenAI, Anthropic, Gemini and OpenRouter defaults', () => {
    const cases: [string, string][] = [
      ['deepseek-v4-flash', 'deepseek'],
      ['deepseek/deepseek-v4-flash', 'deepseek'],
      ['deepseek/deepseek-flash', 'deepseek'],
      ['deepseek/deepseek-v4-pro', 'deepseek'],
      ['openai/gpt-6-sol', 'openai'],
      ['openai/gpt-4.1', 'openai'],
      ['anthropic/claude-sonnet-5', 'anthropic'],
      ['anthropic/claude-opus-5-5', 'anthropic'],
      ['anthropic/claude-sonnet-4-6', 'anthropic'],
      ['google/gemini-3.8-flash', 'google'],
      ['google/gemini-2.5-flash', 'google'],
      ['openrouter/anthropic/claude-sonnet-4-6', 'openrouter'],
      ['openrouter/deepseek/deepseek-v4-flash', 'openrouter'],
    ];
    for (const [model, provider] of cases) {
      const price = lookupPrice(SHIPPED, model, provider);
      expect([model, Number.isFinite(price?.input)]).toEqual([model, true]);
      expect([model, Number.isFinite(price?.output)]).toEqual([model, true]);
    }
  });

  it('loads through loadPriceTable with the shipped dir', () => {
    expect(
      lookupPrice(loadPriceTable(CONFIG), 'deepseek-v4-flash', 'deepseek'),
    ).not.toBeNull();
  });

  it('prices a deepseek-v4-flash run', () => {
    const usage = priced([
      {
        bot: 'Speedy',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
      },
    ]);
    expect(usage?.totalCost).toBe(1.5);
    expect(usage?.priceLabel ?? null).toBeNull();
    expect(usage?.priceNote ?? null).toBeNull();
    expect(usage?.unpricedModels).toEqual([]);
  });

  it('an unpriced model keeps the known total and sets the note', () => {
    const usage = priced([
      {
        bot: 'Speedy',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        tokensIn: 1_000_000,
        tokensOut: 0,
      },
      {
        bot: 'Nova',
        provider: 'custom',
        model: 'custom/mystery',
        tokensIn: 500,
        tokensOut: 500,
      },
    ]);
    expect(usage?.totalCost).toBe(0.3);
    expect(usage?.priceLabel ?? null).toBeNull();
    expect(usage?.priceNote).toBe(PRICE_NOT_SET_SOME);
    expect(PRICE_NOT_SET_SOME).toBe('Price not set for some models');
    expect(usage?.unpricedModels).toEqual(['custom/mystery']);
  });

  it('a local model next to an unpriced model is not a plain $0', () => {
    const usage = priced([
      {
        bot: 'Quill',
        provider: 'ollama',
        model: 'ollama/llama3.1',
        tokensIn: 9_000,
        tokensOut: 9_000,
      },
      {
        bot: 'Nova',
        provider: 'custom',
        model: 'custom/mystery',
        tokensIn: 500,
        tokensOut: 500,
      },
    ]);
    expect(usage?.totalCost).toBe(0);
    expect(usage?.priceNote).toBe(PRICE_NOT_SET_SOME);
  });

  it('only unpriced models read Price not set and keep the note', () => {
    const usage = priced([
      {
        bot: 'Nova',
        provider: 'custom',
        model: 'custom/mystery',
        tokensIn: 500,
        tokensOut: 500,
      },
    ]);
    expect(usage?.priceLabel).toBe(PRICE_NOT_SET);
    expect(usage?.priceNote).toBe(PRICE_NOT_SET_SOME);
  });

  it('local models still cost $0 with no note', () => {
    const usage = priced(
      [
        {
          bot: 'Quill',
          provider: 'ollama',
          model: 'ollama/llama3.1',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
        },
        {
          bot: 'Sage',
          provider: 'lmstudio',
          model: 'lmstudio/qwen3',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
        },
        {
          bot: 'Pip',
          provider: 'anything',
          model: 'anything/box',
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
          local: true,
        },
      ],
      new Set(['lmstudio']),
    );
    expect(usage?.totalCost).toBe(0);
    expect(usage?.priceLabel ?? null).toBeNull();
    expect(usage?.priceNote ?? null).toBeNull();
    for (const row of usage?.groups ?? []) expect(row.cost).toBe(0);
  });
});
