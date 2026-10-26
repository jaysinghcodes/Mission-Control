import { mkdir, mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  configuredDocsRoot,
  docsHostDir,
  DocsPathError,
  openDocsRoot,
  resolveDocFile,
} from './docs-path';

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mc-docs-path-'));
  await mkdir(path.join(root, 'notes'), { recursive: true });
  await writeFile(path.join(root, 'notes', 'ok.md'), '# Ok\n', 'utf8');
  await writeFile(
    path.join(root, 'notes', 'Café checklist.md'),
    '# Café\n',
    'utf8',
  );
  return root;
}

describe('docs path sandbox', () => {
  it('opens a root-relative file, including spaces and unicode', async () => {
    const root = await tempRoot();
    const ok = resolveDocFile(root, 'notes/ok.md');
    expect(ok.relative).toBe('notes/ok.md');
    const cafe = resolveDocFile(root, 'notes/Café checklist.md');
    expect(cafe.relative).toBe('notes/Café checklist.md');
  });

  it('refuses .., absolute paths, backslashes, null bytes, and encoded traversal', async () => {
    const root = await tempRoot();
    const refused = [
      '../../etc/passwd',
      'notes/../../etc/passwd',
      '/etc/passwd',
      '..\\..\\etc\\passwd',
      'notes/ok.md\0',
      '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '%252e%252e%252f%252e%252e%252fetc%252fpasswd',
      '%2e%2e/%2e%2e/etc/passwd',
    ];
    for (const slug of refused) {
      expect(() => resolveDocFile(root, slug)).toThrow(DocsPathError);
      try {
        resolveDocFile(root, slug);
      } catch (err) {
        expect(err).toBeInstanceOf(DocsPathError);
        expect((err as DocsPathError).status).toBe(400);
      }
    }
  });

  it('returns 404 for a missing file and 400 when a symlink leaves the root', async () => {
    const root = await tempRoot();
    try {
      resolveDocFile(root, 'notes/missing.md');
      throw new Error('expected 404');
    } catch (err) {
      expect(err).toBeInstanceOf(DocsPathError);
      expect((err as DocsPathError).status).toBe(404);
    }

    const outside = await mkdtemp(path.join(tmpdir(), 'mc-docs-outside-'));
    const secret = 'SECRET_SENTINEL_passwd';
    await writeFile(path.join(outside, 'secret.md'), secret, 'utf8');
    await symlink(
      path.join(outside, 'secret.md'),
      path.join(root, 'notes', 'leak.md'),
    );
    try {
      resolveDocFile(root, 'notes/leak.md');
      throw new Error('expected symlink escape to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(DocsPathError);
      expect((err as DocsPathError).status).toBe(400);
      expect((err as Error).message).not.toContain(secret);
    }

    await symlink(
      path.join(root, 'notes', 'ok.md'),
      path.join(root, 'notes', 'alias.md'),
    );
    expect(resolveDocFile(root, 'notes/alias.md').relative).toBe(
      'notes/alias.md',
    );
  });

  it('treats a missing root as closed', async () => {
    expect(
      openDocsRoot(path.join(tmpdir(), 'mc-docs-no-such-root')),
    ).toBeNull();
    const empty = await mkdtemp(path.join(tmpdir(), 'mc-docs-empty-'));
    expect(openDocsRoot(empty)).toBeTruthy();
  });

  it('names a host folder for the empty state (issue 117)', () => {
    expect(docsHostDir({ DOCS_ROOT: '/srv/docs' })).toBe('/srv/docs');
    expect(docsHostDir({})).toBe(configuredDocsRoot());
    const compose = { MC_COMPOSE: '1', DOCS_ROOT: '/data/docs' };
    expect(
      docsHostDir({ ...compose, MC_DOCS_HOST_PATH: '/home/jay/mc/data/docs' }),
    ).toBe('/home/jay/mc/data/docs');
    expect(docsHostDir({ ...compose, MC_DOCS_HOST_PATH: '/srv/notes//' })).toBe(
      '/srv/notes',
    );
    expect(docsHostDir({ ...compose, MC_DOCS_HOST_PATH: './data/docs' })).toBe(
      'data/docs',
    );
    expect(docsHostDir({ ...compose, MC_DOCS_HOST_PATH: 'notes/' })).toBe(
      'notes',
    );
    expect(docsHostDir({ ...compose, MC_DOCS_HOST_PATH: '../outside' })).toBe(
      '../outside',
    );
    expect(docsHostDir({ ...compose, MC_DOCS_HOST_PATH: '' })).toBeNull();
    expect(
      docsHostDir({ ...compose, MC_DOCS_HOST_PATH: '/data/docs' }),
    ).toBeNull();
    expect(docsHostDir(compose)).toBeNull();
  });
});
