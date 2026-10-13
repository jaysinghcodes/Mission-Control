import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the shell fills the viewport and has no window frame', async () => {
  const layout = await readFile(new URL('../src/layout/AppLayout.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.equal(layout.includes('bg-[var(--mc-desk)]'), false)
  assert.equal(layout.includes('p-3 sm:p-4'), false)
  assert.match(layout, /className="mc-window relative flex h-dvh w-screen overflow-hidden"/)
  const start = css.indexOf('.mc-window {')
  assert.notEqual(start, -1)
  const rule = css.slice(start, css.indexOf('}', start))
  assert.match(rule, /width:\s*100vw/)
  assert.match(rule, /height:\s*100dvh/)
  assert.match(rule, /border-radius:\s*0/)
  assert.match(rule, /box-shadow:\s*none/)
  assert.match(rule, /border:\s*0/)
  assert.equal(rule.includes('14px'), false)
  assert.equal(css.includes('.light .mc-window'), false)
  assert.match(css, /html, body, #root \{[^}]*overflow:\s*hidden/s)
  assert.match(css, /background-color:\s*var\(--mc-win\)/)
})
