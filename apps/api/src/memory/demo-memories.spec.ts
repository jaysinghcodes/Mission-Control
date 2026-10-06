import { chicagoDay } from './chicago-day';
import { DEMO_MEMORIES } from './demo-memories';

const ROSTER = new Set([
  'Speedy', 'Atlas', 'Forge', 'Sentinel', 'Echo', 'Pixel',
  'Bolt', 'Ledger', 'Quill', 'Aegis', 'Patch', 'Scout',
]);

describe('demo memories', () => {
  it('uses fixed ids, several Chicago days, a long note, a midnight note, and a 50+ day', () => {
    const ids = DEMO_MEMORIES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('demo-memory-'))).toBe(true);

    const days = new Map<string, number>();
    for (const row of DEMO_MEMORIES) {
      expect(ROSTER.has(row.agent)).toBe(true);
      expect(['long-term', 'daily', 'other']).toContain(row.kind);
      const day = chicagoDay(row.createdAt);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    expect(days.size).toBeGreaterThanOrEqual(3);
    const busy = [...days.values()].some((count) => count >= 50);
    expect(busy).toBe(true);

    const long = DEMO_MEMORIES.find((row) => row.id === 'demo-memory-long');
    expect(long?.agent).toBe('Forge');
    expect(long && long.body.length).toBeGreaterThan(2500);
    expect(long?.body.includes('\n')).toBe(true);

    const midnight = DEMO_MEMORIES.find((row) => row.id === 'demo-memory-midnight');
    expect(midnight?.createdAt).toBe('2026-01-16T05:58:00.000Z');
    expect(chicagoDay(midnight!.createdAt)).toBe('2026-01-15');
    expect(DEMO_MEMORIES.some((row) => row.agent === 'Aegis')).toBe(true);
  });
});
