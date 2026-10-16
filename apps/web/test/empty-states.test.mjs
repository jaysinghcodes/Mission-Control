/**
 * Fresh pages name the live source. Paths come from the API, not a UI literal.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

async function source(rel) {
  return readFile(new URL(rel, import.meta.url), 'utf8')
}

test('approvals, logs, docs, sessions, and devices explain an empty install', async () => {
  const approvals = await source('../src/pages/Approvals.tsx')
  const logs = await source('../src/pages/Logs.tsx')
  const docs = await source('../src/pages/Docs.tsx')
  const sessions = await source('../src/pages/Sessions.tsx')
  const team = await source('../src/pages/Team.tsx')
  for (const text of [approvals, logs, docs, sessions, team]) {
    assert.equal(DASH.test(text), false)
    assert.equal(text.includes('->'), false)
  }
  assert.match(approvals, /Set MC_BRIDGE_APPROVALS_CMD/)
  assert.match(approvals, /bridge posts approvals from MC_BRIDGE_APPROVALS_CMD/)
  assert.match(logs, /Looking in \{data\.dir\}/)
  assert.doesNotMatch(logs, /\/tmp\/openclaw/)
  assert.match(docs, /No markdown in \$\{data\.dir\}/)
  assert.match(docs, /DOCS_ROOT sets that folder/)
  assert.match(sessions, /sessions\.snapshot/)
  assert.match(team, /openclaw devices list/)
  assert.match(team, /openclaw nodes list/)
})
