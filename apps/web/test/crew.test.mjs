/**
 * Naming display rules. Seat names live in config/crew.json.
 * This file checks the apply function, not a second copy of the crew.
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

const seats = [
  { id: 'speedy', name: 'Speedy', role: 'Chief of Staff', desk: 'Lead table', color: '#8d5bff' },
  { id: 'forge', name: 'Forge', role: 'Engineer', desk: 'Build desk', color: '#9bd434' },
]

test('own names mode shows main and dev exactly as stored', () => {
  const state = { mode: 'own', map: { main: 'speedy', dev: 'forge' }, seats }
  const main = crew.presentAgent({ id: 'main', name: 'main', role: 'dev', color: '#112233' }, state)
  assert.deepEqual(main, { name: 'main', role: 'dev', color: '#112233', desk: null })
  const dev = crew.presentAgent({ id: 'dev', name: 'dev', role: 'qa', color: 'nope' }, state)
  assert.equal(dev.name, 'dev')
  assert.equal(dev.role, 'qa')
  assert.equal(dev.color, '#58A6FF')
  assert.equal(dev.desk, null)
})

test('crew mode applies the seat saved for that agent id', () => {
  const state = { mode: 'crew', map: { main: 'speedy' }, seats }
  const shown = crew.presentAgent({ id: 'main', name: 'main', role: 'dev', color: '#112233' }, state)
  assert.equal(shown.name, 'Speedy')
  assert.equal(shown.role, 'Chief of Staff')
  assert.equal(shown.color, '#8d5bff')
  assert.equal(shown.desk, 'Lead table')
  const other = crew.presentAgent({ id: 'dev', name: 'dev', role: 'qa', color: '#abcdef' }, state)
  assert.equal(other.name, 'dev')
  assert.equal(other.desk, null)
})

test('a role word does not pick a seat when the map is empty', () => {
  const state = { mode: 'crew', map: {}, seats }
  const shown = crew.presentAgent({ id: 'qa-bot', name: 'qa-bot', role: 'qa', color: '#abcdef' }, state)
  assert.equal(shown.name, 'qa-bot')
  assert.equal(shown.role, 'qa')
  assert.equal(shown.desk, null)
})

test('findById matches the agent id and ignores a stored name', () => {
  const agents = [
    { id: 'forge', name: 'Sample' },
    { id: 'reg_forge', name: 'Forge' },
  ]
  assert.equal(crew.findById(agents, 'forge').id, 'forge')
  assert.equal(crew.findById(agents, 'Forge'), undefined)
  assert.equal(crew.findById(agents, 'reg_forge').name, 'Forge')
  assert.equal(crew.findById(agents, '  '), undefined)
})

test('ticket, pipeline, and project faces match assignees by id', async () => {
  const tickets = await readFile(new URL('../src/pages/Tickets.tsx', import.meta.url), 'utf8')
  const pipeline = await readFile(new URL('../src/pages/Pipeline.tsx', import.meta.url), 'utf8')
  const projects = await readFile(new URL('../src/pages/Projects.tsx', import.meta.url), 'utf8')
  assert.match(tickets, /resolveSticker/)
  assert.match(pipeline, /findById/)
  assert.match(projects, /findById/)
  for (const page of [tickets, pipeline, projects]) {
    assert.equal(page.includes('findByLabel'), false)
  }
})

test('resolveSticker matches the agent id and a display name stays generic', () => {
  const agents = [
    { id: 'forge', name: 'Forge', role: 'engineer', status: 'working', color: '#9bd434' },
    { id: 'rogue', name: 'Forge', role: 'helper', status: 'idle', color: '#112233' },
  ]
  const crewHit = crew.resolveSticker(agents, 'forge')
  assert.equal(crewHit.matched, true)
  assert.equal(crewHit.agent.id, 'forge')
  assert.equal(crewHit.agent.status, 'working')
  assert.equal(crewHit.agent.color, '#9bd434')
  assert.ok(crewHit.agents)

  const rogue = crew.resolveSticker(agents, 'rogue')
  assert.equal(rogue.matched, true)
  assert.equal(rogue.agent.id, 'rogue')
  assert.equal(rogue.agent.status, 'idle')
  assert.notEqual(rogue.agent.color, '#9bd434')

  const named = crew.resolveSticker(agents, 'Forge')
  assert.equal(named.matched, false)
  assert.equal(named.agent.id, 'Forge')
  assert.equal(named.agent.status, 'idle')
  assert.equal(named.agent.color, '#58A6FF')
  assert.equal(named.agents, undefined)

  const blank = crew.resolveSticker(agents, '  ')
  assert.equal(blank.matched, false)
  assert.equal(blank.agent.id, 'agent')
})

test('assignCrewSeats matches pixel and quill by id and ignores display names', () => {
  const named = [
    ...seats,
    { id: 'pixel', name: 'Pixel', role: 'Designer', desk: 'Design desk', color: '#ff5fa6' },
    { id: 'quill', name: 'Quill', role: 'Writer', desk: 'Writing desk', color: '#d257ef' },
  ]
  const map = crew.assignCrewSeats(
    [
      { id: 'quill', name: 'Pixel', position: 0 },
      { id: 'pixel', name: 'Quill', position: 4 },
      { id: 'helper', name: 'Pixel', position: 1 },
    ],
    named,
  )
  assert.deepEqual(map, { pixel: 'pixel', quill: 'quill', helper: 'speedy' })
})

test('a free seat stays when another agent arrives, one leaves, or positions change', () => {
  const first = crew.assignCrewSeats([{ id: 'helper', name: 'Pixel', position: 0 }], seats)
  assert.deepEqual(first, { helper: 'speedy' })
  const arrived = crew.assignCrewSeats(
    [
      { id: 'helper', position: 0 },
      { id: 'nova', position: 1 },
    ],
    seats,
    first,
    new Set(['helper']),
  )
  assert.deepEqual(arrived, { helper: 'speedy', nova: 'forge' })
  const removed = crew.assignCrewSeats([{ id: 'nova', position: 3 }], seats, arrived, new Set(['nova']))
  assert.deepEqual(removed, { nova: 'forge' })
  const reordered = crew.assignCrewSeats(
    [
      { id: 'nova', position: 0 },
      { id: 'helper', position: 9 },
    ],
    seats,
    { helper: 'speedy', nova: 'forge' },
    new Set(['helper', 'nova']),
  )
  assert.deepEqual(reordered, { helper: 'speedy', nova: 'forge' })
})

test('naming refresh follows roster changes and skips heartbeats', () => {
  const events = [
    { type: 'agents.snapshot', ts: 5, action: 'heartbeat' },
    { type: 'agent.status', ts: 6 },
  ]
  assert.equal(crew.namingRefreshTs(0, events), null)
  events.push({ type: 'agents.snapshot', ts: 7, action: 'register' })
  assert.equal(crew.namingRefreshTs(0, events), 7)
  assert.equal(crew.namingRefreshTs(7, events), null)
})

test('the naming screen proposes by agent id and settings keeps a saved map', async () => {
  const screen = await readFile(new URL('../src/components/NamingChoice.tsx', import.meta.url), 'utf8')
  const settings = await readFile(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  const firstRun = await readFile(new URL('../src/pages/FirstRun.tsx', import.meta.url), 'utf8')
  assert.match(screen, /assignCrewSeats/)
  assert.equal(screen.includes('assignSeatsInOrder'), false)
  assert.match(firstRun, /agentsReady=\{Boolean\(agentsQ\.data\)\}/)
  assert.match(screen, /An agent whose id matches a crew seat takes it\. Everyone else fills open seats in the order they joined\. You can change any seat\./)
  assert.match(screen, /Agents keep the name, role, and color they registered with\. Desks stay generic\./)
  assert.match(screen, /This choice is saved for this Mission Control\. You can change it later in Settings\. Sample rows keep the names already stored on them\./)
  assert.equal(screen.includes('when the seat is free'), false)
  assert.equal(screen.includes('no saved choice'), false)
  assert.match(settings, /Each agent gets a crew name and desk\. Seats are saved by agent id, and you can change any seat here\./)
  assert.equal(settings.includes('when the seat is free'), false)
  assert.equal(settings.includes('no saved choice'), false)
  assert.equal(/[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/.test(screen), false)
  assert.equal(/[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/.test(settings), false)
})

test('orderByPosition sorts by position then id', () => {
  const ordered = crew.orderByPosition([
    { id: 'b', position: 1 },
    { id: 'a', position: 1 },
    { id: 'c', position: 0 },
  ])
  assert.deepEqual(ordered.map((row) => row.id), ['c', 'a', 'b'])
})
