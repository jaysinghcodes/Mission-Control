import { Injectable } from '@nestjs/common';
import { openDocsRoot } from './docs-path';
import {
  listDocs,
  readDocById,
  readDocBySlug,
  type DocDetail,
  type DocListItem,
  type DocType,
} from './docs-library';

/**
 * DocsService — read-only markdown library (ticket 6).
 *
 * The root comes from DOCS_ROOT (default `<repo>/data/docs`). A missing or
 * empty root is an empty list, which the page renders as the empty state.
 * Addresses are a server-issued id or a root-relative slug. The service
 * never returns a filesystem path.
 */
@Injectable()
export class DocsService {
  list(query: { q?: string; type?: DocType } = {}): Promise<{ docs: DocListItem[]; total: number }> {
    return listDocs(openDocsRoot(), query);
  }

  readById(id: string): Promise<DocDetail> {
    return readDocById(openDocsRoot(), id);
  }

  readBySlug(slug: string): Promise<DocDetail> {
    return readDocBySlug(openDocsRoot(), slug);
  }
}
