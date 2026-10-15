/**
 * Count plus the word that agrees with it.
 * 1 uses singular. 0 and every other count use plural.
 * Pass plural when the word is irregular or does not take an s
 * (person/people, memory/memories, "in progress").
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  const n = Number.isFinite(count) ? Math.trunc(count) : 0
  return `${n} ${n === 1 ? singular : plural}`
}
