/**
 * Docs empty state copy (issue 117).
 *
 * GET /docs sends `dir`, the docs folder on the HOST: the configured root
 * on a native install, or the host side of the Compose bind. It is never
 * the container path. A relative value is from the Mission Control folder.
 * A missing value falls back to the generic line.
 *
 * The folder goes on its own line after a colon sentence, so a long path
 * wraps at the card edge and never at a hyphen inside a sentence.
 */
const TAIL = 'npm run seed:demo writes sample docs. This page does not read a path you type.'

export interface DocsEmptyCopy {
  lead: string
  folder: string | null
  tail: string
}

function isAbsoluteHostPath(dir: string): boolean {
  return dir.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dir)
}

export function docsEmptyCopy(dir: string | null | undefined): DocsEmptyCopy {
  const text = typeof dir === 'string' ? dir.trim() : ''
  if (!text) {
    return { lead: `No markdown yet. DOCS_ROOT sets the folder (the default is data/docs). ${TAIL}`, folder: null, tail: '' }
  }
  const lead = isAbsoluteHostPath(text)
    ? 'No markdown in this folder on the host:'
    : 'No markdown in this folder, relative to the Mission Control folder:'
  return { lead, folder: text, tail: `DOCS_ROOT sets that folder. ${TAIL}` }
}

/** The whole message as one line, for tests and screen readers. */
export function docsEmptyBody(dir: string | null | undefined): string {
  const copy = docsEmptyCopy(dir)
  return [copy.lead, copy.folder, copy.tail].filter(Boolean).join(' ')
}
