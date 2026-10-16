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
  for (const page of [tickets, pipeline, projects]) {
    assert.match(page, /findById/)
    assert.equal(page.includes('findByLabel'), false)
  }
})

test('assignSeatsInOrder follows position and ignores names', () => {
  const agents = [
    { id: 'dev', name: 'Speedy', position: 1 },
    { id: 'main', name: 'dev', position: 0 },
  ]
  assert.deepEqual(crew.assignSeatsInOrder(agents, seats), { main: 'speedy', dev: 'forge' })
})

test('orderByPosition sorts by position then id', () => {
  const ordered = crew.orderByPosition([
    { id: 'b', position: 1 },
    { id: 'a', position: 1 },
    { id: 'c', position: 0 },
  ])
  assert.deepEqual(ordered.map((row) => row.id), ['c', 'a', 'b'])
})
