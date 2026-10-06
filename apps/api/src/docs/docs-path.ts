import { createHash } from 'crypto';
import { existsSync, lstatSync, realpathSync } from 'fs';
import path from 'path';

/**
 * Docs path sandbox (ticket 6).
 *
 * The browser never sends a raw filesystem path. It sends a server-issued
 * id (`doc-` + hash) or a root-relative slug. This module is the only place
 * that turns that slug into a file, and it refuses anything that is not a
 * real file inside the configured docs root.
 *
 * `..`, absolute paths, backslashes, null bytes, and percent-encoded
 * traversal (`%2e%2e%2f`, including a second round of encoding) are 400.
 * A symlink whose real path leaves the root is 400. A missing file is 404.
 * None of those read the target.
 */

export class DocsPathError extends Error {
  readonly status: 400 | 404;

  constructor(status: 400 | 404, message: string) {
    super(message);
    this.name = 'DocsPathError';
    this.status = status;
  }
}

/** apps/api/src/docs and apps/api/dist/docs are both four levels under the repo. */
export function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Host path the API and `npm run seed:demo` share.
 * Absolute `DOCS_ROOT` is used as-is. A relative value is from the repo
 * root, not the process cwd (seed, jest, and `nest start` do not agree).
 * Unset → `<repo>/data/docs`.
 */
export function configuredDocsRoot(): string {
  const raw = process.env.DOCS_ROOT?.trim();
  if (!raw) return path.join(repoRoot(), 'data', 'docs');
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(repoRoot(), raw);
}

/**
 * Real directory we may read, or null when the root is missing, not a
 * directory, or cannot be resolved. Callers turn null into an empty list
 * so the Docs page can show its empty state instead of a 500.
 */
export function openDocsRoot(root = configuredDocsRoot()): string | null {
  try {
    if (!existsSync(root)) return null;
    const real = realpathSync(root);
    if (!lstatSync(real).isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

const DOC_ID = /^doc-[a-f0-9]{20}$/;
const MAX_DECODE = 5;

export function docIdFor(relativePosix: string): string {
  return `doc-${createHash('sha256').update(relativePosix).digest('hex').slice(0, 20)}`;
}

/** Server-issued ids only. Anything that looks like a path is 400, not a lookup. */
export function assertDocId(id: string): string {
  const text = typeof id === 'string' ? id.trim() : '';
  if (
    !text ||
    text.includes('\0') ||
    text.includes('/') ||
    text.includes('\\') ||
    text.includes('..') ||
    text.includes('%')
  ) {
    throw new DocsPathError(400, 'bad path');
  }
  if (!DOC_ID.test(text)) throw new DocsPathError(404, 'doc not found');
  return text;
}

export function fullyDecode(raw: string): string {
  let value = raw;
  for (let i = 0; i < MAX_DECODE; i++) {
    if (!/%[0-9a-fA-F]{2}/.test(value)) return value;
    let next: string;
    try {
      next = decodeURIComponent(value);
    } catch {
      throw new DocsPathError(400, 'bad path');
    }
    if (next === value) return value;
    value = next;
  }
  throw new DocsPathError(400, 'bad path');
}

export function isInsideRoot(rootReal: string, candidate: string): boolean {
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidate === rootReal || candidate.startsWith(root);
}

/**
 * Resolve a root-relative slug to a real file inside `rootReal`.
 * Does not read the file. Throws DocsPathError (400 or 404) otherwise.
 */
export function resolveDocFile(rootReal: string, request: string): { absolute: string; relative: string } {
  if (typeof request !== 'string') throw new DocsPathError(400, 'bad path');
  const decoded = fullyDecode(request.trim());
  if (!decoded || decoded.includes('\0')) throw new DocsPathError(400, 'bad path');

  const slash = decoded.replace(/\\/g, '/');
  if (slash.startsWith('/') || /^[a-zA-Z]:\//.test(slash)) {
    throw new DocsPathError(400, 'absolute paths are not allowed');
  }
  if (/%2e/i.test(slash)) throw new DocsPathError(400, 'path traversal');

  const segments = slash.split('/').filter((seg) => seg !== '.');
  if (segments.length === 0 || segments.some((seg) => seg.length === 0)) {
    throw new DocsPathError(400, 'bad path');
  }
  if (segments.some((seg) => seg === '..')) {
    throw new DocsPathError(400, 'path traversal');
  }

  const logical = path.resolve(rootReal, ...segments);
  if (!isInsideRoot(rootReal, logical)) {
    throw new DocsPathError(400, 'path escapes docs root');
  }

  let real: string;
  try {
    if (!existsSync(logical)) throw new DocsPathError(404, 'doc not found');
    real = realpathSync(logical);
  } catch (err) {
    if (err instanceof DocsPathError) throw err;
    throw new DocsPathError(404, 'doc not found');
  }
  if (!isInsideRoot(rootReal, real)) {
    throw new DocsPathError(400, 'path escapes docs root');
  }
  let st;
  try {
    st = lstatSync(real);
  } catch {
    throw new DocsPathError(404, 'doc not found');
  }
  if (!st.isFile()) throw new DocsPathError(404, 'doc not found');

  const relative = path.relative(rootReal, logical).split(path.sep).join('/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DocsPathError(400, 'path escapes docs root');
  }
  return { absolute: real, relative };
}
