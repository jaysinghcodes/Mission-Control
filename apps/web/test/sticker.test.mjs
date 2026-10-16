/**
 * Stickers, colors, and status dots resolve by agent id.
 * A display name must not select a crew bot on any surface.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const pagesDir = new URL('../src/pages/', import.meta.url)
const pages = (await readdir(pagesDir)).filter((name) => name.endsWith('.tsx'))

const SURFACES = [
  'Activity.tsx',
  'Office.tsx',
  'Memory.tsx',
  'Docs.tsx',
  'Calendar.tsx',
  'System.tsx',
  'Approvals.tsx',
  'Tickets.tsx',
]

const NAME_MATCH = [
  /findByLabel/,
  /\.name\.toLowerCase\(\)\s*===/,
  /presentAgent\([^)]*\)\.name\.toLowerCase\(\)/,
]

test('every sticker surface resolves by agent id', async () => {
  for (const name of SURFACES) {
    const src = await readFile(new URL(name, pagesDir), 'utf8')
    assert.match(src, /resolveSticker/, name)
    for (const pattern of NAME_MATCH) {
      assert.equal(pattern.test(src), false, `${name} matches ${pattern}`)
    }
  }
})

test('no page matches a sticker by display name', async () => {
  for (const name of pages) {
    const src = await readFile(new URL(name, pagesDir), 'utf8')
    for (const pattern of NAME_MATCH) {
      assert.equal(pattern.test(src), false, `${name} matches ${pattern}`)
    }
  }
  const live = await readFile(new URL('../src/lib/live-work.ts', import.meta.url), 'utf8')
  assert.equal(live.includes('agent.name.toLowerCase()'), false)
  assert.equal(live.includes('findByLabel'), false)
  const naming = await readFile(new URL('../src/lib/naming.tsx', import.meta.url), 'utf8')
  assert.equal(naming.includes('findByLabel'), false)
})
