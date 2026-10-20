/**
 * The Git cell on System (#116). /health reports the full sha. The cell shows
 * the 7 character short sha on one line and keeps the full value for the
 * tooltip. A value that is not a hex sha is shown as is.
 */
export function shortSha(value: string | null | undefined): { text: string; title: string | null } {
  const full = (value ?? '').trim()
  if (!full) return { text: 'Not reported', title: null }
  if (/^[0-9a-f]{8,}$/i.test(full)) return { text: full.slice(0, 7), title: full }
  return { text: full, title: full }
}
