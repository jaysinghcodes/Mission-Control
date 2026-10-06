/**
 * Ticket 9 — office floor placement, room bylines, and the demo seed lines
 * the locked mock expects. Logic lives in src/lib/office.ts (no React).
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

const office = await loadTs('../src/lib/office.ts')

const demo = [
  { id: 'speedy', name: 'Speedy', role: 'chief of staff', status: 'working', currentTask: 'Planning ticket 5' },
  { id: 'atlas', name: 'Atlas', role: 'product', status: 'idle', currentTask: 'Spec locked' },
  { id: 'forge', name: 'Forge', role: 'engineer', status: 'working', currentTask: 'Ticket 4 · Projects' },
  { id: 'sentinel', name: 'Sentinel', role: 'qa', status: 'working', currentTask: 'QA-4 on fresh clone' },
  { id: 'echo', name: 'Echo', role: 'research', status: 'working', currentTask: 'Researching calendar patterns' },
  { id: 'pixel', name: 'Pixel', role: 'designer', status: 'working', currentTask: 'Office mock' },
  { id: 'bolt', name: 'Bolt', role: 'ops', status: 'idle', currentTask: 'Waiting on Ship' },
  { id: 'ledger', name: 'Ledger', role: 'data', status: 'idle', currentTask: 'Nightly sync' },
  { id: 'quill', name: 'Quill', role: 'writer', status: 'working', currentTask: 'Release notes' },
  { id: 'aegis', name: 'Aegis', role: 'security', status: 'working', currentTask: 'Needs approval' },
  { id: 'patch', name: 'Patch', role: 'support', status: 'working', currentTask: 'Answering setup questions' },
  { id: 'scout', name: 'Scout', role: 'scout', status: 'working', currentTask: 'Checking upstream OpenClaw changes' },
]

const blocked = new Set(['aegis'])
const names = (rows) => rows.map((agent) => agent.name)

test('the demo roster sits in the locked rooms', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.deepEqual(names(floor.build), ['Forge', 'Pixel'])
  assert.deepEqual(names(floor.qa), ['Sentinel', 'Aegis'])
  assert.deepEqual(names(floor.ship), ['Quill', 'Atlas'])
  assert.deepEqual(names(floor.deploy), ['Bolt', 'Ledger'])
  assert.deepEqual(names(floor.commons), ['Speedy', 'Echo', 'Scout', 'Patch'])
})

test('room bylines count people who are working, not the blocked agent', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.equal(office.roomByline('build', floor.build, blocked), '2 in progress')
  assert.equal(office.roomByline('qa', floor.qa, blocked), '1 testing')
  assert.equal(office.roomByline('ship', floor.ship, blocked), '1 ready')
  assert.equal(office.roomByline('deploy', floor.deploy, blocked), 'Idle')
  assert.equal(office.taskLine(floor.qa.find((agent) => agent.name === 'Aegis'), true), 'Needs approval')
  assert.equal(office.taskLine(floor.ship.find((agent) => agent.name === 'Atlas'), false), 'Spec locked')
})

test('commons is the build council, and break parks idle agents there', () => {
  const floor = office.placeFloor(demo, 'all', blocked)
  assert.equal(office.commonsByline(floor.commons, 'all'), 'Build council · 4 agents')
  assert.equal(office.commonsTopic(floor.commons, 'all'), 'Planning ticket 5')

  const brk = office.placeFloor(demo, 'break', blocked)
  assert.deepEqual(names(brk.build), [])
  assert.deepEqual(names(brk.qa), [])
  assert.deepEqual(names(brk.ship), [])
  assert.deepEqual(names(brk.deploy), [])
  assert.deepEqual(names(brk.commons), ['Atlas', 'Bolt', 'Ledger'])
  assert.equal(office.commonsByline(brk.commons, 'break'), '3 on break')
  assert.equal(office.commonsTopic(brk.commons, 'break'), null)
})

test('gather keeps on-the-clock agents at home, meeting is the council only', () => {
  const gather = office.placeFloor(demo, 'gather', blocked)
  assert.deepEqual(names(gather.build), ['Forge', 'Pixel'])
  assert.deepEqual(names(gather.ship), ['Quill'])
  assert.ok(names(gather.qa).includes('Aegis'))
  assert.deepEqual(names(gather.deploy), [])
  assert.deepEqual(names(gather.commons), ['Speedy', 'Echo', 'Scout', 'Patch'])

  const meeting = office.placeFloor(demo, 'meeting', blocked)
  assert.deepEqual(names(meeting.commons), ['Speedy', 'Echo', 'Scout', 'Patch'])
  assert.equal(meeting.build.length + meeting.qa.length + meeting.ship.length + meeting.deploy.length, 0)
})

test('a third desk agent overflows into the commons', () => {
  const extra = [
    { id: 'a', name: 'Ada', role: 'engineer', status: 'working' },
    { id: 'b', name: 'Bea', role: 'engineer', status: 'working' },
    { id: 'c', name: 'Cy', role: 'developer', status: 'working' },
  ]
  const floor = office.placeFloor(extra, 'all', new Set())
  assert.equal(floor.build.length, 2)
  assert.deepEqual(names(floor.commons), ['Cy'])
  assert.equal(office.homeRoom({ id: 'd', name: 'Dee', role: 'development', status: 'working' }), 'build')
  assert.equal(office.homeRoom({ id: 'e', name: 'Eve', role: 'product', status: 'idle' }), 'ship')
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
