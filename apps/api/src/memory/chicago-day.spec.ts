import { chicagoDay, chicagoDayBounds } from './chicago-day';

/**
 * 23:58 and 00:02 Central stay on their own calendar days.
 * January is CST (UTC-6). July is CDT (UTC-5). March 8 2026 and
 * November 1 2026 are the DST transitions; midnight that weekend still
 * splits on the Chicago clock, not on UTC.
 */
describe('chicagoDay', () => {
  it('puts 23:58 and 00:02 on different days in standard time', () => {
    expect(chicagoDay('2026-01-16T05:58:00.000Z')).toBe('2026-01-15');
    expect(chicagoDay('2026-01-16T06:02:00.000Z')).toBe('2026-01-16');
  });

  it('puts 23:58 and 00:02 on different days during daylight time', () => {
    expect(chicagoDay('2026-07-16T04:58:00.000Z')).toBe('2026-07-15');
    expect(chicagoDay('2026-07-16T05:02:00.000Z')).toBe('2026-07-16');
  });

  it('keeps the split on the DST transition weekends', () => {
    // Spring forward is 2026-03-08 02:00 CST → 03:00 CDT. Midnight is still CST.
    expect(chicagoDay('2026-03-08T05:58:00.000Z')).toBe('2026-03-07');
    expect(chicagoDay('2026-03-08T06:02:00.000Z')).toBe('2026-03-08');
    // Fall back is 2026-11-01 02:00 CDT → 01:00 CST. Midnight is still CDT.
    expect(chicagoDay('2026-11-01T04:58:00.000Z')).toBe('2026-10-31');
    expect(chicagoDay('2026-11-01T05:02:00.000Z')).toBe('2026-11-01');
  });
});

describe('chicagoDayBounds', () => {
  it('includes 23:58 and excludes 00:02, in CST and CDT', () => {
    const winter = chicagoDayBounds('2026-01-15');
    expect(new Date('2026-01-16T05:58:00.000Z').getTime()).toBeGreaterThanOrEqual(winter.start.getTime());
    expect(new Date('2026-01-16T05:58:00.000Z').getTime()).toBeLessThan(winter.end.getTime());
    expect(new Date('2026-01-16T06:00:00.000Z').getTime()).toBe(winter.end.getTime());
    expect(new Date('2026-01-16T06:02:00.000Z').getTime()).toBeGreaterThanOrEqual(winter.end.getTime());

    const summer = chicagoDayBounds('2026-07-15');
    expect(new Date('2026-07-16T04:58:00.000Z').getTime()).toBeGreaterThanOrEqual(summer.start.getTime());
    expect(new Date('2026-07-16T04:58:00.000Z').getTime()).toBeLessThan(summer.end.getTime());
    expect(new Date('2026-07-16T05:00:00.000Z').getTime()).toBe(summer.end.getTime());
    expect(new Date('2026-07-16T05:02:00.000Z').getTime()).toBeGreaterThanOrEqual(summer.end.getTime());
  });
});
