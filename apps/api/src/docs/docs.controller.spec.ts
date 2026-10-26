import { responseJson } from '../../test/lint-helpers';

interface ListedDoc {
  id: string;
  slug: string;
  title: string;
  preview: string;
  type: string;
  state: string | null;
  author: string;
  updatedAt: string;
}

function docList(res: { body: unknown }): { docs: ListedDoc[]; total: number } {
  return responseJson(res);
}

function docDetail(res: { body: unknown }): ListedDoc & { html: string } {
  return responseJson<{ doc: ListedDoc & { html: string } }>(res).doc;
}

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import request from 'supertest';
import { writeDemoDocs } from './demo-docs';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';

describe('Docs API', () => {
  let app: INestApplication;
  let root: string;
  const saved = process.env.DOCS_ROOT;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mc-docs-api-'));
    await writeDemoDocs(root);
    process.env.DOCS_ROOT = root;
    const moduleRef = await Test.createTestingModule({
      controllers: [DocsController],
      providers: [DocsService],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.DOCS_ROOT;
    else process.env.DOCS_ROOT = saved;
  });

  it('lists newest first with preview, type, state, author, and date', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docList(res).docs.length).toBeGreaterThanOrEqual(3);
    expect(docList(res).total).toBe(docList(res).docs.length);
    const first = docList(res).docs[0];
    expect(first.title).toMatch(/redesign/i);
    expect(first).toEqual(
      expect.objectContaining({
        type: 'Spec',
        author: 'atlas',
      }),
    );
    expect(typeof first.preview).toBe('string');
    expect(first.preview.length).toBeGreaterThan(0);
    expect(first.updatedAt).toEqual(expect.any(String));
    expect(first.id).toMatch(/^doc-[a-f0-9]{20}$/);
    expect(first.slug).toBe('specs/app-redesign.md');
    expect(JSON.stringify(first)).not.toContain(root);
    const times = docList(res).docs.map(
      (doc: { updatedAt: string }) => doc.updatedAt,
    );
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);

    const draft = docList(res).docs.find(
      (doc: { title: string }) => doc.title === 'Release notes',
    )!;
    expect(draft.state).toBe('Draft');
    const cafe = docList(res).docs.find(
      (doc: { slug: string }) => doc.slug === 'notes/Café checklist.md',
    )!;
    expect(cafe.title).toBe('Café checklist');
    expect(cafe.author).toBe('echo');
  });

  it('searches by part of a title and filters by type', async () => {
    const search = await request(app.getHttpServer())
      .get('/docs')
      .query({ q: 'redes' })
      .expect(200);
    expect(docList(search).total).toBe(1);
    expect(docList(search).docs[0].title).toMatch(/redesign/);

    const briefs = await request(app.getHttpServer())
      .get('/docs')
      .query({ type: 'Brief' })
      .expect(200);
    expect(
      docList(briefs).docs.every(
        (doc: { type: string }) => doc.type === 'Brief',
      ),
    ).toBe(true);
    expect(docList(briefs).total).toBe(docList(briefs).docs.length);
    expect(
      docList(briefs).docs.map((doc: { title: string }) => doc.title),
    ).toContain('Morning Brief · today');

    const notes = await request(app.getHttpServer())
      .get('/docs')
      .query({ type: 'notes' })
      .expect(200);
    expect(
      docList(notes).docs.every((doc: { type: string }) => doc.type === 'Note'),
    ).toBe(true);
    const allDocs = await request(app.getHttpServer()).get('/docs');
    expect(docList(notes).total).toBeLessThan(docList(allDocs).total);

    await request(app.getHttpServer())
      .get('/docs')
      .query({ type: 'weekly' })
      .expect(400);
  });

  it('renders headings, code, and links, and does not crash on broken markdown', async () => {
    const list = await request(app.getHttpServer()).get('/docs');
    const spec = docList(list).docs.find(
      (doc: { slug: string }) => doc.slug === 'specs/app-redesign.md',
    )!;
    const broken = docList(list).docs.find(
      (doc: { slug: string }) => doc.slug === 'notes/broken-markdown.md',
    )!;
    const cafe = docList(list).docs.find(
      (doc: { slug: string }) => doc.slug === 'notes/Café checklist.md',
    )!;
    const spaced = docList(list).docs.find(
      (doc: { slug: string }) => doc.slug === 'notes/Release notes.md',
    )!;

    const opened = await request(app.getHttpServer())
      .get(`/docs/${spec.id}`)
      .expect(200);
    expect(docDetail(opened).html).toMatch(/<h1/);
    expect(docDetail(opened).html).toMatch(/<pre><code/);
    expect(docDetail(opened).html).toContain('href="#/connect"');
    expect(docDetail(opened).html).toContain(
      'href="https://github.com/jaysinghcodes/mission-control"',
    );
    expect(docDetail(opened)).not.toHaveProperty('absolute');

    const messy = await request(app.getHttpServer())
      .get(`/docs/${broken.id}`)
      .expect(200);
    expect(typeof docDetail(messy).html).toBe('string');
    expect(docDetail(messy).html.length).toBeGreaterThan(0);
    expect(docDetail(messy).html).not.toMatch(/<script[\s>]/i);
    expect(docDetail(messy).html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    for (const href of [
      ...String(docDetail(messy).html).matchAll(/\shref\s*=\s*"([^"]*)"/gi),
    ].map((match) => match[1])) {
      expect(href.toLowerCase().replace(/\s+/g, '')).not.toContain(
        'javascript:',
      );
    }

    const bySlug = await request(app.getHttpServer())
      .get('/docs/open')
      .query({ slug: 'notes/Café checklist.md' })
      .expect(200);
    expect(docDetail(bySlug).id).toBe(cafe.id);
    expect(docDetail(bySlug).title).toBe('Café checklist');

    const bySpace = await request(app.getHttpServer())
      .get('/docs/open')
      .query({ slug: spaced.slug })
      .expect(200);
    expect(docDetail(bySpace).title).toBe('Release notes');
  });

  it('refuses path traversal with 4xx and never returns file contents', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'mc-docs-secret-'));
    const secret = 'SECRET_SENTINEL_passwd';
    await writeFile(path.join(outside, 'secret.md'), secret, 'utf8');
    await symlink(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));

    const cases = [
      '/docs/open?slug=../../etc/passwd',
      '/docs/open?slug=' + encodeURIComponent('notes/../../etc/passwd'),
      '/docs/open?slug=%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/docs/open?slug=%252e%252e%252f%252e%252e%252fetc%252fpasswd',
      '/docs/open?slug=' + encodeURIComponent('/etc/passwd'),
      '/docs/open?slug=leak.md',
    ];
    for (const url of cases) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(JSON.stringify(res.body)).not.toContain(secret);
      expect(JSON.stringify(res.body)).not.toMatch(/root:/);
    }

    const traversedId = await request(app.getHttpServer()).get(
      '/docs/' + encodeURIComponent('../../etc/passwd'),
    );
    expect(traversedId.status).toBeGreaterThanOrEqual(400);
    expect(traversedId.status).toBeLessThan(500);
    expect(JSON.stringify(traversedId.body)).not.toContain(secret);

    await request(app.getHttpServer()).get('/docs/open').expect(400);
    await request(app.getHttpServer())
      .get('/docs/doc-00000000000000000000')
      .expect(404);
  });

  it('returns an empty list for a missing or empty root', async () => {
    const missing = path.join(tmpdir(), 'mc-docs-missing-' + Date.now());
    process.env.DOCS_ROOT = missing;
    const gone = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docList(gone).docs).toEqual([]);
    expect(docList(gone).total).toBe(0);
    expect(responseJson<{ dir: string }>(gone).dir).toBe(
      path.normalize(missing),
    );
    expect(JSON.stringify(responseJson(gone))).not.toMatch(/root:/);
    expect(gone.body).not.toHaveProperty('error');
    await request(app.getHttpServer())
      .get('/docs/open')
      .query({ slug: 'specs/app-redesign.md' })
      .expect(404);

    const empty = await mkdtemp(path.join(tmpdir(), 'mc-docs-empty-api-'));
    process.env.DOCS_ROOT = empty;
    const blank = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docList(blank).docs).toEqual([]);
    expect(docList(blank).total).toBe(0);
    expect(responseJson<{ dir: string }>(blank).dir).toBe(
      path.normalize(empty),
    );

    await mkdir(path.join(empty, 'notes'), { recursive: true });
    const still = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(docList(still).total).toBe(0);

    process.env.DOCS_ROOT = root;
  });

  it('names the host docs folder on Compose, never /data/docs (issue 117)', async () => {
    const saved = {
      MC_COMPOSE: process.env.MC_COMPOSE,
      MC_DOCS_HOST_PATH: process.env.MC_DOCS_HOST_PATH,
      DOCS_ROOT: process.env.DOCS_ROOT,
    };
    const empty = await mkdtemp(path.join(tmpdir(), 'mc-docs-compose-'));
    try {
      process.env.MC_COMPOSE = '1';
      process.env.DOCS_ROOT = empty;
      process.env.MC_DOCS_HOST_PATH = '/srv/mission-control/data/docs';
      const host = await request(app.getHttpServer()).get('/docs').expect(200);
      expect(docList(host).total).toBe(0);
      expect(responseJson<{ dir: string }>(host).dir).toBe(
        '/srv/mission-control/data/docs',
      );
      expect(JSON.stringify(host.body)).not.toContain(empty);

      process.env.MC_DOCS_HOST_PATH = './data/docs';
      const relative = await request(app.getHttpServer())
        .get('/docs')
        .expect(200);
      expect(responseJson<{ dir: string }>(relative).dir).toBe('data/docs');

      for (const value of ['', '/data/docs', '/data/docs/']) {
        process.env.MC_DOCS_HOST_PATH = value;
        const none = await request(app.getHttpServer())
          .get('/docs')
          .expect(200);
        expect(responseJson<{ dir: string | null }>(none).dir).toBeNull();
        expect(JSON.stringify(none.body)).not.toContain('/data/docs');
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
