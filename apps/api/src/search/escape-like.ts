/**
 * escapeLike — make user text match LITERALLY inside a SQL LIKE / ILIKE
 * pattern (QA-1 polish item 8, QA-2 search).
 *
 * In LIKE, `%` means "any run of characters" and `_` means "any single
 * character". Prisma's `contains` / `startsWith` / `endsWith` filters do NOT
 * escape them (they build `'%' || $1 || '%'` as-is), so a search for `100%`
 * also matched `1000`, `a_b` matched `axb`, and a lone `%%` matched every row.
 *
 * Postgres' default LIKE escape character is backslash, so we prefix each
 * wildcard with `\`. The backslash itself must be escaped FIRST, otherwise a
 * user-typed `\` would swallow the next character (e.g. `\%` → literal `%`
 * after we add our own escape → wrong). Order matters:
 *   1. `\` → `\\`
 *   2. `%` → `\%`, `_` → `\_`
 * Works for both Prisma `contains` (Postgres provider) and raw
 * `ILIKE … ESCAPE '\'` queries.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
