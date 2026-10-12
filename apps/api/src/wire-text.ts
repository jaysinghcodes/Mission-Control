/**
 * String() for untyped JSON fields.
 *
 * Snapshot and log parsers already store this coercion. Objects still become
 * the text String() produced, including "[object Object]".
 */
export function wireText(value: unknown): string {
  return String(value);
}
