import { isSafeLink, renderMarkdown } from './render-markdown';

describe('renderMarkdown', () => {
  it('renders headings, code blocks, and safe links', () => {
    const html = renderMarkdown(
      [
        '# One purpose',
        '',
        '## Cards',
        '',
        '```ts',
        'const lanes = ["To-Do"]',
        '```',
        '',
        'See the [setup guide](#/connect) and the [repo](https://github.com/jaysinghcodes/mission-control).',
      ].join('\n'),
    );
    expect(html).toMatch(/<h1[^>]*>One purpose<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Cards<\/h2>/);
    expect(html).toMatch(/<pre><code[^>]*>/);
    expect(html).toContain('const lanes');
    expect(html).toContain('href="#/connect"');
    expect(html).toContain('href="https://github.com/jaysinghcodes/mission-control"');
  });

  it('does not execute raw HTML or javascript links', () => {
    const html = renderMarkdown(
      [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert(1)>',
        '[click](javascript:alert(1))',
        '[spaced]( javascript:alert(1))',
        '[caps](JAVASCRIPT:alert(1))',
        '[encoded](&#106;avascript:alert(1))',
        '[data](data:text/html,<script>alert(1)</script>)',
        '[ok](https://example.com)',
      ].join('\n\n'),
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    for (const href of hrefs(html)) {
      expect(isSafeLink(href)).toBe(true);
      expect(href.toLowerCase()).not.toContain('javascript:');
      expect(href.toLowerCase()).not.toContain('data:');
    }
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not throw on deliberately broken markdown', () => {
    const broken = [
      '# heading',
      '```js',
      'function oops() {',
      '  return "unclosed',
      '**bold never closes',
      '[a link that never ends](https://example.com',
      '| table | missing',
    ].join('\n');
    expect(() => renderMarkdown(broken)).not.toThrow();
    const html = renderMarkdown(broken);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toMatch(/heading/);
  });
});

function hrefs(html: string): string[] {
  return [...html.matchAll(/\shref\s*=\s*"([^"]*)"/gi)].map((match) => match[1]);
}
