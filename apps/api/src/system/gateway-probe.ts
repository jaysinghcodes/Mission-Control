import { connect } from 'net';
import { configuredGatewayPort, explicitGatewayHost } from './gateway-status';

/**
 * Direct TCP probe of the OpenClaw gateway.
 *
 * Host and port come from the environment. The defaults are 127.0.0.1 and
 * 18789. A connect that succeeds is up. A refusal, timeout, or bad address
 * is down. Compose does not use this probe unless OPENCLAW_GATEWAY_HOST is
 * set. That path reads the bridge report instead.
 */

const DEFAULT_HOST = '127.0.0.1';
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
  return {
    host: explicitGatewayHost(env) ?? DEFAULT_HOST,
    port: configuredGatewayPort(env),
  };
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
