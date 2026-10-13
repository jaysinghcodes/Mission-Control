import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the sidebar does not render window dots', async () => {
  const source = await readFile(new URL('../src/layout/AppLayout.tsx', import.meta.url), 'utf8')
  assert.equal(source.includes('#ff5f57'), false)
  assert.equal(source.includes('#febc2e'), false)
  assert.equal(source.includes('#28c840'), false)
  assert.equal(source.includes('traffic light'), false)
  assert.match(source, /aria-label="Primary"/)
  assert.match(source, /Account menu/)
})
