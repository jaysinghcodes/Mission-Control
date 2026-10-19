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
    .replaceAll("from './crew'", "from './crew.js'")
  const out = new URL(outName, gen)
  await writeFile(out, js)
  return out
}

await compile('../src/lib/activity-text.ts', 'activity-text.js')
await compile('../src/lib/live-work.ts', 'live-work.js')
await compile('../src/lib/crew.ts', 'crew.js')
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

test('activity text uses the seated crew name from the current map', async () => {
  const pages = ['Office.tsx', 'Activity.tsx', 'Calendar.tsx', 'System.tsx']
  for (const page of pages) {
    const src = await readFile(new URL(`../src/pages/${page}`, import.meta.url), 'utf8')
    assert.match(src, /activityRailLine\([\s\S]*naming\)/, page)
  }
  const search = await readFile(new URL('../src/components/SearchBox.tsx', import.meta.url), 'utf8')
  assert.match(search, /activityRailLine\(hit, \[\], \[\], \[\], naming\)/)
  const office = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  assert.match(office, /actor\?\.name/)
  const activityPage = await readFile(new URL('../src/pages/Activity.tsx', import.meta.url), 'utf8')
  assert.match(activityPage, /line\.actor\?\.name/)

  const roster = [
    { id: 'helper', name: 'Pixel', role: 'helper' },
    { id: 'other', name: 'Speedy', role: 'decoy' },
  ]
  const seats = [
    { id: 'speedy', name: 'Speedy', role: 'Chief of Staff', desk: 'Lead table', color: '#8d5bff' },
    { id: 'quill', name: 'Quill', role: 'Writer', desk: 'Writing desk', color: '#d257ef' },
  ]
  const crew = { mode: 'crew', map: { helper: 'speedy' }, seats }
  const event = {
    type: 'agents.snapshot',
    payload: { id: 'helper', agent: 'helper', action: 'register', name: 'Pixel registered' },
  }

  const seated = rail.activityRailLine(event, roster, [], [], crew)
  assert.equal(seated.text, 'Speedy registered')
  assert.equal(seated.actor.id, 'helper')
  assert.equal(seated.actor.name, 'Speedy')

  const moved = rail.activityRailLine(event, roster, [], [], { ...crew, map: { helper: 'quill' } })
  assert.equal(moved.text, 'Quill registered')
  assert.equal(moved.actor.name, 'Quill')

  const own = rail.activityRailLine(event, roster, [], [], { mode: 'own', map: { helper: 'speedy' }, seats })
  assert.equal(own.text, 'Pixel registered')
  assert.equal(own.actor.name, 'Pixel')

  const open = rail.activityRailLine(event, roster, [], [], { mode: 'crew', map: {}, seats })
  assert.equal(open.text, 'Pixel registered')

  const byName = rail.activityRailLine(
    { type: 'agents.snapshot', payload: { agent: 'Pixel', action: 'register', name: 'Pixel registered' } },
    roster,
    [],
    [],
    crew,
  )
  assert.equal(byName.actor.id, 'Pixel')
  assert.equal(byName.text, 'Pixel registered')

  const departed = rail.activityRailLine(
    {
      type: 'agents.snapshot',
      payload: {
        id: 'rail_quill',
        agent: 'rail_quill',
        action: 'delete',
        name: 'Rail Quill went offline',
      },
    },
    roster,
    [],
    [],
    crew,
  )
  assert.equal(departed.text, 'Rail Quill went offline')
  assert.equal(departed.actor.name, 'Rail Quill')

  const stillSeated = rail.activityRailLine(
    {
      type: 'agents.snapshot',
      payload: { id: 'helper', agent: 'helper', action: 'delete', name: 'Pixel went offline' },
    },
    [],
    [],
    [],
    crew,
  )
  assert.equal(stillSeated.text, 'Speedy went offline')
  assert.equal(stillSeated.actor.name, 'Speedy')

  const ticket = rail.activityRailLine(
    { type: 'run.progress', payload: { id: 'helper', agent: 'helper', name: 'MC-151 moved to QA', ticket: 'MC-151' } },
    roster,
    [],
    [],
    crew,
  )
  assert.equal(ticket.text, 'MC-151 moved to QA')
  assert.equal(ticket.actor.name, 'Speedy')
})
