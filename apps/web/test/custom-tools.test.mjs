/**
 * Ticket 10 — Experimental label, and tool text that must stay text.
 * `<script>` in a preview or a saved field is escaped markup, never an element.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { Window } from 'happy-dom'

const gen = new URL('./_gen/', import.meta.url)
await mkdir(gen, { recursive: true })

const src = await readFile(new URL('../src/components/tool-preview.tsx', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
const out = new URL('tool-preview.js', gen)
await writeFile(out, outputText)

const { createElement: h } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { ExperimentalBadge, FilledPrompt, PlainText } = await import(out)

const PAYLOAD = '<script>alert(1)</script><img src=x onerror=alert(1)>'

function mount(node) {
  const markup = renderToStaticMarkup(node)
  const window = new Window()
  let ran = false
  window.eval = () => {
    ran = true
  }
  window.document.body.innerHTML = markup
  return { markup, window, ran }
}

test('the experimental label is visible text', () => {
  const { markup, window } = mount(h(ExperimentalBadge))
  assert.match(markup, /Experimental/)
  assert.equal(window.document.querySelector('[data-testid="experimental-label"]').textContent, 'Experimental')
})

test('a script in the filled prompt is text and does not run', () => {
  const { markup, window, ran } = mount(h(FilledPrompt, { text: PAYLOAD }))
  assert.equal(markup.includes('<script'), false)
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.equal(window.document.querySelector('script'), null)
  assert.equal(window.document.querySelector('img'), null)
  assert.equal(window.document.querySelector('[data-testid="filled-prompt"]').textContent, PAYLOAD)
  assert.equal(ran, false)
})

test('saved tool fields render the same payload as text', () => {
  const { markup, window, ran } = mount(h(PlainText, { text: PAYLOAD }))
  assert.equal(markup.includes('<script'), false)
  assert.equal(markup.includes('<img'), false)
  assert.equal(window.document.body.textContent, PAYLOAD)
  assert.equal(ran, false)
})

test('the custom tools page shows the experimental label and does not inject HTML', async () => {
  const page = await readFile(new URL('../src/pages/CustomTools.tsx', import.meta.url), 'utf8')
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(page, /ExperimentalBadge/)
  assert.match(page, /FilledPrompt/)
  assert.match(page, /PlainText/)
  assert.match(page, /\{\{topic\}\}/)
  assert.equal(page.includes('dangerouslySetInnerHTML'), false)
  assert.match(system, /Custom tools/)
  assert.match(system, /Experimental/)
  assert.match(system, /panel === 'tools'/)
})
