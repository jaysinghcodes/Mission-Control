/**
 * Issue 167: Esc closes the overlays Cancel, Close, or the backdrop already close.
 * Issue 168: Agents shows an empty message when search or filter hides every card.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

async function source(rel) {
  return readFile(new URL(rel, import.meta.url), 'utf8')
}

async function load(rel) {
  const ts = (await import('typescript')).default
  const { outputText } = ts.transpileModule(await source(rel), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}

test('Esc closes the remove confirm, the Team sheets, and the ticket card (issue 167)', async () => {
  const hook = await source('../src/lib/useEscape.ts')
  assert.match(hook, /e\.key !== 'Escape'/)
  assert.match(hook, /addEventListener\('keydown'/)
  assert.match(hook, /removeEventListener\('keydown'/)

  const settings = await source('../src/pages/Settings.tsx')
  assert.match(settings, /useEscape\(\(\) => setPending\(null\), pending !== null && !removing\)/)
  assert.match(settings, /onClick=\{\(\) => \{ if \(!removing\) setPending\(null\) \}\}/)

  const team = await source('../src/pages/Team.tsx')
  const sheet = team.slice(team.indexOf('function Sheet('))
  assert.match(sheet, /useEscape\(onClose\)/)
  assert.match(sheet, /onClick=\{onClose\}/)
  assert.match(team, /<Sheet title="Invite a teammate" onClose=\{\(\) => setInvite\(false\)\}>/)
  assert.match(team, /<Sheet title="Pair a device" onClose=\{\(\) => setPair\(false\)\}/)

  const tickets = await source('../src/pages/Tickets.tsx')
  assert.match(tickets, /useEscape\(\(\) => setDetailId\(null\), detail !== null\)/)
  assert.match(tickets, /onClick=\{\(\) => setDetailId\(null\)\}[^>]*>Close</)

  // Tickets.tsx keeps older dashed comments; its new lines carry no UI copy.
  for (const text of [hook, settings, team]) assert.equal(DASH.test(text), false)
})

test('Agents shows a no match message for search and filter (issue 168)', async () => {
  const page = await source('../src/pages/Agents.tsx')
  assert.match(page, /data && roster\.length > 0 && visible\.length === 0/)
  assert.match(page, /data-agents-no-match/)
  assert.match(page, /agentsNoMatchBody\(query, filter\)/)

  const copySrc = await source('../src/lib/agents-empty.ts')
  assert.equal(DASH.test(copySrc), false)
  assert.equal(copySrc.includes('->'), false)

  const { AGENTS_NO_MATCH_TITLE, agentsNoMatchBody } = await load('../src/lib/agents-empty.ts')
  assert.equal(AGENTS_NO_MATCH_TITLE, 'No agents match')
  assert.equal(agentsNoMatchBody('zzqq', 0), 'Nobody matches that search. Clear it to see every agent.')
  assert.equal(agentsNoMatchBody('  ', 1), 'Nobody is working right now. Pick All to see every agent.')
  assert.equal(agentsNoMatchBody('', 2), 'Nobody is idle right now. Pick All to see every agent.')
  assert.match(agentsNoMatchBody('zzqq', 1), /search and filter/)
  for (const q of ['', 'zzqq']) for (const f of [0, 1, 2]) {
    const body = agentsNoMatchBody(q, f)
    assert.equal(DASH.test(body), false)
    assert.equal(/\s-\s/.test(body), false)
  }
})
