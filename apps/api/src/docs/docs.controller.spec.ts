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
    expect(res.body.docs.length).toBeGreaterThanOrEqual(3);
    expect(res.body.total).toBe(res.body.docs.length);
    const first = res.body.docs[0];
    expect(first.title).toMatch(/redesign/i);
    expect(first).toEqual(expect.objectContaining({
      type: 'Spec',
      author: 'Atlas',
    }));
    expect(typeof first.preview).toBe('string');
    expect(first.preview.length).toBeGreaterThan(0);
    expect(first.updatedAt).toEqual(expect.any(String));
    expect(first.id).toMatch(/^doc-[a-f0-9]{20}$/);
    expect(first.slug).toBe('specs/app-redesign.md');
    expect(JSON.stringify(first)).not.toContain(root);
    const times = res.body.docs.map((doc: { updatedAt: string }) => doc.updatedAt);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);

    const draft = res.body.docs.find((doc: { title: string }) => doc.title === 'Release notes');
    expect(draft.state).toBe('Draft');
    const cafe = res.body.docs.find((doc: { slug: string }) => doc.slug === 'notes/Café checklist.md');
    expect(cafe.title).toBe('Café checklist');
    expect(cafe.author).toBe('Echo');
  });

  it('searches by part of a title and filters by type', async () => {
    const search = await request(app.getHttpServer()).get('/docs').query({ q: 'redes' }).expect(200);
    expect(search.body.total).toBe(1);
    expect(search.body.docs[0].title).toMatch(/redesign/);

    const briefs = await request(app.getHttpServer()).get('/docs').query({ type: 'Brief' }).expect(200);
    expect(briefs.body.docs.every((doc: { type: string }) => doc.type === 'Brief')).toBe(true);
    expect(briefs.body.total).toBe(briefs.body.docs.length);
    expect(briefs.body.docs.map((doc: { title: string }) => doc.title)).toContain('Morning Brief · today');

    const notes = await request(app.getHttpServer()).get('/docs').query({ type: 'notes' }).expect(200);
    expect(notes.body.docs.every((doc: { type: string }) => doc.type === 'Note')).toBe(true);
    expect(notes.body.total).toBeLessThan(
      (await request(app.getHttpServer()).get('/docs')).body.total,
    );

    await request(app.getHttpServer()).get('/docs').query({ type: 'weekly' }).expect(400);
  });

  it('renders headings, code, and links, and does not crash on broken markdown', async () => {
    const list = await request(app.getHttpServer()).get('/docs');
    const spec = list.body.docs.find((doc: { slug: string }) => doc.slug === 'specs/app-redesign.md');
    const broken = list.body.docs.find((doc: { slug: string }) => doc.slug === 'notes/broken-markdown.md');
    const cafe = list.body.docs.find((doc: { slug: string }) => doc.slug === 'notes/Café checklist.md');
    const spaced = list.body.docs.find((doc: { slug: string }) => doc.slug === 'notes/Release notes.md');

    const opened = await request(app.getHttpServer()).get(`/docs/${spec.id}`).expect(200);
    expect(opened.body.doc.html).toMatch(/<h1/);
    expect(opened.body.doc.html).toMatch(/<pre><code/);
    expect(opened.body.doc.html).toContain('href="#/connect"');
    expect(opened.body.doc.html).toContain('href="https://github.com/jaysinghcodes/mission-control"');
    expect(opened.body.doc).not.toHaveProperty('absolute');

    const messy = await request(app.getHttpServer()).get(`/docs/${broken.id}`).expect(200);
    expect(typeof messy.body.doc.html).toBe('string');
    expect(messy.body.doc.html.length).toBeGreaterThan(0);
    expect(messy.body.doc.html).not.toMatch(/<script[\s>]/i);
    expect(messy.body.doc.html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    for (const href of [...String(messy.body.doc.html).matchAll(/\shref\s*=\s*"([^"]*)"/gi)].map((match) => match[1])) {
      expect(href.toLowerCase().replace(/\s+/g, '')).not.toContain('javascript:');
    }

    const bySlug = await request(app.getHttpServer())
      .get('/docs/open')
      .query({ slug: 'notes/Café checklist.md' })
      .expect(200);
    expect(bySlug.body.doc.id).toBe(cafe.id);
    expect(bySlug.body.doc.title).toBe('Café checklist');

    const bySpace = await request(app.getHttpServer())
      .get('/docs/open')
      .query({ slug: spaced.slug })
      .expect(200);
    expect(bySpace.body.doc.title).toBe('Release notes');
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
    await request(app.getHttpServer()).get('/docs/doc-00000000000000000000').expect(404);
  });

  it('returns an empty list for a missing or empty root', async () => {
    const missing = path.join(tmpdir(), 'mc-docs-missing-' + Date.now());
    process.env.DOCS_ROOT = missing;
    const gone = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(gone.body.docs).toEqual([]);
    expect(gone.body.total).toBe(0);
    expect(gone.body).not.toHaveProperty('error');
    await request(app.getHttpServer()).get('/docs/open').query({ slug: 'specs/app-redesign.md' }).expect(404);

    const empty = await mkdtemp(path.join(tmpdir(), 'mc-docs-empty-api-'));
    process.env.DOCS_ROOT = empty;
    const blank = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(blank.body.docs).toEqual([]);
    expect(blank.body.total).toBe(0);

    await mkdir(path.join(empty, 'notes'), { recursive: true });
    const still = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(still.body.total).toBe(0);

    process.env.DOCS_ROOT = root;
  });
});
