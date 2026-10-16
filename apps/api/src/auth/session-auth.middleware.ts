import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { skipsSession } from './route-class';
import { requestLoopback, validSession } from './session';

/**
 * Dashboard reads and writes.
 *
 * Loopback, judged from the socket address, stays open.
 * Any other peer needs a session cookie. Agent ingest and the login
 * routes skip this check.
 */
@Injectable()
export class SessionAuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const method = req.method || 'GET';
    const url = req.originalUrl || req.url;
    if (skipsSession(method, url)) {
      next();
      return;
    }
    if (requestLoopback(req)) {
      next();
      return;
    }
    if (validSession(req.headers.cookie)) {
      next();
      return;
    }
    res.status(401).json({ statusCode: 401, message: 'unauthorized' });
  }
}
