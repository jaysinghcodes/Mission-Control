/**
 * Office floor filter. Rooms come from live work (room on each agent).
 * Role text is not a seat. Logic lives in src/lib/office.ts.
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
  const out = new URL(outName, gen)
  await writeFile(out, outputText)
  return out
}

await compile('../src/lib/pluralize.ts', 'pluralize.js')
const officeSrc = await readFile(new URL('../src/lib/office.ts', import.meta.url), 'utf8')
const officeJs = ts.transpileModule(officeSrc, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll("from './pluralize'", "from './pluralize.js'")
await writeFile(new URL('office.js', gen), officeJs)
const office = await import(new URL('office.js', gen))

const demo = [
  { id: 'speedy', name: 'Speedy', role: 'chief of staff', status: 'working', room: 'commons', currentTask: 'Planning ticket 5' },
  { id: 'atlas', name: 'Atlas', role: 'product', status: 'idle', room: 'commons', currentTask: 'Spec locked' },
  { id: 'forge', name: 'Forge', role: 'engineer', status: 'working', room: 'build', currentTask: 'Wire calendar week view' },
  { id: 'sentinel', name: 'Sentinel', role: 'qa', status: 'working', room: 'qa', currentTask: 'Regression pass on Tickets' },
  { id: 'echo', name: 'Echo', role: 'research', status: 'working', room: 'commons', currentTask: 'Researching calendar patterns' },
  { id: 'pixel', name: 'Pixel', role: 'designer', status: 'working', room: 'commons', currentTask: 'Office mock' },
  { id: 'bolt', name: 'Bolt', role: 'ops', status: 'idle', room: 'commons', currentTask: 'Waiting on Ship' },
  { id: 'ledger', name: 'Ledger', role: 'data', status: 'idle', room: 'commons', currentTask: 'Nightly sync' },
  { id: 'quill', name: 'Quill', role: 'writer', status: 'working', room: 'ship', currentTask: 'Release notes for the next cut' },
  { id: 'aegis', name: 'Aegis', role: 'security', status: 'working', room: 'deploy', currentTask: 'Rotate demo ingest token' },
  { id: 'patch', name: 'Patch', role: 'support', status: 'working', room: 'commons', currentTask: 'Answering setup questions' },
  { id: 'scout', name: 'Scout', role: 'scout', status: 'working', room: 'commons', currentTask: 'Checking upstream OpenClaw changes' },
]

const blocked = new Set(['aegis'])
const names = (rows) => rows.map((agent) => agent.name)

test('agents sit in the live room, not the room their role text used to imply', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.deepEqual(names(floor.build), ['Forge'])
  assert.deepEqual(names(floor.qa), ['Sentinel'])
  assert.deepEqual(names(floor.ship), ['Quill'])
  assert.deepEqual(names(floor.deploy), ['Aegis'])
  assert.deepEqual(names(floor.commons), ['Atlas', 'Bolt', 'Echo', 'Ledger', 'Patch', 'Pixel', 'Scout', 'Speedy'])
  assert.equal(office.seatRoom({ id: 'x', name: 'Dee', role: 'engineer', status: 'working' }), 'commons')
  assert.equal(office.seatRoom({ id: 'y', name: 'Eve', role: 'product', status: 'idle', room: 'ship' }), 'ship')
})

test('room bylines count people who are working, not the blocked agent', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.equal(office.roomByline('build', floor.build, blocked), '1 in progress')
  assert.equal(office.roomByline('qa', floor.qa, blocked), '1 testing')
  assert.equal(office.roomByline('ship', floor.ship, blocked), '1 ready')
  assert.equal(office.roomByline('deploy', floor.deploy, blocked), 'Idle')
  assert.equal(office.taskLine(floor.deploy.find((agent) => agent.name === 'Aegis'), true), 'Needs approval')
  assert.equal(office.taskLine(floor.ship.find((agent) => agent.name === 'Quill'), false), 'Release notes for the next cut')
})

test('commons counts whoever has no desk, and break parks idle agents there', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.equal(office.commonsByline(floor.commons, 'all'), '8 agents')
  assert.equal(office.commonsTopic(floor.commons, 'all'), 'Spec locked')

  const brk = office.placeFloor(demo, 'break', blocked)
  assert.deepEqual(names(brk.build), [])
  assert.deepEqual(names(brk.qa), [])
  assert.deepEqual(names(brk.ship), [])
  assert.deepEqual(names(brk.deploy), [])
  assert.deepEqual(names(brk.commons), ['Atlas', 'Bolt', 'Ledger'])
  assert.equal(office.commonsByline(brk.commons, 'break'), '3 on break')
  assert.equal(office.commonsTopic(brk.commons, 'break'), null)
})

test('gather keeps on the clock agents in their live room, meeting is commons only', () => {
  const gather = office.placeFloor(demo, 'gather', blocked)
  assert.deepEqual(names(gather.build), ['Forge'])
  assert.deepEqual(names(gather.ship), ['Quill'])
  assert.ok(names(gather.qa).includes('Sentinel'))
  assert.deepEqual(names(gather.deploy), ['Aegis'])
  assert.ok(names(gather.commons).includes('Speedy'))
  assert.equal(names(gather.commons).includes('Atlas'), false)

  const meeting = office.placeFloor(demo, 'meeting', blocked)
  assert.ok(names(meeting.commons).includes('Speedy'))
  assert.equal(names(meeting.commons).includes('Forge'), false)
  assert.equal(meeting.build.length + meeting.qa.length + meeting.ship.length + meeting.deploy.length, 0)
})

test('a third desk agent overflows into the commons', () => {
  const extra = [
    { id: 'a', name: 'Ada', role: 'engineer', status: 'working', room: 'build' },
    { id: 'b', name: 'Bea', role: 'engineer', status: 'working', room: 'build' },
    { id: 'c', name: 'Cy', role: 'developer', status: 'working', room: 'build' },
  ]
  const floor = office.placeFloor(extra, 'all', new Set())
  assert.equal(floor.build.length, 2)
  assert.deepEqual(names(floor.commons), ['Cy'])
})

test('activity ages stay short', () => {
  const now = Date.parse('2026-10-06T18:00:00Z')
  assert.equal(office.activityAge('2026-10-06T17:56:00Z', now), '4m')
  assert.equal(office.activityAge('2026-10-06T17:00:00Z', now), '1h')
  assert.equal(office.activityAge('2026-10-06T18:00:20Z', now), 'now')
  assert.equal(office.floorMode(0), 'all')
  assert.equal(office.floorMode(2), 'meeting')
  assert.equal(office.floorMode(3), 'break')
})

test('the office page keeps headers on one line and opens a drawer plus a room detail', async () => {
  const page = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  assert.match(page, /AgentProfileDrawer/)
  assert.match(page, /whitespace-nowrap text-\[15px\] font-semibold/)
  assert.match(page, /whitespace-nowrap text-\[12px\] font-medium text-mc-sub/)
  assert.equal(page.includes('truncate text-[12px] text-mc-sub'), false)
  assert.match(page, /placeFloor/)
  assert.match(page, /deriveLiveWork/)
  assert.match(page, /activityRailLine/)
  assert.equal(page.includes("|| 'system'"), false)
  assert.match(page, /All working', 'Gather', 'Meeting', 'Break'/)
  assert.match(page, /office-room-detail/)
  assert.match(page, /stageCounts/)
})

test('demo seed task lines and the needs-you agent match the locked floor', async () => {
  const seed = await readFile(new URL('../../api/scripts/seed-demo.ts', import.meta.url), 'utf8')
  assert.match(seed, /currentTask: 'Planning ticket 5'/)
  assert.match(seed, /currentTask: 'Ticket 4 · Projects'/)
  assert.match(seed, /currentTask: 'Office mock'/)
  assert.match(seed, /currentTask: 'QA-4 on fresh clone'/)
  assert.match(seed, /currentTask: 'Needs approval'/)
  assert.match(seed, /currentTask: 'Release notes'/)
  assert.match(seed, /currentTask: 'Spec locked'/)
  assert.match(seed, /currentTask: 'Waiting on Ship'/)
  assert.match(seed, /currentTask: 'Nightly sync'/)
  assert.match(seed, /agentId: 'Aegis'/)
  assert.equal(seed.includes("agentId: 'Sentinel'"), false)
})
