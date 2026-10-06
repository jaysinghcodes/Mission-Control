import MarkdownIt from 'markdown-it';

/**
 * Markdown → HTML for the Docs reader (ticket 6).
 *
 * markdown-it with `html: false` escapes raw HTML, so a `<script>`,
 * `<iframe>`, or `onerror` handler in a note is text, not an element.
 * `validateLink` drops `javascript:`, `vbscript:`, `data:`, and `file:`
 * links, including ones hidden with whitespace or HTML entities.
 * A later pass only rewrites real `href` and `src` attributes (never
 * text or code). A broken note returns escaped text instead of throwing.
 */

const UNSAFE_PROTO = /^(javascript|vbscript|data|file):/i;

export function isSafeLink(url: string): boolean {
  const compact = String(url ?? '').replace(/[\u0000-\u001F\u007F\s]+/g, '');
  let decoded = compact;
  try {
    decoded = decodeURIComponent(compact);
  } catch {
    return false;
  }
  const probe = decoded.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  if (UNSAFE_PROTO.test(probe) || UNSAFE_PROTO.test(compact)) return false;
  return true;
}

const md = new MarkdownIt({ html: false, linkify: false, breaks: false, xhtmlOut: false });
md.validateLink = (url: string) => isSafeLink(url);

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&colon;/gi, ':')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Rewrite unsafe href/src on real tags. Raw HTML is already escaped by
 * markdown-it, so this does not scan text or code for `on...=` patterns
 * (that pass ate link titles, `</code>`, and prose like `onion=1`).
 */
function rewriteUnsafeAttrs(tag: string): string {
  return tag.replace(
    /\s(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (full, attr: string, _quoted: string, doubleQ: string | undefined, singleQ: string | undefined) => {
      const raw = doubleQ ?? singleQ ?? '';
      const quote = doubleQ !== undefined ? '"' : "'";
      if (isSafeLink(decodeEntities(raw)) && isSafeLink(raw)) return full;
      return ` ${attr}=${quote}#${quote}`;
    },
  );
}

export function hardenHtml(html: string): string {
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return stripped.replace(/<[^>]+>/g, rewriteUnsafeAttrs);
}

export function renderMarkdown(source: string): string {
  const text = typeof source === 'string' ? source : '';
  try {
    return hardenHtml(md.render(text));
  } catch {
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}
