import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  applySessionCookie,
  clearSessionCookie,
  loginWithPassword,
  sessionStatus,
} from './session';

/**
 * Login is the only way in from a non loopback address.
 * The password is checked against DASHBOARD_PASSWORD_HASH. The browser
 * receives an HttpOnly cookie, never the hash.
 */
@Controller('auth')
export class AuthController {
  @Get('session')
  status(@Req() req: Request) {
    return sessionStatus(req);
  }

  @Post('login')
  login(@Res() res: Response, @Body() body: unknown): void {
    const password =
      body && typeof body === 'object' && 'password' in body
        ? (body as { password?: unknown }).password
        : undefined;
    const token = loginWithPassword(password);
    if (!token) {
      res.status(401).json({ statusCode: 401, message: 'unauthorized' });
      return;
    }
    applySessionCookie(res, token);
    res.status(204).send();
  }

  @Post('logout')
  logout(@Res() res: Response): void {
    clearSessionCookie(res);
    res.status(204).send();
  }
}
