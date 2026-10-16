import { MemoryController } from '../memory/memory.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { TimezoneService } from './timezone.service';
import { usageBucketsFromPayload } from '../usage/usage-points';
import { canonicalTimeZone, timeZoneNames } from './timezones';
import {
  isValidTimeZone,
  resolveTimeZone,
  serverTimeZone,
  zoneDay,
} from '../usage/zone-time';

/**
 * TZ=Europe/Berlin buckets usage and memory on Berlin days.
 * 2026-01-15T23:30:00Z is 00:30 on 2026-01-16 in Berlin (CET, UTC+1)
 * and still 2026-01-15 in UTC.
 */

const INSTANT = new Date('2026-01-15T23:30:00.000Z');
const SUMMER = new Date('2026-07-15T22:30:00.000Z');

function memoryPrisma(createdAt: Date) {
  const rows = [
    {
      id: 'berlin-note',
      title: 'After midnight',
      body: 'Berlin day',
      agent: 'main',
      createdAt,
      kind: 'daily',
      source: 'bridge',
      ref: null,
    },
  ];
  const match = (where?: { createdAt?: { gte?: Date; lt?: Date } }) => {
    const created = where?.createdAt;
    if (!created) return rows;
    return rows.filter((row) => {
      const t = row.createdAt.getTime();
      if (created.gte && t < created.gte.getTime()) return false;
      if (created.lt && t >= created.lt.getTime()) return false;
      return true;
    });
  };
  const memoryEntry = {
    findMany: jest.fn(
      (args: { where?: { createdAt?: { gte?: Date; lt?: Date } } } = {}) =>
        Promise.resolve(match(args.where)),
    ),
    count: jest.fn(
      (args: { where?: { createdAt?: { gte?: Date; lt?: Date } } } = {}) =>
        Promise.resolve(match(args.where).length),
    ),
    findUnique: jest.fn(() => Promise.resolve(rows[0])),
  };
  return { memoryEntry } as unknown as PrismaService;
}

describe('TZ=Europe/Berlin', () => {
  const previous = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  it('uses the env zone when settings have not stored one', () => {
    expect(serverTimeZone()).toBe('Europe/Berlin');
    expect(resolveTimeZone(null)).toBe('Europe/Berlin');
    expect(resolveTimeZone('')).toBe('Europe/Berlin');
    expect(zoneDay(INSTANT, serverTimeZone())).toBe('2026-01-16');
    expect(zoneDay(SUMMER, serverTimeZone())).toBe('2026-07-16');
  });

  it('lets a saved zone override TZ', () => {
    expect(resolveTimeZone('UTC')).toBe('UTC');
    expect(zoneDay(INSTANT, resolveTimeZone('UTC'))).toBe('2026-01-15');
  });

  it('ignores an offset or abbreviation in TZ and in a saved zone', () => {
    expect(isValidTimeZone('+02:00')).toBe(false);
    expect(isValidTimeZone('CST')).toBe(false);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);

    process.env.TZ = '+02:00';
    expect(serverTimeZone()).not.toBe('+02:00');
    expect(isValidTimeZone(serverTimeZone())).toBe(true);
    expect(resolveTimeZone('+02:00')).toBe(serverTimeZone());
    expect(resolveTimeZone('CST')).toBe(serverTimeZone());

    process.env.TZ = 'CST';
    expect(serverTimeZone()).not.toBe('CST');
    expect(isValidTimeZone(serverTimeZone())).toBe(true);
    expect(resolveTimeZone('CST')).toBe(serverTimeZone());
  });

  it('converts Asia/Calcutta and keeps Asia/Kolkata and Europe/Kyiv on the same day', () => {
    const instant = new Date('2026-01-15T23:30:00.000Z');
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Europe/Kyiv')).toBe('Europe/Kyiv');
    expect(canonicalTimeZone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(zoneDay(instant, 'Asia/Kolkata')).toBe('2026-01-16');
    expect(zoneDay(instant, 'Europe/Kyiv')).toBe('2026-01-16');
    expect(zoneDay(instant, canonicalTimeZone('Asia/Calcutta')!)).toBe(
      zoneDay(instant, 'Asia/Kolkata'),
    );

    process.env.TZ = 'Asia/Calcutta';
    expect(serverTimeZone()).toBe('Asia/Kolkata');
    expect(zoneDay(instant, serverTimeZone())).toBe('2026-01-16');
    expect(resolveTimeZone('Europe/Kyiv')).toBe('Europe/Kyiv');
    expect(zoneDay(instant, resolveTimeZone('Europe/Kyiv'))).toBe('2026-01-16');
  });

  it('formats every shipped zone in Intl', () => {
    for (const name of timeZoneNames()) {
      expect(isValidTimeZone(name)).toBe(true);
      expect(() =>
        Intl.DateTimeFormat('en-US', { timeZone: name }).format(0),
      ).not.toThrow();
    }
  });

  it('buckets a usage point on the Berlin day', () => {
    const rows = usageBucketsFromPayload(
      {
        points: [
          {
            at: INSTANT.toISOString(),
            totalCost: 1.25,
            tokensIn: 10,
            tokensOut: 4,
            providers: [],
          },
        ],
      },
      new Date('2026-01-16T12:00:00.000Z'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe('2026-01-16');
  });

  it('buckets a memory row on the Berlin day', async () => {
    const controller = new MemoryController(memoryPrisma(INSTANT), {
      current: () => Promise.resolve(resolveTimeZone(null)),
    } as TimezoneService);
    const listed = await controller.list();
    expect(listed.entries[0].day).toBe('2026-01-16');
    const onDay = await controller.list('2026-01-16');
    expect(onDay.entries.map((entry) => entry.id)).toEqual(['berlin-note']);
    const previousDay = await controller.list('2026-01-15');
    expect(previousDay.entries).toEqual([]);
  });
});
