import { readdir, readFile, realpath, stat } from 'fs/promises';
import path from 'path';
import {
  DocsPathError,
  assertDocId,
  docIdFor,
  isInsideRoot,
  resolveDocFile,
} from './docs-path';
import { renderMarkdown } from './render-markdown';

/**
 * Read-only docs library. Scans the real docs root for markdown files,
 * newest first. No writes, no absolute paths in the response.
 */

const MD = /\.(md|markdown)$/i;
/** A single note larger than this is skipped so one file cannot stall the page. */
const MAX_BYTES = 1_000_000;

export type DocType = 'Spec' | 'Brief' | 'Note';

export interface DocListItem {
  id: string;
  slug: string;
  title: string;
  preview: string;
  type: DocType;
  state: string | null;
  author: string;
  updatedAt: string;
}

export interface DocDetail extends DocListItem {
  html: string;
}

interface Scanned extends DocListItem {
  absolute: string;
}

interface Frontmatter {
  title?: string;
  type?: string;
  author?: string;
  state?: string;
  updated?: string;
}

export async function listDocs(
  root: string | null,
  query: { q?: string; type?: DocType } = {},
): Promise<{ docs: DocListItem[]; total: number }> {
  if (!root) return { docs: [], total: 0 };
  const scanned = await scan(root);
  const q = (query.q ?? '').trim().toLowerCase();
  const filtered = scanned.filter((doc) => {
    if (query.type && doc.type !== query.type) return false;
    if (q && !doc.title.toLowerCase().includes(q)) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  });
  return {
    docs: filtered.map(toListItem),
    total: filtered.length,
  };
}

export async function readDocById(root: string | null, id: string): Promise<DocDetail> {
  const safe = assertDocId(id);
  if (!root) throw new DocsPathError(404, 'doc not found');
  const hit = (await scan(root)).find((doc) => doc.id === safe);
  if (!hit) throw new DocsPathError(404, 'doc not found');
  return withHtml(hit);
}

export async function readDocBySlug(root: string | null, slug: string): Promise<DocDetail> {
  if (!root) throw new DocsPathError(404, 'doc not found');
  const located = resolveDocFile(root, slug);
  if (!MD.test(located.relative)) throw new DocsPathError(404, 'doc not found');
  const record = await recordFromFile(root, {
    absolute: located.absolute,
    relative: located.relative,
    mtime: (await stat(located.absolute)).mtime,
  });
  return withHtml(record);
}

function toListItem(doc: Scanned): DocListItem {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    preview: doc.preview,
    type: doc.type,
    state: doc.state,
    author: doc.author,
    updatedAt: doc.updatedAt,
  };
}

async function withHtml(doc: Scanned): Promise<DocDetail> {
  const raw = await readFile(doc.absolute, 'utf8').catch(() => '');
  const { body } = splitFrontmatter(raw);
  return { ...toListItem(doc), html: renderMarkdown(body) };
}

interface FoundFile {
  absolute: string;
  relative: string;
  mtime: Date;
}

async function scan(root: string): Promise<Scanned[]> {
  const found: FoundFile[] = [];
  await walk(root, root, new Set<string>([root]), found);
  const docs: Scanned[] = [];
  for (const file of found) {
    try {
      docs.push(await recordFromFile(root, file));
    } catch {
      // One unreadable note must not take down the list.
    }
  }
  return docs;
}

async function walk(dir: string, root: string, seen: Set<string>, out: FoundFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const logical = path.join(dir, ent.name);
    let real: string;
    try {
      real = await realpath(logical);
    } catch {
      continue;
    }
    if (!isInsideRoot(root, real)) continue;
    let st;
    try {
      st = await stat(real);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (seen.has(real)) continue;
      seen.add(real);
      await walk(logical, root, seen, out);
      continue;
    }
    if (!st.isFile() || !MD.test(ent.name) || st.size > MAX_BYTES) continue;
    const relative = path.relative(root, logical).split(path.sep).join('/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    out.push({ absolute: real, relative, mtime: st.mtime });
  }
}

async function recordFromFile(root: string, file: FoundFile): Promise<Scanned> {
  if (!isInsideRoot(root, file.absolute)) {
    throw new DocsPathError(400, 'path escapes docs root');
  }
  const raw = await readFile(file.absolute, 'utf8');
  const { meta, body } = splitFrontmatter(raw);
  const title = (meta.title || headingTitle(body) || fileTitle(file.relative)).slice(0, 200);
  const updated = parseUpdated(meta.updated) ?? file.mtime;
  const state = (meta.state ?? '').trim().slice(0, 40);
  const author = (meta.author ?? '').trim().slice(0, 120) || 'Unknown';
  return {
    id: docIdFor(file.relative),
    slug: file.relative,
    title,
    preview: previewText(body),
    type: normalizeType(meta.type, file.relative),
    state: state || null,
    author,
    updatedAt: updated.toISOString(),
    absolute: file.absolute,
  };
}

export function splitFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: text };
  const block = text.slice(3, end).replace(/^\r?\n/, '');
  const body = text.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Frontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    const key = match[1].toLowerCase();
    if (key === 'title' || key === 'type' || key === 'author' || key === 'state' || key === 'updated') {
      meta[key] = value;
    }
  }
  return { meta, body };
}

function headingTitle(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match) return match[1].replace(/\s+#+$/, '').trim();
  }
  return '';
}

function fileTitle(relative: string): string {
  const base = relative.split('/').pop() ?? relative;
  return base.replace(/\.(md|markdown)$/i, '').trim() || 'Untitled';
}

function parseUpdated(raw: string | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeType(raw: string | undefined, relative: string): DocType {
  const fromMeta = typeFrom(raw);
  if (fromMeta) return fromMeta;
  const folder = relative.split('/')[0] ?? '';
  return typeFrom(folder) ?? 'Note';
}

function typeFrom(raw: string | undefined): DocType | null {
  const text = (raw ?? '').trim().toLowerCase();
  if (text === 'spec' || text === 'specs') return 'Spec';
  if (text === 'brief' || text === 'briefs') return 'Brief';
  if (text === 'note' || text === 'notes') return 'Note';
  return null;
}

export function previewText(body: string): string {
  const noFence = body.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/g, ' ');
  const text = noFence
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= 180) return text;
  return `${text.slice(0, 179)}…`;
}
