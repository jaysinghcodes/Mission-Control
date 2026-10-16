import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isAgentTicketWrite, skipsSession } from './route-class';
import { requestLoopback, validSession } from './session';
import { configuredWriteToken, tokensMatch } from './write-token';

/**
 * Dashboard reads and writes.
 *
 * Loopback stays open. Loopback is the socket address only. A forwarded
 * header does not open the dashboard, and the tunnel listener never does.
 * Any other peer needs a session cookie. Agent ingest and the login
 * routes skip this check.
 *
 * POST /tickets and PATCH /tickets/:id also accept x-ingest-token when
 * the caller is not loopback and has no session. A session is checked
 * first, so a valid cookie still works when the header is wrong. Ticket
 * delete and every other dashboard write stay loopback or session only.
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
    if (isAgentTicketWrite(method, url) && agentTicketToken(req)) {
      next();
      return;
    }
    res.status(401).json({ statusCode: 401, message: 'unauthorized' });
  }
}

function agentTicketToken(req: Request): boolean {
  const expected = configuredWriteToken();
  if (!expected) return false;
  const header = req.headers['x-ingest-token'];
  const provided = typeof header === 'string' ? header : undefined;
  return tokensMatch(provided, expected);
}
