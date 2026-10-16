import { connect } from 'net';

/**
 * TCP probe of the OpenClaw gateway.
 *
 * Host and port come from the environment. The defaults are 127.0.0.1 and
 * 18789. A connect that succeeds is up. A refusal, timeout, or bad address
 * is down. Nothing here is a stored status.
 */

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18789;
const PROBE_TIMEOUT_MS = 800;

export interface GatewayTarget {
  host: string;
  port: number;
}

export interface GatewayProbe {
  host: string;
  port: number;
  up: boolean;
  latencyMs: number | null;
}

export function gatewayTarget(
  env: NodeJS.ProcessEnv = process.env,
): GatewayTarget {
  const hostRaw = (env.OPENCLAW_GATEWAY_HOST ?? '').trim();
  const host = isGatewayHost(hostRaw) ? hostRaw : DEFAULT_HOST;
  const port = parsePort(env.OPENCLAW_GATEWAY_PORT);
  return { host, port };
}

export function probeGateway(
  target: GatewayTarget = gatewayTarget(),
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<GatewayProbe> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (up: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        host: target.host,
        port: target.port,
        up,
        latencyMs: up ? Math.max(0, Date.now() - started) : null,
      });
    };
    const socket = connect({ host: target.host, port: target.port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function parsePort(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return DEFAULT_PORT;
  const port = Number(text);
  if (port < 1 || port > 65535) return DEFAULT_PORT;
  return port;
}

function isGatewayHost(value: string): boolean {
  if (!value || value.length > 253) return false;
  if (value.includes('/') || /\s/.test(value) || value.includes('\0')) {
    return false;
  }
  return /^[A-Za-z0-9.:-]+$/.test(value);
}
