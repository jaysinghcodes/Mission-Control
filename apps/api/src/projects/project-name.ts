/**
 * Case-folded key stored in Project.nameKey.
 *
 * Trim first so " Roadmap" and "roadmap" are the same project. This uses
 * JS toLowerCase, not SQL LOWER(), so the string the API writes and the
 * string the duplicate check looks up are identical. The unique index on
 * nameKey is what actually rejects the second insert (409).
 */
export function projectNameKey(name: string): string {
  return name.trim().toLowerCase();
}
