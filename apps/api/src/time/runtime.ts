/**
 * Operator knobs that used to be fixed in code.
 * Invalid values fall back to the documented default.
 */

function readBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** How long a registered bot can go without a heartbeat before it is offline. */
export function offlineAfterMs(): number {
  return readBoundedInt(
    process.env.OFFLINE_AFTER_MS,
    10 * 60 * 1000,
    1000,
    14 * 24 * 60 * 60 * 1000,
  );
}

/** How many calendar days of usage a snapshot may keep, through today. */
export function usageRetentionDays(): number {
  return readBoundedInt(process.env.USAGE_RETENTION_DAYS, 30, 1, 3660);
}

/**
 * Socket `health.tick` interval. `0` disables the ticker.
 * A blank or invalid value uses 30000.
 */
export function healthTickMs(): number {
  const raw = process.env.HEALTH_TICK_MS;
  if (raw == null || raw.trim() === '') return 30000;
  if (!/^\d+$/.test(raw.trim())) return 30000;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 24 * 60 * 60 * 1000) return 30000;
  return n;
}
