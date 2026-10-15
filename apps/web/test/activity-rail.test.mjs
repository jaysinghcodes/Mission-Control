/**
 * Office, Calendar, and System share activityRailLine. A snapshot names the
 * agent, a roster refresh is omitted, and no row text is an event type.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const gen = new URL('./_gen/', import.meta.url)
await mkdir(gen, { recursive: true })

async function compile(rel, outName) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const js = outputText
    .replaceAll("from './activity-text'", "from './activity-text.js'")
    .replaceAll("from './live-work'", "from './live-work.js'")
  const out = new URL(outName, gen)
  await writeFile(out, js)
  return out
}

await compile('../src/lib/activity-text.ts', 'activity-text.js')
await compile('../src/lib/live-work.ts', 'live-work.js')
await compile('../src/lib/activity-rail.ts', 'activity-rail.js')
const rail = await import(new URL('activity-rail.js', gen))

const roster = [{ id: 'live_quill', name: 'Live Quill', role: 'writer' }]
const EVENT_TYPE = /\b(?:agents|agent|run|ticket|health|approval)\.[a-z0-9_.]+\b/

const feed = [
  { type: 'agents.snapshot', payload: { id: 'live_quill', source: 'registered', action: 'register' } },
  { type: 'agent.status', payload: { id: 'live_quill', status: 'working' } },
  { type: 'agent.status', payload: { name: 'Live Quill is now working', agent: 'Live Quill', status: 'working' } },
  { type: 'agents.snapshot', payload: { id: 'live_quill', source: 'registered', action: 'delete' } },
  { type: 'agents.snapshot', payload: { agents: [{ id: 'live_quill', name: 'Live Quill' }] } },
  { type: 'agents.snapshot', payload: { id: 'live_quill', action: 'heartbeat' } },
  { type: 'run.progress', payload: { name: 'MC-151 moved to QA', agent: 'Live Quill', ticket: 'MC-151' } },
  { type: 'agents.snapshot', payload: {} },
]

test('Office, Calendar, and System name the agent and never show an event type', async () => {
  const pages = ['Office.tsx', 'Calendar.tsx', 'System.tsx']
  for (const page of pages) {
    const src = await readFile(new URL(`../src/pages/${page}`, import.meta.url), 'utf8')
    assert.match(src, /activityRailLine\(/, page)
    assert.equal(src.includes('activityText('), false, page)
  }

  const lines = feed
    .map((event) => rail.activityRailLine(event, roster))
    .filter((line) => line != null)

  assert.deepEqual(lines.map((line) => line.text), [
    'Live Quill registered',
    'Live Quill is now working',
    'Live Quill is now working',
    'Live Quill went offline',
    'MC-151 moved to QA',
  ])
  assert.equal(lines[0].actor.name, 'Live Quill')
  const offline = lines.find((line) => line.text === 'Live Quill went offline')
  assert.equal(offline.actor.id, 'live_quill')
  for (const line of lines) {
    assert.equal(EVENT_TYPE.test(line.text), false, line.text)
    assert.equal(line.text.includes('Update'), false, line.text)
  }
})
