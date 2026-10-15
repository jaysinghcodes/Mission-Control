/**
 * Plain activity sentences. Stage names are capitalized words.
 * Office, Activity, and search read `name`. Job titles stay on `title`.
 */

const STAGE_NAMES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  build: 'Build',
  inprogress: 'Build',
  qa: 'QA',
  review: 'Review',
  done: 'Done',
};

export function stageName(status: string): string {
  const key = status.trim().toLowerCase();
  const known = STAGE_NAMES[key];
  if (known) return known;
  const trimmed = status.trim();
  if (!trimmed) return 'Build';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function ticketCreated(key: string): string {
  return `${key} created`;
}

export function ticketMoved(key: string, status: string): string {
  return `${key} moved to ${stageName(status)}`;
}

export function ticketUpdated(key: string): string {
  return `${key} updated`;
}

export function runActivityName(status: string): string {
  if (status === 'running') return 'Run started';
  if (status === 'done') return 'Run finished';
  if (status === 'failed') return 'Run failed';
  if (status === 'needs_approval') return 'Run needs you';
  return 'Run queued';
}

export function agentStatusName(name: string, status: string): string {
  const word = status.trim().toLowerCase().replace(/_/g, ' ');
  return `${name} is now ${word}`;
}

export function agentRegistered(name: string): string {
  return `${name} registered`;
}

export function agentWentOffline(name: string): string {
  return `${name} went offline`;
}

const LEGACY_MOVE = /^(?:ticket\s+)?([A-Za-z]+-\d+)\s*→\s*(\w+)\s*$/;

/** Turn a stored line into the sentence the UI should show. */
export function plainActivity(raw: string): string {
  const match = raw.match(LEGACY_MOVE);
  const text = match ? `${match[1]} moved to ${stageName(match[2])}` : raw;
  return text.replace(/[→←]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The stored sentence. An empty payload stays empty. Callers do not pass an event type. */
export function activityText(
  source: { name?: unknown; summary?: unknown } | null | undefined,
): string {
  const name = typeof source?.name === 'string' ? source.name.trim() : '';
  const summary =
    typeof source?.summary === 'string' ? source.summary.trim() : '';
  return plainActivity(name || summary);
}
