import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { DocsPathError } from './docs-path';
import { DocsService } from './docs.service';
import type { DocDetail, DocType } from './docs-library';

/**
 * DocsController — read-only docs (ticket 6).
 *
 * GET /docs lists newest first (preview, type, state, author, date).
 * GET /docs/:id reads one server-issued id.
 * GET /docs/open?slug= reads one root-relative slug.
 *
 * There is no create or update route. A missing root is 200 with `docs: []`.
 * Path traversal is 400. An unknown id or slug is 404. Never a 200 body
 * shaped like `{ error }`.
 */

const TYPE_QUERY: Record<string, DocType> = {
  spec: 'Spec',
  specs: 'Spec',
  brief: 'Brief',
  briefs: 'Brief',
  note: 'Note',
  notes: 'Note',
};

@Controller('docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  async list(@Query('q') q?: string, @Query('type') type?: string) {
    const parsed = parseType(type);
    const result = await this.docs.list({ q, type: parsed });
    return { ...result, ts: Date.now() };
  }

  /** Declared before `:id` so "open" is not captured as an id. */
  @Get('open')
  async open(@Query('id') id?: string, @Query('slug') slug?: string) {
    const idText = (id ?? '').trim();
    const slugText = (slug ?? '').trim();
    if (idText) return this.load(() => this.docs.readById(idText));
    if (slugText) return this.load(() => this.docs.readBySlug(slugText));
    throw new BadRequestException('id or slug is required');
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return this.load(() => this.docs.readById(id));
  }

  private async load(read: () => Promise<DocDetail>) {
    try {
      const doc = await read();
      return { doc, ts: Date.now() };
    } catch (err) {
      if (err instanceof DocsPathError) {
        if (err.status === 400) throw new BadRequestException(err.message);
        throw new NotFoundException(err.message);
      }
      throw err;
    }
  }
}

function parseType(raw?: string): DocType | undefined {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return undefined;
  const hit = TYPE_QUERY[text];
  if (!hit) throw new BadRequestException('type must be Spec, Brief, or Note');
  return hit;
}
