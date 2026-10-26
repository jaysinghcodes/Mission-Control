/**
 * Issue 115. A Settings save in one tab reaches every open tab, and a
 * revoke sends every other browser to the sign in form.
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

const crew = await loadTs('../src/lib/crew.ts')
const drop = await loadTs('../src/lib/session-drop.ts')

test('settings.changed refetches settings once per new event', () => {
  const events = [{ type: 'settings.changed', ts: 10, fields: ['namingMode', 'crewMap'] }]
  assert.equal(crew.namingRefreshTs(0, events), 10)
  assert.equal(crew.namingRefreshTs(10, events), null)
  events.unshift({ type: 'settings.changed', ts: 12, fields: ['crewMap'] })
  assert.equal(crew.namingRefreshTs(10, events), 12)
})

test('a heartbeat still does not refetch, and other events do not either', () => {
  const events = [
    { type: 'agents.snapshot', ts: 5, action: 'heartbeat' },
    { type: 'agent.status', ts: 6 },
    { type: 'health.tick', ts: 7 },
  ]
  assert.equal(crew.namingRefreshTs(0, events), null)
  events.push({ type: 'settings.changed', ts: 8, action: 'heartbeat' })
  assert.equal(crew.namingRefreshTs(0, events), 8)
})

test('only a server drop makes a signed in tab read the session again', () => {
  assert.equal(drop.SERVER_DROP_REASON, 'io server disconnect')
  assert.equal(drop.sessionDropAction('io server disconnect'), 'recheck')
  for (const reason of ['transport close', 'transport error', 'ping timeout', 'io client disconnect', 'parse error']) {
    assert.equal(drop.sessionDropAction(reason), 'ignore', reason)
  }
})

test('the session gate watches for a revoke only while signed in remotely', async () => {
  const session = await readFile(new URL('../src/lib/session.tsx', import.meta.url), 'utf8')
  assert.match(session, /useRevokeWatch\(Boolean\(info && info\.loginRequired && info\.authenticated\), recheck\)/)
  assert.match(session, /sessionDropAction\(reason\) !== 'recheck'/)
  assert.match(session, /withCredentials: true/)
  assert.match(session, /autoConnect: false/)
  // A failed read keeps the tab as is. The offline screen is not shown for a drop.
  const recheck = session.split('const recheck = useCallback')[1]?.split('useRevokeWatch(')[0] ?? ''
  assert.match(recheck, /if \(!next\) return true/)
  assert.equal(recheck.includes('setOffline'), false)
})

test('Office, Agents and Team read naming from the provider that refetches', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const naming = await readFile(new URL('../src/lib/naming.tsx', import.meta.url), 'utf8')
  assert.match(app, /<NamingProvider><AppLayout \/><\/NamingProvider>/)
  assert.match(naming, /namingRefreshTs\(seenRoster\.current, events\)/)
  for (const page of ['Office', 'Agents', 'Team']) {
    const src = await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
    assert.match(src, /useNaming\(\)/, page)
  }
})
