import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeIp } from './client-address';

/**
 * The bundled nginx on the Compose network.
 *
 * docker-compose.yml names that service and passes it as BUNDLED_PROXY.
 * The documented default is the web service. The API resolves the hostname
 * and trusts forwarded client headers only from those addresses.
 * A native process with MC_COMPOSE unset trusts no extra peer.
 */

export const DEFAULT_BUNDLED_PROXY_HOST = 'web';

const REFRESH_MS = 5000;

let dnsPeers: string[] = [];
let dnsAt = 0;
let pending: Promise<string[]> | null = null;
const warned = new Set<string>();

export function resetBundledPeerCache(): void {
  dnsPeers = [];
  dnsAt = 0;
  pending = null;
  warned.clear();
}

/** Repo docker-compose.yml, from src/auth or dist/auth. */
export function defaultComposePath(start: string = __dirname): string {
  return resolve(start, '..', '..', '..', '..', 'docker-compose.yml');
}

/**
 * Service names whose image is the bundled web nginx.
 * The Compose DNS name is the service name. This does not guess an IP.
 */
export function nginxServiceNames(composeText: string): string[] {
  const lines = composeText.split(/\r?\n/);
  let inServices = false;
  let current: string | null = null;
  let buf: string[] = [];
  const names: string[] = [];
  const flush = (): void => {
    if (!current) return;
    const text = buf.join('\n');
    if (/dockerfile:\s*['"]?apps\/web\/Dockerfile['"]?/.test(text)) {
      names.push(current);
    }
  };
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*(?:#.*)?$/.test(line)) inServices = true;
      continue;
    }
    if (/^\S/.test(line)) {
      flush();
      current = null;
      buf = [];
      break;
    }
    const service = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (service) {
      flush();
      current = service[1];
      buf = [];
      continue;
    }
    if (current) buf.push(line);
  }
  flush();
  return names;
}

function splitList(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Hostnames or IPs to trust. An explicit BUNDLED_PROXY wins. Under Compose,
 * a blank value is the nginx service in the compose file, then the
 * documented default. Outside Compose a blank value trusts nothing.
 */
export function bundledProxyTokens(
  env: NodeJS.ProcessEnv = process.env,
  composeText?: string | null,
): string[] {
  const explicit = splitList(env.BUNDLED_PROXY);
  if (explicit.length > 0) return explicit;
  if (env.MC_COMPOSE !== '1') return [];
  if (typeof composeText === 'string') {
    const names = nginxServiceNames(composeText);
    if (names.length > 0) return names;
  }
  return [DEFAULT_BUNDLED_PROXY_HOST];
}

export function bundledProxyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return bundledProxyTokens(env).length > 0;
}

function isLiteralIp(token: string): boolean {
  const ip = normalizeIp(token);
  if (!ip) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return ip.split('.').every((part) => Number(part) <= 255);
  }
  return ip.includes(':') && /^[0-9a-f:]+$/.test(ip);
}

export function literalProxyPeers(raw: string | undefined): string[] {
  const ips: string[] = [];
  for (const token of splitList(raw)) {
    if (!isLiteralIp(token)) continue;
    const ip = normalizeIp(token);
    if (ip && !ips.includes(ip)) ips.push(ip);
  }
  return ips;
}

/** Literal BUNDLED_PROXY addresses plus the last DNS result. */
export function currentBundledPeers(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const ips = [...literalProxyPeers(env.BUNDLED_PROXY)];
  for (const ip of dnsPeers) {
    if (!ips.includes(ip)) ips.push(ip);
  }
  return ips;
}

function readComposeText(env: NodeJS.ProcessEnv): string | null {
  if (splitList(env.BUNDLED_PROXY).length > 0) return null;
  if (env.MC_COMPOSE !== '1') return null;
  const file = defaultComposePath();
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

function noteUnresolved(token: string, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'test') return;
  if (warned.has(token)) return;
  warned.add(token);
  console.warn(
    `bundled proxy ${token} did not resolve. Forwarded client addresses from that name are ignored.`,
  );
}

async function resolveToken(
  token: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  if (isLiteralIp(token)) {
    const ip = normalizeIp(token);
    return ip ? [ip] : [];
  }
  try {
    const records = await lookup(token, { all: true, verbatim: true });
    const ips: string[] = [];
    for (const record of records) {
      const ip = normalizeIp(record.address);
      if (ip && !ips.includes(ip)) ips.push(ip);
    }
    if (ips.length === 0) noteUnresolved(token, env);
    else warned.delete(token);
    return ips;
  } catch {
    noteUnresolved(token, env);
    return [];
  }
}

/**
 * Resolve bundled nginx hostnames. Literal IPs are stored too.
 * An empty result is not cached, so the next login tries again
 * after the web container appears.
 */
export async function refreshBundledPeers(
  env: NodeJS.ProcessEnv = process.env,
  force = false,
): Promise<string[]> {
  if (!force && pending) return pending;
  if (
    !force &&
    dnsAt !== 0 &&
    dnsPeers.length > 0 &&
    Date.now() - dnsAt < REFRESH_MS
  ) {
    return currentBundledPeers(env);
  }
  const run = (async (): Promise<string[]> => {
    const tokens = bundledProxyTokens(env, readComposeText(env));
    const ips: string[] = [];
    for (const token of tokens) {
      for (const ip of await resolveToken(token, env)) {
        if (!ips.includes(ip)) ips.push(ip);
      }
    }
    return ips;
  })();
  pending = run;
  try {
    const ips = await run;
    if (ips.length > 0) {
      dnsPeers = ips;
      dnsAt = Date.now();
    }
    return currentBundledPeers(env);
  } finally {
    if (pending === run) pending = null;
  }
}

/** Login awaits this when the cache is empty so the first try sees nginx. */
export async function ensureBundledPeers(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!bundledProxyConfigured(env)) return;
  if (currentBundledPeers(env).length > 0) return;
  await refreshBundledPeers(env, true);
}

export function scheduleBundledPeerRefresh(
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const timer = setInterval(() => {
    void refreshBundledPeers(env);
  }, REFRESH_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
