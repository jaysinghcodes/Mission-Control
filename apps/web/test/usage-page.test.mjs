/**
 * Usage is a real page. Cost copy uses the exact unknown price label.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Usage is a route and names Price not set', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /path="\/usage" element=\{<Usage/)
  assert.doesNotMatch(app, /path="\/usage" element=\{<Navigate/)

  const page = await readFile(new URL('../src/pages/Usage.tsx', import.meta.url), 'utf8')
  assert.match(page, /Price not set/)
  assert.match(page, /No usage yet/)
  assert.match(page, /Ollama and any local provider are \$0\.00/)
  assert.equal(/[\u2012\u2013\u2014\u2015→←]/.test(page), false)
})
