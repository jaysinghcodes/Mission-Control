/**
 * Jest globalSetup for `npm run test:e2e` (QA-1 polish item 3).
 *
 * Runs ONCE, before any e2e file is loaded or any Nest app boots. Without
 * DATABASE_URL, PrismaService silently falls back to localhost:5432 — fine
 * for `npm run dev`, dangerous for e2e: it would write test rows into
 * whatever Postgres happens to own that port (often a teammate's or QA's
 * dev DB). So we refuse up front, with a message that says how to fix it,
 * instead of letting every suite time out or litter someone else's data.
 *
 * (tickets.e2e-spec.ts repeats the check at file level so it is also safe
 * when run directly with a different jest config.)
 */
export default function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      [
        'test:e2e refuses to run without DATABASE_URL.',
        '  Point it at a migrated, disposable Postgres, e.g.:',
        '    DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/mission_control \\',
        '      npm run test:e2e -w apps/api',
        '  (PrismaService would otherwise silently fall back to localhost:5432.)',
      ].join('\n'),
    );
  }
}
