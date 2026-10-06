import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { DEMO_DOC_AUTHORS, DEMO_DOCS, writeDemoDocs } from './demo-docs';
import { isSafeLink, renderMarkdown } from './render-markdown';

describe('writeDemoDocs', () => {
  it('writes the sample set once, with the required shapes and roster authors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mc-docs-seed-'));
    const first = await writeDemoDocs(root);
    expect(first.written).toBe(DEMO_DOCS.length);
    expect(first.skipped).toBe(0);

    const second = await writeDemoDocs(root);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(DEMO_DOCS.length);

    const rich = DEMO_DOCS.find((doc) => doc.relative === 'specs/app-redesign.md');
    const broken = DEMO_DOCS.find((doc) => doc.relative === 'notes/broken-markdown.md');
    const unicode = DEMO_DOCS.find((doc) => doc.relative === 'notes/Café checklist.md');
    expect(rich).toBeTruthy();
    expect(broken).toBeTruthy();
    expect(unicode).toBeTruthy();
    expect(unicode!.relative).toMatch(/ /);
    expect(unicode!.relative).toMatch(/[^\u0000-\u007f]/);

    const onDisk = await readFile(path.join(root, ...unicode!.relative.split('/')), 'utf8');
    expect(onDisk).toContain('author: Echo');
    expect(DEMO_DOC_AUTHORS).toContain('Echo');

    for (const doc of DEMO_DOCS) {
      const author = /^author: (.+)$/m.exec(doc.contents)?.[1];
      expect(DEMO_DOC_AUTHORS).toContain(author);
      const bytes = await readFile(path.join(root, ...doc.relative.split('/')), 'utf8');
      expect(bytes).toBe(doc.contents);
    }

    expect(rich!.contents).toMatch(/^# /m);
    expect(rich!.contents).toMatch(/```/);
    expect(rich!.contents).toMatch(/\]\(https?:/);
    expect(rich!.contents).toMatch(/\]\(#\/connect\)/);

    expect(() => renderMarkdown(broken!.contents)).not.toThrow();
    const html = renderMarkdown(broken!.contents);
    expect(html).not.toMatch(/<script[\s>]/i);
    for (const href of [...html.matchAll(/\shref\s*=\s*"([^"]*)"/gi)].map((match) => match[1])) {
      expect(isSafeLink(href)).toBe(true);
    }
  });

  it('does not overwrite a file that is already there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mc-docs-seed-keep-'));
    await writeDemoDocs(root);
    const target = path.join(root, 'specs', 'app-redesign.md');
    await writeFile(target, 'edited by a person\n', 'utf8');
    const again = await writeDemoDocs(root);
    expect(again.written).toBe(0);
    expect(await readFile(target, 'utf8')).toBe('edited by a person\n');
  });
});
