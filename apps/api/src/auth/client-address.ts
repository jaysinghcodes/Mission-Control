/**
 * Who is calling, from the TCP socket.
 *
 * Loopback is the socket address only. A forwarded header never counts,
 * including X-Forwarded-For 127.0.0.1 from a trusted proxy.
 * X-Forwarded-For and X-Real-IP change the login bucket only when the
 * immediate peer is a trusted proxy or the bundled nginx.
 */

export interface ClientAddressInput {
  remoteAddress?: string | null;
  forwardedFor?: string | string[] | null;
  realIp?: string | string[] | null;
  trustedProxies?: string | null;
  bundledPeers?: string[] | null;
}

/** 127.0.0.0/8 and ::1. 0.0.0.0 and :: are not loopback. */
export function isLoopbackAddress(host: string | null | undefined): boolean {
  const bare = normalizeIp(host);
  if (!bare) return false;
  if (bare === '::1') return true;
  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return false;
  return nums[0] === 127;
}

/**
 * The login bucket for a direct client or the local listener.
 * The socket address wins. A trusted proxy, or the bundled nginx, may
 * supply the client hop. This value is not loopback and it does not
 * skip login. X-Forwarded-For is the chain. X-Real-IP is used only when
 * that chain is empty. The rightmost hop that is not itself trusted is
 * the client.
 */
export function clientAddress(input: ClientAddressInput): string | null {
  const peer = normalizeIp(input.remoteAddress);
  if (!peer) return null;
  const trusted = trustedEntries(input.trustedProxies, input.bundledPeers);
  if (trusted.length === 0 || !matchesTrusted(peer, trusted)) return peer;
  const forwarded = forwardedHops(input.forwardedFor);
  const hops = forwarded.length > 0 ? forwarded : forwardedHops(input.realIp);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i];
    if (!matchesTrusted(hop, trusted)) return hop;
  }
  return peer;
}

/** Loopback is the socket peer. Forwarded headers are ignored. */
export function requestIsLoopback(input: ClientAddressInput): boolean {
  return isLoopbackAddress(input.remoteAddress);
}

/** True for an IPv4 or IPv6 address. A label or an empty string is not. */
export function isIpAddress(host: string | null | undefined): boolean {
  const bare = normalizeIp(host);
  if (!bare) return false;
  if (bare.includes(':')) {
    if (!/^[0-9a-f:]+$/.test(bare)) return false;
    const halves = bare.split('::');
    return halves.length <= 2;
  }
  const parts = bare.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/** True when the socket peer itself is listed in TRUSTED_PROXY. */
export function isTrustedProxyPeer(
  remoteAddress: string | null | undefined,
  trustedProxies: string | null | undefined,
): boolean {
  const peer = normalizeIp(remoteAddress);
  if (!peer) return false;
  const trusted = parseTrusted(trustedProxies);
  return trusted.length > 0 && matchesTrusted(peer, trusted);
}

export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let bare = raw.trim().toLowerCase();
  if (!bare) return null;
  if (bare.startsWith('[') && bare.endsWith(']')) bare = bare.slice(1, -1);
  const zone = bare.indexOf('%');
  if (zone >= 0) bare = bare.slice(0, zone);
  if (bare.startsWith('::ffff:')) {
    const mapped = bare.slice('::ffff:'.length);
    if (mapped.includes('.')) bare = mapped;
  }
  return bare;
}

function forwardedHops(value: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const hops: string[] = [];
  for (const part of raw.split(',')) {
    const ip = normalizeIp(part);
    if (ip) hops.push(ip);
  }
  return hops;
}

function trustedEntries(
  trustedProxies: string | null | undefined,
  bundledPeers: string[] | null | undefined,
): string[] {
  const entries = parseTrusted(trustedProxies);
  for (const peer of bundledPeers ?? []) {
    const ip = normalizeIp(peer);
    if (ip && !entries.includes(ip)) entries.push(ip);
  }
  return entries;
}

function parseTrusted(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

function matchesTrusted(ip: string, trusted: string[]): boolean {
  return trusted.some((entry) => ipMatchesEntry(ip, entry));
}

function ipMatchesEntry(ip: string, entry: string): boolean {
  const normalized = normalizeIp(entry) ?? entry;
  if (normalized.includes('/')) return cidrContains(normalized, ip);
  return ip === normalized;
}

/** IPv4 CIDR only. A bad entry matches nothing. */
function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const network = ipv4ToInt(base);
  const address = ipv4ToInt(ip);
  if (network === null || address === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (network & mask) === (address & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}
