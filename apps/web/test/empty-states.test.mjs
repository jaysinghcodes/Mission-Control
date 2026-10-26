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
  const docsEmpty = await source('../src/lib/docs-empty.ts')
  const sessions = await source('../src/pages/Sessions.tsx')
  const team = await source('../src/pages/Team.tsx')
  const deviceStatus = await source('../src/lib/device-status.ts')
  for (const text of [approvals, logs, docs, docsEmpty, sessions, team, deviceStatus]) {
    assert.equal(DASH.test(text), false)
    assert.equal(text.includes('->'), false)
  }
  assert.match(approvals, /Set MC_BRIDGE_APPROVALS_CMD/)
  assert.match(approvals, /bridge posts approvals from MC_BRIDGE_APPROVALS_CMD/)
  assert.match(logs, /Looking in \{data\.dir\}/)
  assert.doesNotMatch(logs, /\/tmp\/openclaw/)
  assert.match(docs, /docsEmptyCopy\(data\?\.dir\)/)
  assert.match(docs, /body=\{emptyCopy\.lead\}/)
  assert.match(docs, /data-docs-folder/)
  assert.match(docsEmpty, /No markdown in this folder on the host:/)
  assert.match(docsEmpty, /DOCS_ROOT sets that folder/)
  assert.doesNotMatch(docs + docsEmpty, /\/data\/docs/)
  assert.match(sessions, /sessions\.snapshot/)
  assert.match(team, /openclaw devices list/)
  assert.match(team, /openclaw nodes list/)
  assert.match(deviceStatus, /Requested /)
  assert.match(deviceStatus, /Paired /)
  assert.match(deviceStatus, /Last seen /)
})

test('the Docs empty state names the host folder, never the container path (issue 117)', async () => {
  const src = await source('../src/lib/docs-empty.ts')
  const ts = (await import('typescript')).default
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const lib = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
  assert.deepEqual(lib.docsEmptyCopy('/home/jay/mission-control/data/docs'), {
    lead: 'No markdown in this folder on the host:',
    folder: '/home/jay/mission-control/data/docs',
    tail: 'DOCS_ROOT sets that folder. npm run seed:demo writes sample docs. This page does not read a path you type.',
  })
  assert.deepEqual(lib.docsEmptyCopy('data/docs'), {
    lead: 'No markdown in this folder, relative to the Mission Control folder:',
    folder: 'data/docs',
    tail: 'DOCS_ROOT sets that folder. npm run seed:demo writes sample docs. This page does not read a path you type.',
  })
  assert.equal(lib.docsEmptyCopy(null).folder, null)
  assert.match(lib.docsEmptyBody(null), /^No markdown yet\. DOCS_ROOT sets the folder \(the default is data\/docs\)\./)
  assert.match(lib.docsEmptyBody('  '), /^No markdown yet\./)
  for (const dir of ['/srv/docs', 'data/docs', null]) {
    assert.equal(DASH.test(lib.docsEmptyBody(dir)), false)
  }
})
