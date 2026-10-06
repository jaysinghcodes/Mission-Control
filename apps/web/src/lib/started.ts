/**
 * Pipeline "Started" (QA-13).
 *
 * Match a run to a ticket by id only. A shared title or a key inside the
 * run name is not a match. Use that run's startedAt. Fall back to the
 * ticket's createdAt only when no run points at the ticket. A matched run
 * whose startedAt is still null does not fall back to createdAt.
 */

export function startedIso(
  ticket: { id: string; createdAt: string },
  runs: { ticketId?: string | null; startedAt?: string | null }[],
): string {
  const matched = runs.filter((row) => !!row.ticketId && row.ticketId === ticket.id)
  if (matched.length === 0) return ticket.createdAt
  const stamped = matched
    .map((row) => row.startedAt)
    .filter((value): value is string => !!value)
    .sort()
  if (stamped.length === 0) return ''
  return stamped[stamped.length - 1]
}
