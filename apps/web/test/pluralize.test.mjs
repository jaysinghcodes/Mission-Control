/**
 * pluralize(count, singular, plural?) for 0, 1, and 2.
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

const { pluralize } = await loadTs('../src/lib/pluralize.ts')

test('a regular noun for 0, 1, and 2', () => {
  assert.equal(pluralize(0, 'agent'), '0 agents')
  assert.equal(pluralize(1, 'agent'), '1 agent')
  assert.equal(pluralize(2, 'agent'), '2 agents')
})

test('an irregular noun for 0, 1, and 2', () => {
  assert.equal(pluralize(0, 'person', 'people'), '0 people')
  assert.equal(pluralize(1, 'person', 'people'), '1 person')
  assert.equal(pluralize(2, 'person', 'people'), '2 people')
  assert.equal(pluralize(0, 'memory', 'memories'), '0 memories')
  assert.equal(pluralize(1, 'memory', 'memories'), '1 memory')
  assert.equal(pluralize(2, 'memory', 'memories'), '2 memories')
})

test('a phrase that does not take an s for 0, 1, and 2', () => {
  assert.equal(pluralize(0, 'in progress', 'in progress'), '0 in progress')
  assert.equal(pluralize(1, 'in progress', 'in progress'), '1 in progress')
  assert.equal(pluralize(2, 'in progress', 'in progress'), '2 in progress')
  assert.equal(pluralize(0, 'needs you', 'need you'), '0 need you')
  assert.equal(pluralize(1, 'needs you', 'need you'), '1 needs you')
  assert.equal(pluralize(2, 'needs you', 'need you'), '2 need you')
})
