import { aggregateUsage } from './aggregate-usage';
import {
  PRICE_NOT_SET,
  applyUsagePrices,
  groupPricedLines,
  priceRawLine,
  type RawUsageLine,
} from './price-usage';
import { parsePriceTable } from './prices';
import { usageBucketsFromPayload } from './usage-points';

const TABLE = parsePriceTable({
  models: {
    'openai/gpt-4.1': { input: 2, output: 8 },
    'ollama/llama3.1': { input: 5, output: 5 },
  },
});

function line(
  partial: Partial<RawUsageLine> & Pick<RawUsageLine, 'model'>,
): RawUsageLine {
  return {
    day: '2026-10-10',
    bot: 'Quill',
    provider: 'openai',
    model: 'openai/gpt-4.1',
    tokensIn: 1_000_000,
    tokensOut: 0,
    costUsd: null,
    reportedCost: null,
    local: false,
    ...partial,
  };
}

describe('priceRawLine', () => {
  it('uses tokens times the price table', () => {
    const priced = priceRawLine(
      line({ tokensIn: 1_000_000, tokensOut: 500_000 }),
      TABLE,
      new Set(),
    );
    expect(priced.cost).toBe(6);
    expect(priced.priceLabel).toBeNull();
  });

  it('lets a provider costUsd win over the table and over a local flag', () => {
    const reported = priceRawLine(
      line({ costUsd: 0.42, tokensIn: 1_000_000, tokensOut: 500_000 }),
      TABLE,
      new Set(),
    );
    expect(reported.cost).toBe(0.42);
    const localReported = priceRawLine(
      line({
        provider: 'ollama',
        model: 'ollama/llama3.1',
        costUsd: 1.25,
        local: true,
      }),
      TABLE,
      new Set(['ollama']),
    );
    expect(localReported.cost).toBe(1.25);
  });

  it('prices Ollama and any provider marked local at zero', () => {
    const ollama = priceRawLine(
      line({
        provider: 'ollama',
        model: 'ollama/llama3.1',
        tokensIn: 50_000,
        tokensOut: 8_000,
      }),
      TABLE,
      new Set(),
    );
    expect(ollama.cost).toBe(0);
    expect(ollama.priceLabel).toBeNull();
    expect(ollama.tokensIn).toBe(50_000);
    const marked = priceRawLine(
      line({
        provider: 'lmstudio',
        model: 'lmstudio/local-chat',
        tokensIn: 10,
        tokensOut: 4,
      }),
      TABLE,
      new Set(['lmstudio']),
    );
    expect(marked.cost).toBe(0);
  });

  it('labels an unknown model and still returns its tokens', () => {
    const priced = priceRawLine(
      line({
        provider: 'custom',
        model: 'custom/not-in-the-table',
        tokensIn: 1234,
        tokensOut: 56,
      }),
      TABLE,
      new Set(),
    );
    expect(priced.cost).toBeNull();
    expect(priced.priceLabel).toBe(PRICE_NOT_SET);
    expect(priced.priceLabel).toBe('Price not set');
    expect(priced.tokensIn).toBe(1234);
    expect(priced.tokensOut).toBe(56);
  });

  it('does not turn null, blank, or true into a zero price', () => {
    const table = parsePriceTable({
      models: {
        'custom/not-priced': { input: null, output: true },
        'custom/blank': { input: '', output: '' },
      },
    });
    for (const model of ['custom/not-priced', 'custom/blank']) {
      const priced = priceRawLine(
        line({
          provider: 'custom',
          model,
          tokensIn: 1_000_000,
          tokensOut: 1_000_000,
        }),
        table,
        new Set(),
      );
      expect(priced.cost).toBeNull();
      expect(priced.priceLabel).toBe('Price not set');
      expect(priced.tokensIn).toBe(1_000_000);
    }
  });
});

