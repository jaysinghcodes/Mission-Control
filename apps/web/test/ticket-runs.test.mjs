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

const runs = await loadTs('../src/lib/ticket-runs.ts')

test('a run shows on the ticket only when ticketId matches', () => {
  const rows = [
    { id: 'a', name: 'Wire calendar week view', ticketId: 'demo-ticket-3', status: 'running' },
    { id: 'b', name: 'Wire calendar week view', ticketId: null, status: 'running' },
    { id: 'c', name: 'other', ticketId: 'demo-ticket-4', status: 'done' },
  ]
  const linked = runs.runsForTicket(rows, 'demo-ticket-3')
  assert.deepEqual(linked.map((row) => row.id), ['a'])
  assert.deepEqual(runs.runsForTicket(rows, 'missing'), [])
})

test('status labels have no dash punctuation', () => {
  for (const status of ['queued', 'running', 'done', 'failed', 'needs_approval', 'nope']) {
    const label = runs.runStatusLabel(status)
    assert.equal(label.includes('-'), false)
    assert.equal(label.includes('—'), false)
  }
  assert.equal(runs.runStatusLabel('needs_approval'), 'Needs approval')
  assert.equal(runs.runStatusLabel('nope'), 'Unknown')
})
