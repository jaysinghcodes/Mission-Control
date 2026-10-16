import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LiveActivityGateway } from '../live-activity/live-activity.gateway';
import { ensureBundledPeers } from './bundled-proxy';
import { isLoopbackAddress } from './client-address';
import {
  LOGIN_LIMIT_MESSAGE,
  loginBlock,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginLimits,
} from './login-limit';
import { hashPassword, MAX_PASSWORD, passwordMatches } from './password';
import {
  changePasswordHash,
  effectivePasswordHash,
  revokeSessions,
} from './session-state';
import {
  applySessionCookie,
  clearSessionCookie,
  loginWithPassword,
  peerAddress,
  requestLoopback,
  sessionStatus,
  validSession,
} from './session';

/**
 * Login is the only way in from a non loopback address.
 * The password is checked against DASHBOARD_PASSWORD_HASH. The browser
 * receives an HttpOnly cookie, never the hash.
 * Logout bumps the session version when the caller is loopback or already
 * signed in, so a copied cookie stops working. Wrong passwords off loopback
 * are counted per IP.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly live: LiveActivityGateway) {}

  @Get('session')
  status(@Req() req: Request) {
    return sessionStatus(req);
  }

  @Post('login')
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await ensureBundledPeers();
    const loopback = requestLoopback(req);
    const ip = peerAddress(req) ?? 'unknown';
    if (!loopback) {
      const block = loginBlock(ip);
      if (block) {
        res.setHeader('Retry-After', String(block.retryAfter));
        res.status(429).json({
          statusCode: 429,
          message: LOGIN_LIMIT_MESSAGE,
        });
        return;
      }
    }
    const token = loginWithPassword(bodyField(body, 'password'));
    if (!token) {
      if (!loopback) recordLoginFailure(ip);
      res.status(401).json({ statusCode: 401, message: 'unauthorized' });
      return;
    }
    if (!loopback) recordLoginSuccess(ip);
    applySessionCookie(res, token);
    res.status(204).send();
  }

  /**
   * Clears every login lock. The socket itself must be loopback.
   * A forwarded header cannot clear the lock, including from nginx.
   * npm run login:reset calls this on 127.0.0.1. Under Compose that
   * command runs inside the api container.
   */
  @Post('login-reset')
  resetLogins(@Req() req: Request, @Res() res: Response): void {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(401).json({ statusCode: 401, message: 'unauthorized' });
      return;
    }
    resetLoginLimits();
    res.status(204).send();
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response): void {
    if (requestLoopback(req) || validSession(req.headers.cookie)) {
      if (!this.revokeOrFail(res)) return;
    }
    clearSessionCookie(res);
    res.status(204).send();
  }

  /**
   * Off loopback the session middleware already required a cookie.
   * A wrong current password does not revoke. A match revokes every session.
   */
  @Post('password')
  changePassword(@Res() res: Response, @Body() body: unknown): void {
    const current = bodyField(body, 'currentPassword');
    const next = bodyField(body, 'newPassword');
    const hash = effectivePasswordHash();
    if (
      !hash ||
      typeof current !== 'string' ||
      typeof next !== 'string' ||
      next.length === 0 ||
      next.length > MAX_PASSWORD
    ) {
      res.status(400).json({ statusCode: 400, message: 'password required' });
      return;
    }
    if (!passwordMatches(current, hash)) {
      res.status(401).json({ statusCode: 401, message: 'unauthorized' });
      return;
    }
    try {
      changePasswordHash(hashPassword(next));
    } catch {
      res
        .status(500)
        .json({ statusCode: 500, message: 'could not revoke sessions' });
      return;
    }
    this.live.dropRevokedSockets();
    clearSessionCookie(res);
    res.status(204).send();
  }

  private revokeOrFail(res: Response): boolean {
    try {
      revokeSessions();
    } catch {
      res
        .status(500)
        .json({ statusCode: 500, message: 'could not revoke sessions' });
      return false;
    }
    this.live.dropRevokedSockets();
    return true;
  }
}

function bodyField(body: unknown, key: string): unknown {
  if (!body || typeof body !== 'object' || !(key in body)) return undefined;
  return (body as Record<string, unknown>)[key];
}
