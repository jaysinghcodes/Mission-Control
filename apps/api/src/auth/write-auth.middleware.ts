import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { configuredWriteToken, tokensMatch } from './write-token';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * One check for every mutating route.
 *
 * Registered for the whole app in AppModule. A new POST, PUT, PATCH, or
 * DELETE cannot skip it. GET, HEAD, and OPTIONS pass through.
 *
 * When INGEST_TOKEN is unset and NODE_ENV is production, every write is
 * 401, including on loopback. Any other NODE_ENV with no token continues.
 * main.ts has already refused to start if that process is bound off loopback.
 */
@Injectable()
export class WriteAuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const method = (req.method || '').toUpperCase();
    if (!WRITE_METHODS.has(method)) {
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
