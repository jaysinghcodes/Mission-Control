import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isIngestWrite } from './route-class';
import { configuredWriteToken, tokensMatch } from './write-token';

/**
 * Agent ingest only: register, heartbeat, runs, and POST /events.
 *
 * Dashboard reads and writes use the session cookie instead. This check
 * still runs for every route so a new ingest handler is covered when its
 * path is listed in route-class.ts. Other methods pass through.
 *
 * When INGEST_TOKEN is unset and NODE_ENV is production, ingest writes are
 * 401, including on loopback. Any other NODE_ENV with no token continues.
 * main.ts has already refused to start if that process is bound off loopback
 * without INGEST_TOKEN.
 */
@Injectable()
export class WriteAuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const method = (req.method || '').toUpperCase();
    const url = req.originalUrl || req.url;
    if (!isIngestWrite(method, url)) {
      next();
      return;
    }
    const expected = configuredWriteToken();
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        res.status(401).json({ statusCode: 401, message: 'unauthorized' });
        return;
      }
      next();
      return;
    }
    const provided = readIngestToken(req);
    if (!tokensMatch(provided, expected)) {
      res.status(401).json({ statusCode: 401, message: 'unauthorized' });
      return;
    }
    next();
  }
}

function readIngestToken(req: Request): string | undefined {
  const value = req.headers['x-ingest-token'];
  return typeof value === 'string' ? value : undefined;
}
