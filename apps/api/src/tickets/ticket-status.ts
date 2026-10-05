/**
 * Ticket status vocabulary — the single source of truth for what the API will
 * accept on POST /tickets and PATCH /tickets/:id (QA findings C + D on PR #20).
 *
 * Why a whitelist at all:
 * - `status` is a free-form TEXT column in Postgres (no enum — and schema
 *   changes are human-reviewed, so we validate in code instead).
 * - Before this file, POST silently coerced junk to `todo` and PATCH saved
 *   anything (e.g. "banana"), which made the card vanish from every board
 *   column. Both now return 400 Bad Request instead.
 *
 * Keep in sync with the web board columns (apps/web/src/pages/Tickets.tsx
 * COLUMNS + the Backlog page). There is no shared package between api and web
 * yet, so the web side mirrors these literals with a pointer back here.
 */

/**
 * Every status a ticket may hold, in pipeline order:
 *   backlog → todo → build → qa → review → done
 *
 * `inprogress` is the LEGACY alias for `build` (MC-214 Option B). Older rows
 * and older bridge/agent clients still write it, and the board renders it in
 * the Build column, so we keep accepting it rather than 400-ing existing
 * integrations. New UI code sends the canonical `build`.
 */
export const TICKET_STATUSES = [
  'backlog',
  'todo',
  'build',
  'inprogress', // legacy alias of `build` — accepted, not emitted by the new UI
  'qa',
  'review',
  'done',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Statuses a ticket may be CREATED in. Mid-pipeline statuses (build/qa/…) are
 * only reachable through PATCH moves, so nobody can invent a card that skipped
 * the pipeline. Anything else on POST → 400.
 */
export const CREATE_STATUSES = [
  'backlog',
  'todo',
] as const satisfies readonly TicketStatus[];

/**
 * Status used when POST /tickets omits `status`.
 *
 * DECIDED by Atlas (Head of Product) during PR #20 QA: `backlog`.
 * - Matches the Prisma schema default (`status String @default("backlog")`),
 *   so API-created and DB-defaulted rows agree.
 * - Screens that want To-Do (the kanban "+ New ticket" CTA) must send
 *   `status: 'todo'` explicitly; the Backlog page sends `backlog`.
 *
 * This is deliberately the ONLY place the default lives — if product flips it
 * again, change this one line (and the unit test that pins it).
 */
export const DEFAULT_CREATE_STATUS: (typeof CREATE_STATUSES)[number] =
  'backlog';

/** Type guard: is `value` one of the pipeline statuses above? */
export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

/** Type guard: may a ticket be created with this status? */
export function isCreateStatus(
  value: string,
): value is (typeof CREATE_STATUSES)[number] {
  return (CREATE_STATUSES as readonly string[]).includes(value);
}
