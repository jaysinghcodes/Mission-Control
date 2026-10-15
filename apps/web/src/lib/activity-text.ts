/**
 * Display text for an activity row. New events already use plain sentences.
 * Older rows stored "ticket MC-151 → build", and this rewrites those too.
 */

const STAGE_NAMES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  build: 'Build',
  inprogress: 'Build',
  qa: 'QA',
  review: 'Review',
  done: 'Done',
}

function stageName(status: string): string {
  const known = STAGE_NAMES[status.trim().toLowerCase()]
  if (known) return known
  const trimmed = status.trim()
  if (!trimmed) return 'Build'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

const LEGACY_MOVE = /^(?:ticket\s+)?([A-Za-z]+-\d+)\s*→\s*(\w+)\s*$/

export function plainActivity(raw: string): string {
  const match = raw.match(LEGACY_MOVE)
  const text = match ? `${match[1]} moved to ${stageName(match[2])}` : raw
  return text.replace(/[→←]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function activityText(
  source: { name?: unknown; summary?: unknown; title?: unknown } | null | undefined,
  fallback = '',
): string {
  const name = typeof source?.name === 'string' ? source.name.trim() : ''
  const summary = typeof source?.summary === 'string' ? source.summary.trim() : ''
  return plainActivity(name || summary || fallback)
}

/** Job title plus the sentence, so Calendar can still match a scheduled job. */
export function activityHaystack(
  source: { name?: unknown; summary?: unknown; title?: unknown } | null | undefined,
): string {
  const bits = [source?.title, source?.name, source?.summary]
  return bits.filter((bit): bit is string => typeof bit === 'string').join(' ')
}
