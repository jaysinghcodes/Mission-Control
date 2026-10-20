/**
 * Gateway status for GET /system.
 *
 * Native installs probe OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT
 * (defaults 127.0.0.1 and 18789). Under Compose (MC_COMPOSE=1) a blank host
 * does not probe from inside the container. The host bridge posts
 * gateway.snapshot, and this report is what System shows. An explicit
 * OPENCLAW_GATEWAY_HOST probes that address directly and ignores the report.
 * OPENCLAW_GATEWAY_PORT is the port for whichever path is active. The bridge
 * always checks 127.0.0.1 on that port.
 *
 * A missing report, one older than GATEWAY_STATUS_MAX_AGE_MS, or one stored
 * before this API process started is unknown. A recreated API container
 * shows Unknown until the next bridge report.
 * A future checkedAt is limited to the time the API stored the row, so a
 * fast bridge clock cannot keep the gateway up past the max age.
 * Unknown is not down. Down is only a real check.
 */

const DEFAULT_PORT = 18789;
export const DEFAULT_GATEWAY_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_GATEWAY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type GatewayState = 'up' | 'down' | 'unknown';
export type GatewaySource = 'probe' | 'bridge';

export interface GatewayStatus {
  host: string;
  port: number;
  state: GatewayState;
  /** True only when state is up. False is unknown or down. Read state. */
  up: boolean;
  latencyMs: number | null;
  checkedAt: number | null;
  source: GatewaySource;
  version?: string;
}

export interface GatewayReport {
  up?: unknown;
  host?: unknown;
  port?: unknown;
  checkedAt?: unknown;
  latencyMs?: unknown;
  version?: unknown;
  /**
   * Unix ms when the API stored the row. Not part of the posted payload.
   * A future checkedAt is limited to this instant.
   */
  receivedAt?: unknown;
}

export function gatewayMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GATEWAY_STATUS_MAX_AGE_MS;
  if (raw == null || raw.trim() === '') return DEFAULT_GATEWAY_MAX_AGE_MS;
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_GATEWAY_MAX_AGE_MS;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > MAX_GATEWAY_MAX_AGE_MS) {
    return DEFAULT_GATEWAY_MAX_AGE_MS;
  }
  return n;
}

export function usesBridgeReport(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.MC_COMPOSE !== '1') return false;
  return !explicitGatewayHost(env);
}

export function explicitGatewayHost(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const host = (env.OPENCLAW_GATEWAY_HOST ?? '').trim();
  return isGatewayHost(host) ? host : null;
}

export function configuredGatewayPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePort(env.OPENCLAW_GATEWAY_PORT);
}

export function gatewayStatusFromProbe(
  probe: { host: string; port: number; up: boolean; latencyMs: number | null },
  checkedAt: number,
): GatewayStatus {
  return {
    host: probe.host,
    port: probe.port,
    state: probe.up ? 'up' : 'down',
    up: probe.up,
    latencyMs: probe.latencyMs,
    checkedAt,
    source: 'probe',
  };
}

/** Unix ms when this API process started. */
export const API_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

/**
 * Bridge report. No report, a report that is not a real check, or a report
 * older than maxAgeMs is unknown. Age equal to maxAgeMs is still fresh.
 * A future checkedAt is limited to receivedAt. An earlier checkedAt still
 * ages from that earlier time. When startedAt is given, a report the API
 * stored before that instant is unknown too. Without receivedAt, checkedAt
 * is compared instead.
 */
export function gatewayStatusFromReport(
  report: GatewayReport | null,
  now: number,
  maxAgeMs: number,
  fallbackPort: number,
  startedAt?: number,
): GatewayStatus {
  const port = reportPort(report, fallbackPort);
  const unknown = (checkedAt: number | null): GatewayStatus => ({
    host: '127.0.0.1',
    port,
    state: 'unknown',
    up: false,
    latencyMs: null,
    checkedAt,
    source: 'bridge',
  });
  if (!report || typeof report.up !== 'boolean') return unknown(null);
  const checkedAt = finiteTimestamp(report.checkedAt);
  if (checkedAt == null) return unknown(null);
  const receivedAt = finiteTimestamp(report.receivedAt);
  const basis =
    receivedAt == null ? checkedAt : Math.min(checkedAt, receivedAt);
  const age = now - basis;
  if (age > maxAgeMs) return unknown(checkedAt);
  const stored = receivedAt ?? checkedAt;
  if (
    typeof startedAt === 'number' &&
    Number.isFinite(startedAt) &&
    stored < startedAt
  ) {
    return unknown(checkedAt);
  }
  const host =
    typeof report.host === 'string' && isGatewayHost(report.host)
      ? report.host
      : '127.0.0.1';
  const latency =
    report.up &&
    typeof report.latencyMs === 'number' &&
    Number.isFinite(report.latencyMs)
      ? Math.max(0, Math.round(report.latencyMs))
      : null;
  const version =
    typeof report.version === 'string' && report.version.trim()
      ? report.version.trim().slice(0, 80)
      : undefined;
  return {
    host,
    port: reportPort(report, fallbackPort),
    state: report.up ? 'up' : 'down',
    up: report.up,
    latencyMs: latency,
    checkedAt,
    source: 'bridge',
    ...(version ? { version } : {}),
  };
}

function finiteTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function isGatewayHost(value: string): boolean {
  if (!value || value.length > 253) return false;
  if (value.includes('/') || /\s/.test(value) || value.includes('\0')) {
    return false;
  }
  return /^[A-Za-z0-9.:-]+$/.test(value);
}

function parsePort(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return DEFAULT_PORT;
  const port = Number(text);
  if (port < 1 || port > 65535) return DEFAULT_PORT;
  return port;
}

function reportPort(
  report: GatewayReport | null,
  fallbackPort: number,
): number {
  if (
    !report ||
    typeof report.port !== 'number' ||
    !Number.isInteger(report.port)
  ) {
    return fallbackPort;
  }
  if (report.port < 1 || report.port > 65535) return fallbackPort;
  return report.port;
}
