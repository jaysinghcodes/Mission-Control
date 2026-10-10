/**
 * Statuses PATCH /runs accepts.
 * POST /runs does not take `status`. Sending it is 400 (unknown field).
 * Anything else on PATCH is 400 and the message names `status`.
 * The demo seed uses the same list so it cannot insert a status the API would reject.
 */
export const RUN_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'needs_approval',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}
