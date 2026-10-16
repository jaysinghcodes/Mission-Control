import { demoAgentId } from '../seed/demo-assignees';
import { shiftZoneDay, zoneDay, zoneDayBounds } from '../usage/zone-time';
import { buildDemoMemories } from './demo-memories';

const ZONE = 'America/Chicago';

const ROSTER = new Set(
  [
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
  ].map((name) => demoAgentId(name)),
);

function chicagoClock(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

describe('demo memories', () => {
  // 00:10 CDT on July 16. A note stamped later that morning would be in the future.
  const now = new Date('2026-07-16T05:10:00.000Z');

  it('uses fixed ids, several Chicago days, a long note, a 23:58 note, and a 50+ day', () => {
    const rows = buildDemoMemories(now, ZONE);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('demo-memory-'))).toBe(true);
    expect(
      buildDemoMemories(new Date('2026-01-16T06:02:00.000Z'), ZONE).map(
        (row) => row.id,
      ),
    ).toEqual(ids);

    const days = new Map<string, number>();
    for (const row of rows) {
      expect(ROSTER.has(row.agent)).toBe(true);
      expect(['long-term', 'daily', 'other']).toContain(row.kind);
      expect(new Date(row.createdAt).getTime()).toBeLessThanOrEqual(
        now.getTime(),
      );
      const day = zoneDay(row.createdAt, ZONE);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    expect(days.size).toBeGreaterThanOrEqual(3);
    expect([...days.values()].some((count) => count >= 50)).toBe(true);

    const long = rows.find((row) => row.id === 'demo-memory-long');
    expect(long?.agent).toBe('forge');
    expect(long && long.body.length).toBeGreaterThan(2500);
    expect(long?.body.includes('\n')).toBe(true);

    const midnight = rows.find((row) => row.id === 'demo-memory-midnight');
    expect(midnight).toBeDefined();
    expect(chicagoClock(midnight!.createdAt)).toBe('23:58');
    const day = zoneDay(midnight!.createdAt, ZONE);
    const nextMidnight = zoneDayBounds(shiftZoneDay(day, 1), ZONE).start;
    expect(
      nextMidnight.getTime() - new Date(midnight!.createdAt).getTime(),
    ).toBe(2 * 60_000);
    expect(
      zoneDay(
        new Date(
          new Date(midnight!.createdAt).getTime() + 4 * 60_000,
        ).toISOString(),
        ZONE,
      ),
    ).not.toBe(day);
    expect(rows.some((row) => row.agent === 'aegis')).toBe(true);
  });
});
