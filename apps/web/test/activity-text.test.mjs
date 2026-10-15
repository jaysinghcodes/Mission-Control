/**
 * Activity sentences stay free of arrow characters, including stored rows.
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

const { activityText, plainActivity } = await loadTs('../src/lib/activity-text.ts')

test('a stored arrow line becomes a capitalized stage sentence', () => {
  assert.equal(activityText({ name: 'ticket MC-151 → build' }), 'MC-151 moved to Build')
  assert.equal(plainActivity('MC-151 → qa'), 'MC-151 moved to QA')
  assert.equal(plainActivity('ticket DEMO-1 → todo'), 'DEMO-1 moved to To Do')
  assert.equal(plainActivity('DEMO-5 → review'), 'DEMO-5 moved to Review')
  assert.equal(plainActivity('DEMO-6 → done'), 'DEMO-6 moved to Done')
  assert.equal(plainActivity('DEMO-3 → inprogress'), 'DEMO-3 moved to Build')
})

test('plain sentences pass through and no activity line contains an arrow', () => {
  const lines = [
    activityText({ name: 'ticket MC-151 → build' }),
    activityText({ name: 'Run started' }),
    activityText({ name: 'Forge is now working' }),
    activityText({ summary: 'left ← right' }),
    plainActivity('MC-9 → backlog'),
  ]
  assert.equal(lines[1], 'Run started')
  assert.equal(lines[2], 'Forge is now working')
  for (const line of lines) {
    assert.equal(line.includes('→'), false, line)
    assert.equal(line.includes('←'), false, line)
  }
})
