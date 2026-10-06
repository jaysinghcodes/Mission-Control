import { monthStartUtc } from './period-window'

describe('monthStartUtc', () => {
  it('is the first instant of the UTC month, not 30 days back', () => {
    // 2023-11-14T22:13:20.000Z — 20 days earlier is still October.
    const now = Date.UTC(2023, 10, 14, 22, 13, 20)
    const start = monthStartUtc(now)
    expect(new Date(start).toISOString()).toBe('2023-11-01T00:00:00.000Z')
    expect(now - start).toBeLessThan(30 * 86_400_000)
    expect(now - 20 * 86_400_000).toBeLessThan(start)
  })
})