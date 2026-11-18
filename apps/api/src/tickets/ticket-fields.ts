/**
 * Field limits for POST /tickets and PATCH /tickets/:id.
 * The web mirror is apps/web/src/lib/ticket-fields.ts. Keep the two in step.
 */

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 4000;
export const ASSIGNEE_MAX = 100;

export const PRIORITIES = ['high', 'med', 'low'] as const;
export type TicketPriority = (typeof PRIORITIES)[number];

export const TITLE_REQUIRED = 'title is required';
export const TITLE_TYPE = 'title must be a string';
export const TITLE_LENGTH = 'title must be 120 characters or fewer';
export const DESCRIPTION_TYPE = 'description must be a string';
export const DESCRIPTION_LENGTH =
  'description must be 4000 characters or fewer';
export const PRIORITY_TYPE = 'priority must be a string';
export const PRIORITY_VALUES = 'priority must be one of high, med, low';
export const ASSIGNEE_TYPE = 'assignee must be a string';
export const ASSIGNEE_LENGTH = 'assignee must be 100 characters or fewer';

export type FieldResult<T> =
  { ok: true; value: T } | { ok: false; message: string };

export function isTicketPriority(value: string): value is TicketPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

/** A title the caller sent. Null counts as blank. A non string is a type error. */
export function parseTitle(raw: unknown): FieldResult<string> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: TITLE_REQUIRED };
  }
  if (typeof raw !== 'string') return { ok: false, message: TITLE_TYPE };
  const title = raw.trim();
  if (!title) return { ok: false, message: TITLE_REQUIRED };
  if (title.length > TITLE_MAX) return { ok: false, message: TITLE_LENGTH };
  return { ok: true, value: title };
}

/**
 * Omitted or null means the caller did not set a priority.
 * Any other non string is a type error. Any other string is rejected.
 */
export function parsePriority(
  raw: unknown,
): FieldResult<TicketPriority | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, message: PRIORITY_TYPE };
  if (!isTicketPriority(raw)) return { ok: false, message: PRIORITY_VALUES };
  return { ok: true, value: raw };
}

/** Omitted means leave it. Null and other non strings are a type error. */
export function parseDescription(
  raw: unknown,
): FieldResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, message: DESCRIPTION_TYPE };
  if (raw.length > DESCRIPTION_MAX) {
    return { ok: false, message: DESCRIPTION_LENGTH };
  }
  return { ok: true, value: raw };
}

/** Omitted or null means leave it. A long string is rejected before other rules. */
export function parseAssignee(raw: unknown): FieldResult<string | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== 'string') return { ok: false, message: ASSIGNEE_TYPE };
  if (raw.length > ASSIGNEE_MAX) return { ok: false, message: ASSIGNEE_LENGTH };
  return { ok: true, value: raw };
}
