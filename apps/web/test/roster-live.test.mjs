/**
 * Criterion 7. An agents.snapshot event is what makes an open roster refetch.
 * The pages that show the roster call useRosterLive. Robot art is unchanged.
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

const live = await loadTs('../src/lib/roster-live.ts')

test('criterion 7: a register or delete snapshot is newer than the last refetch', () => {
  const seen = 1_000
  const quiet = live.rosterRefreshTs(seen, [
    { type: 'run.started', ts: 5_000 },
    { type: 'hello', ts: 6_000 },
  ])
  assert.equal(quiet, null)

  const registered = live.rosterRefreshTs(seen, [
    { type: 'run.started', ts: 5_000 },
    { type: 'agents.snapshot', ts: 2_000 },
  ])
  assert.equal(registered, 2_000)

  const deleted = live.rosterRefreshTs(registered, [
    { type: 'agents.snapshot', ts: 2_000 },
    { type: 'agents.snapshot', ts: 2_500 },
  ])
  assert.equal(deleted, 2_500)
  assert.ok(deleted - registered < 2_000)
})

test('criterion 7: Agents, Office, and Team refetch on that event', async () => {
  for (const rel of ['../src/pages/Agents.tsx', '../src/pages/Office.tsx', '../src/pages/Team.tsx']) {
    const src = await readFile(new URL(rel, import.meta.url), 'utf8')
    assert.match(src, /useRosterLive\(/)
    assert.match(src, /useRosterLive\([^)]*connected/)
  }
  const hook = await readFile(new URL('../src/lib/useRosterLive.ts', import.meta.url), 'utf8')
  assert.match(hook, /rosterRefreshTs/)
  assert.match(hook, /rosterConnectRefresh/)
  assert.match(hook, /refetch\(/)
})

test('a socket connect refetches before the next poll', () => {
  assert.equal(live.rosterConnectRefresh(false, false), false)
  assert.equal(live.rosterConnectRefresh(false, true), true)
  assert.equal(live.rosterConnectRefresh(true, true), false)
  assert.equal(live.rosterConnectRefresh(true, false), false)
})
