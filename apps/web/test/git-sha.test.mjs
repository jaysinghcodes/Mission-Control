/**
 * The System Git cell shows the short sha on one line, full sha in the tooltip (#116).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function loadTs(rel) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const { shortSha } = await loadTs('../src/lib/git-sha.ts')

test('a full sha shows 7 characters and keeps the full value for the tooltip', () => {
  const full = 'ca49255b153ea232ca1650cdcf76e5b44bda827c'
  assert.deepEqual(shortSha(full), { text: 'ca49255', title: full })
  assert.deepEqual(shortSha(`  ${full}\n`), { text: 'ca49255', title: full })
})

test('a short sha, a missing sha and a non hex value', () => {
  assert.deepEqual(shortSha('ca49255'), { text: 'ca49255', title: 'ca49255' })
  assert.deepEqual(shortSha(null), { text: 'Not reported', title: null })
  assert.deepEqual(shortSha('  '), { text: 'Not reported', title: null })
  assert.deepEqual(shortSha('dev'), { text: 'dev', title: 'dev' })
})

test('System renders the Git cell with shortSha, a title, and no wrapping', async () => {
  const page = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(page, /from '\.\.\/lib\/git-sha'/)
  assert.match(page, /const gitSha = shortSha\(health\.data\?\.gitSha\)/)
  const cell = page.match(/<Fact label="Git"[^>]*\/>/)
  assert.ok(cell, 'Git cell')
  assert.equal(cell[0], '<Fact label="Git" value={gitSha.text} title={gitSha.title} />')
  assert.doesNotMatch(cell[0], /\bwrap\b/)
  assert.match(page, /\$\{wrap \? 'break-all' : 'whitespace-nowrap'\}`\} title=\{title \?\? undefined\}/)
})
