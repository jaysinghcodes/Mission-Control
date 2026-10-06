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
        '[vb](vbscript:msgbox(1))',
        '<iframe src="https://evil.example"></iframe>',
        '[ok](https://example.com)',
      ].join('\n\n'),
    );
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).not.toMatch(/<iframe[\s>]/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
    for (const href of hrefs(html)) {
      expect(isSafeLink(href)).toBe(true);
      expect(href.toLowerCase()).not.toContain('javascript:');
      expect(href.toLowerCase()).not.toContain('data:');
    }
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;iframe');
    expect(html).toContain('onerror');
  });

  it('keeps a link title and the text after it', () => {
    const html = renderMarkdown(
      'Read the [setup guide](https://example.com/setup "See onclick=") then continue.',
    );
    expect(html).toContain('href="https://example.com/setup"');
    expect(html).toContain('title="See onclick="');
    expect(html).toContain('>setup guide</a>');
    expect(html).toContain('then continue.');
  });

  it('keeps onclick="y" inside inline code and a fenced block', () => {
    const html = renderMarkdown(
      [
        'Call `onclick="y"` from the handler.',
        '',
        '```html',
        '<button onclick="y">Go</button>',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<code>onclick=&quot;y&quot;</code>');
    expect(html).toContain('&lt;button onclick=&quot;y&quot;&gt;');
    expect(html.match(/<\/code>/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[\s>]/i);
  });

  it('keeps onion=1 in prose', () => {
    const html = renderMarkdown('Set onion=1 before you restart the service.');
    expect(html).toContain('onion=1');
    expect(html).toContain('before you restart the service.');
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