describe('groupPricedLines', () => {
  it('keeps day, bot, and model apart and sums a repeated line', () => {
    const priced = [
      line({
        day: '2026-10-09',
        bot: 'Quill',
        model: 'openai/gpt-4.1',
        tokensIn: 100,
        tokensOut: 10,
      }),
      line({
        day: '2026-10-10',
        bot: 'Quill',
        model: 'openai/gpt-4.1',
        tokensIn: 200,
        tokensOut: 20,
      }),
      line({
        day: '2026-10-10',
        bot: 'Sage',
        model: 'openai/gpt-4.1',
        tokensIn: 300,
        tokensOut: 30,
      }),
      line({
        day: '2026-10-10',
        bot: 'Quill',
        model: 'anthropic/claude-sonnet-4-6',
        provider: 'anthropic',
        tokensIn: 400,
        tokensOut: 40,
      }),
      line({
        day: '2026-10-10',
        bot: 'Quill',
        model: 'openai/gpt-4.1',
        tokensIn: 50,
        tokensOut: 5,
      }),
    ].map((raw) => priceRawLine(raw, TABLE, new Set()));
    const groups = groupPricedLines(priced);
    expect(groups.map((row) => [row.day, row.bot, row.model])).toEqual([
      ['2026-10-09', 'Quill', 'openai/gpt-4.1'],
      ['2026-10-10', 'Quill', 'anthropic/claude-sonnet-4-6'],
      ['2026-10-10', 'Quill', 'openai/gpt-4.1'],
      ['2026-10-10', 'Sage', 'openai/gpt-4.1'],
    ]);
    const repeated = groups.find(
      (row) =>
        row.day === '2026-10-10' &&
        row.bot === 'Quill' &&
        row.model === 'openai/gpt-4.1',
    );
    expect(repeated?.tokensIn).toBe(250);
    expect(repeated?.tokensOut).toBe(25);
    expect(repeated?.cost).toBe(
      priceRawLine(line({ tokensIn: 250, tokensOut: 25 }), TABLE, new Set())
        .cost,
    );
  });
});

describe('applyUsagePrices', () => {
  const now = Date.parse('2026-10-10T18:00:00.000Z');

  it('prices a window and leaves an unknown model out of the dollar total', () => {
    const agg = aggregateUsage(
      [
        {
          at: '2026-10-10T16:00:00.000Z',
          totalCost: 99,
          tokensIn: 1,
          tokensOut: 1,
          providers: [
            {
              bot: 'Quill',
              provider: 'openai',
              model: 'openai/gpt-4.1',
              tokensIn: 1_000_000,
              tokensOut: 0,
            },
            {
              bot: 'Nova',
              provider: 'custom',
              model: 'custom/mystery',
              tokensIn: 80,
              tokensOut: 20,
            },
          ],
        },
      ],
      '24h',
      now,
      'UTC',
    );
    const priced = applyUsagePrices(agg, TABLE, new Set());
    expect(priced.usage?.totalCost).toBe(2);
    expect(priced.usage?.priceLabel ?? null).toBeNull();
    const mystery = priced.usage?.groups?.find((row) => row.bot === 'Nova');
    expect(mystery?.priceLabel).toBe('Price not set');
    expect(mystery?.tokensIn).toBe(80);
    expect(mystery?.cost).toBeNull();
  });

  it('prices each run, then adds a reported cost to the table price', () => {
    const now = new Date('2026-10-16T18:00:00.000Z');
    const buckets = usageBucketsFromPayload(
      {
        points: [
          {
            at: '2026-10-16T15:00:00.000Z',
            tokensIn: 1_000_000,
            tokensOut: 1_000_000,
            providers: [
              {
                bot: 'Speedy',
                provider: 'deepseek',
                model: 'deepseek/deepseek-chat',
                tokensIn: 1_000_000,
                tokensOut: 1_000_000,
              },
            ],
          },
          {
            at: '2026-10-16T16:00:00.000Z',
            totalCost: 0.5,
            tokensIn: 1_000_000,
            tokensOut: 0,
            providers: [
              {
                bot: 'Speedy',
                provider: 'deepseek',
                model: 'deepseek/deepseek-chat',
                tokensIn: 1_000_000,
                tokensOut: 0,
                costUsd: 0.5,
              },
            ],
          },
        ],
      },
      now,
      'UTC',
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].providers).toHaveLength(2);
    const agg = aggregateUsage(
      buckets.map((bucket) => ({
        at: bucket.at,
        totalCost: bucket.totalCost,
        tokensIn: bucket.tokensIn,
        tokensOut: bucket.tokensOut,
        providers: bucket.providers,
      })),
      '24h',
      now.getTime(),
      'UTC',
    );
    const priced = applyUsagePrices(
      agg,
      parsePriceTable({
        models: {
          'deepseek/deepseek-chat': { input: 0.27, output: 1.1 },
        },
      }),
      new Set(),
    );
    expect(priced.usage?.totalCost).toBe(1.87);
    expect(priced.usage?.groups).toEqual([
      expect.objectContaining({
        day: '2026-10-16',
        bot: 'Speedy',
        model: 'deepseek/deepseek-chat',
        tokensIn: 2_000_000,
        tokensOut: 1_000_000,
        cost: 1.87,
        priceLabel: null,
      }),
    ]);
  });
});
