import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { currentBundledPeers } from './bundled-proxy';
import {
  clientAddress,
  isTrustedProxyPeer,
  requestIsLoopback,
} from './client-address';
import { configuredSessionSecret, passwordMatches } from './password';
import { currentSessionVersion, effectivePasswordHash } from './session-state';

export const SESSION_COOKIE = 'mc_session';
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionStatus {
  authenticated: boolean;
  loginRequired: boolean;
}

export function sessionMaxAgeSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SESSION_MAX_AGE_SECONDS;
  if (typeof raw !== 'string' || raw.trim() === '')
    return DEFAULT_MAX_AGE_SECONDS;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 60 || n > 60 * 60 * 24 * 30) {
    return DEFAULT_MAX_AGE_SECONDS;
  }
  return n;
}

export function trustedProxyList(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TRUSTED_PROXY;
  return typeof raw === 'string' ? raw : '';
}

export interface LoopbackRequest {
  socket?: { remoteAddress?: string | null };
  headers: {
    cookie?: string | string[];
    'x-forwarded-for'?: string | string[];
    'x-real-ip'?: string | string[];
  };
}

export function requestLoopback(
  req: LoopbackRequest,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return requestIsLoopback({
    remoteAddress: req.socket?.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'],
    realIp: req.headers['x-real-ip'],
    trustedProxies: trustedProxyList(env),
    bundledPeers: currentBundledPeers(env),
  });
}

export function sessionStatus(
  req: LoopbackRequest,
  env: NodeJS.ProcessEnv = process.env,
): SessionStatus {
  const loopback = requestLoopback(req, env);
  const authenticated = validSession(req.headers.cookie, env);
  if (loopback) return { authenticated: true, loginRequired: false };
  return { authenticated, loginRequired: true };
}

export function loginWithPassword(
  password: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (typeof password !== 'string') return null;
  const hash = effectivePasswordHash(env);
  const secret = configuredSessionSecret(env);
  if (!hash || !secret) return null;
  if (!passwordMatches(password, hash)) return null;
  return signSession(
    secret,
    sessionMaxAgeSeconds(env),
    Date.now(),
    currentSessionVersion(env),
  );
}

export function validSession(
  cookieHeader: string | string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = configuredSessionSecret(env);
  const hash = effectivePasswordHash(env);
  if (!secret || !hash) return false;
  const header = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader;
  const token = readCookie(header, SESSION_COOKIE);
  if (!token) return false;
  return verifySession(token, secret, Date.now(), currentSessionVersion(env));
}

export function applySessionCookie(
  res: Pick<Response, 'setHeader' | 'req'>,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const maxAge = sessionMaxAgeSeconds(env);
  res.setHeader(
    'Set-Cookie',
    serializeCookie(token, maxAge, cookieSecure(res.req)),
  );
}

export function clearSessionCookie(
  res: Pick<Response, 'setHeader' | 'req'>,
): void {
  res.setHeader('Set-Cookie', serializeCookie('', 0, cookieSecure(res.req)));
}

export function signSession(
  secret: string,
  maxAgeSeconds: number,
  now = Date.now(),
  version = currentSessionVersion(),
): string {
  // `v` is the session version. Logout and a password change bump it.
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(now / 1000) + maxAgeSeconds,
      v: version,
    }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
  version = currentSessionVersion(),
): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  if (!timingSafeEqual(got, want)) return false;
  try {
    const body = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as {
      exp?: unknown;
      v?: unknown;
    };
    if (typeof body.v !== 'number' || !Number.isInteger(body.v)) return false;
    if (body.v !== version) return false;
    if (typeof body.exp !== 'number' || !Number.isFinite(body.exp))
      return false;
    return body.exp * 1000 > now;
  } catch {
    return false;
  }
}

export function peerAddress(
  req: Pick<Request, 'socket' | 'headers'>,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return clientAddress({
    remoteAddress: req.socket?.remoteAddress,
    forwardedFor: req.headers['x-forwarded-for'],
    realIp: req.headers['x-real-ip'],
    trustedProxies: trustedProxyList(env),
    bundledPeers: currentBundledPeers(env),
  });
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (typeof header !== 'string' || header.length === 0) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function cookieSecure(req: Request | undefined): boolean {
  if (!req) return false;
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  const first = (typeof proto === 'string' ? proto : '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (first !== 'https') return false;
  // The bundled nginx is plain HTTP. Only TRUSTED_PROXY may set Secure.
  return isTrustedProxyPeer(req.socket?.remoteAddress, trustedProxyList());
}

function serializeCookie(
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
