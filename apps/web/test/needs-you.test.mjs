import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

/** Node 20.17+ cannot import TypeScript. Transpile with the compiler the app already ships. */
async function loadTs(rel) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const board = await loadTs('../src/lib/board.ts')
const when = await loadTs('../src/lib/when.ts')

const pending = [{
  id: 'demo-approval-1',
  tag: 'Deploy preview build',
  desc: 'Aegis wants to run the preview deploy script for DEMO-4. Apply the security patch.',
  meta: { ticketId: 'demo-ticket-4', ticketKey: 'DEMO-4' },
}]

const tickets = [
  { id: 'demo-ticket-4', key: 'DEMO-4', assignee: 'Sentinel' },
  { id: 'demo-ticket-6', key: 'DEMO-6', assignee: 'Aegis' },
]

test('needs-you follows the approval id, not a name in the text', () => {
  assert.equal(board.ticketNeedsYou(tickets[0], pending), true)
  assert.equal(board.ticketNeedsYou(tickets[1], pending), false)
  assert.equal(board.agentNeedsYou({ id: 'sentinel', name: 'Sentinel' }, pending, tickets), true)
  assert.equal(board.agentNeedsYou({ id: 'aegis', name: 'Aegis' }, pending, tickets), false)
  assert.equal(board.agentNeedsYou({ id: 'patch', name: 'Patch' }, pending, tickets), false)
  assert.equal(board.activityNeedsYou({ ticket: 'DEMO-4' }, pending), true)
  assert.equal(board.activityNeedsYou({ ticket: 'DEMO-6' }, pending), false)
  assert.equal(board.activityNeedsYou({ name: 'security patch' }, pending), false)
  assert.equal(board.activityNeedsYou({ ticket: 'demo-ticket-4' }, pending), true)
})

test('agentId is the assignee link and the ticket assignee is only the fallback', () => {
  const named = [{ meta: { ticketId: 'demo-ticket-4', ticketKey: 'DEMO-4', agentId: 'Aegis' } }]
  assert.equal(board.agentNeedsYou({ id: 'aegis', name: 'Aegis' }, named, tickets), true)
  assert.equal(board.agentNeedsYou({ id: 'sentinel', name: 'Sentinel' }, named, tickets), false)
  assert.equal(board.ticketNeedsYou(tickets[0], named), true)
  const prose = [{ desc: 'Apply the security patch', meta: { agentId: 'patch-id' } }]
  assert.equal(board.agentNeedsYou({ id: 'patch-id', name: 'Patch' }, prose, tickets), true)
  assert.equal(board.agentNeedsYou({ id: 'other', name: 'Aegis' }, prose, tickets), false)
})

test('working is status, including an agent who also needs a decision', () => {
  assert.equal(board.isWorking({ status: 'working' }), true)
  assert.equal(board.isWorking({ status: 'idle' }), false)
  assert.equal(board.isWorking({ status: 'blocked' }), false)
})

test('the board column table is the shared one', () => {
  const build = board.BOARD_COLUMNS.find((col) => col.status === 'build')
  assert.ok(build)
  assert.equal(board.inColumn('inprogress', build), true)
  assert.equal(board.inColumn('build', build), true)
  assert.equal(board.inColumn('qa', build), false)
  assert.deepEqual(board.BOARD_COLUMNS.map((col) => col.title), ['To-Do', 'Build', 'QA', 'Review', 'Done'])
})

test('doc bylines keep a real clock and drop it after yesterday', () => {
  const now = new Date(2026, 9, 6, 15, 0, 0)
  assert.equal(when.formatDocWhen(new Date(2026, 9, 6, 9, 12).toISOString(), now), 'Today, 9:12 AM')
  assert.equal(when.formatDocWhen(new Date(2026, 9, 5, 16, 3).toISOString(), now), 'Yesterday, 4:03 PM')
  assert.equal(when.formatDocWhen(new Date(2026, 9, 3, 10, 0).toISOString(), now), 'Oct 3')
})

test('setup progress ignores the old storage key', async () => {
  const connect = await readFile(new URL('../src/pages/Connect.tsx', import.meta.url), 'utf8')
  assert.match(connect, /mc-setup-progress-v2/)
  assert.equal(connect.includes('mc-setup-progress\''), false)
  assert.match(connect, /setupLineWidth/)
  assert.equal(connect.includes('index / (STEP_DATA.length - 1)'), false)
})
