import type { Test } from 'supertest';

/**
 * e2e writes go through the same check as the app.
 * When INGEST_TOKEN is set, send it. When it is unset, send nothing,
 * which is the loopback zero config path.
 */
export function applyWriteToken<T extends Test>(req: T): T {
  const token = process.env.INGEST_TOKEN;
  if (typeof token === 'string' && token.trim() !== '') {
    req.set('x-ingest-token', token);
  }
  return req;
}
