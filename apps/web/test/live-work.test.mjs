/**
 * Shared live placement. Ticket stage, then active run, then heartbeat.
 * Role text never chooses a room.
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
  const js = outputText.replaceAll("from './live-work'", "from './live-work.js'")
  const out = new URL(outName, gen)
  await writeFile(out, js)
  return out
}

await compile('../src/lib/live-work.ts', 'live-work.js')
const boardSrc = await readFile(new URL('../src/lib/board.ts', import.meta.url), 'utf8')
const boardJs = ts.transpileModule(boardSrc, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
await writeFile(new URL('board-live.js', gen), boardJs)

const live = await import(new URL('live-work.js', gen))
const board = await import(new URL('board-live.js', gen))

const forge = { id: 'forge', name: 'Forge', role: 'engineer', status: 'working', currentTask: 'Ticket 4 · Projects' }

test('the stage map matches the board', () => {
  for (const status of ['build', 'inprogress', 'qa', 'review', 'done', 'todo', 'backlog', '']) {
    assert.equal(live.liveStageIndex(status), board.stageIndexForStatus(status))
  }
})

test('an active ticket stage beats the run and the heartbeat, and role does not place the bot', () => {
  const idle = live.deriveLiveWork(forge, [], [])
  assert.equal(idle.room, 'commons')
  assert.equal(idle.source, 'heartbeat')
  assert.equal(idle.subtitle, 'Ticket 4 · Projects')
  assert.equal(idle.working, true)

  const placed = live.deriveLiveWork(
    forge,
    [
      { id: 'old', title: 'Old build', status: 'build', assignee: 'Forge', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'new', title: 'Live notes', status: 'qa', assignee: 'forge', createdAt: '2026-10-02T00:00:00Z' },
    ],
    [{ id: 'r', name: 'Other', agent: 'Forge', status: 'running', ticketId: 'old', createdAt: '2026-10-03T00:00:00Z' }],
  )
  assert.equal(placed.room, 'qa')
  assert.equal(placed.subtitle, 'Live notes')
  assert.equal(placed.source, 'ticket')
  assert.equal(placed.working, true)
})

test('todo and backlog are not desks, and done is Deploy', () => {
  const todo = live.deriveLiveWork(
    { id: 'q', name: 'Quill', status: 'idle', currentTask: null },
    [{ id: 't', title: 'Notes', status: 'todo', assignee: 'Quill', createdAt: '2026-10-01T00:00:00Z' }],
    [],
  )
  assert.equal(todo.room, 'commons')
  assert.equal(todo.subtitle, 'Idle')
  assert.equal(todo.working, false)

  const done = live.deriveLiveWork(
    { id: 'q', name: 'Quill', status: 'idle' },
    [{ id: 't', title: 'Notes', status: 'done', assignee: 'Quill' }],
    [],
  )
  assert.equal(done.room, 'deploy')
  assert.equal(done.subtitle, 'Notes')
})

test('an active run uses the linked ticket stage when the bot is not the assignee', () => {
  const work = live.deriveLiveWork(
    { id: 'forge', name: 'Forge', status: 'idle', currentTask: 'Heartbeat line' },
    [{ id: 't', title: 'Ship the notes', status: 'review', assignee: 'Quill' }],
    [{ id: 'r', name: 'Write notes', agent: 'Forge', status: 'running', ticketId: 't', createdAt: '2026-10-04T00:00:00Z' }],
  )
  assert.equal(work.room, 'ship')
  assert.equal(work.subtitle, 'Ship the notes')
  assert.equal(work.source, 'run')

  const queued = live.deriveLiveWork(
    { id: 'forge', name: 'Forge', status: 'idle', currentTask: '' },
    [{ id: 't', title: 'Ship the notes', status: 'review', assignee: 'Quill' }],
    [{ id: 'r', name: 'Write notes', agent: 'Forge', status: 'queued', ticketId: 't' }],
  )
  assert.equal(queued.room, 'commons')
  assert.equal(queued.source, 'heartbeat')

  const bare = live.deriveLiveWork(
    { id: 'forge', name: 'Forge', status: 'working', currentTask: 'Heartbeat line' },
    [],
    [{ id: 'r', name: 'Write notes', agent: 'Forge', status: 'needs_approval' }],
  )
  assert.equal(bare.room, 'commons')
  assert.equal(bare.subtitle, 'Heartbeat line')
  assert.equal(bare.source, 'heartbeat')
})

test('a heartbeat currentTask is the subtitle only when no ticket or run supplies one', () => {
  const beat = live.deriveLiveWork(
    { id: 'live_quill', name: 'Live Quill', status: 'working', currentTask: 'Writing the live notes' },
    [],
    [],
  )
  assert.equal(beat.room, 'commons')
  assert.equal(beat.subtitle, 'Writing the live notes')
  assert.equal(beat.working, true)

  const blank = live.deriveLiveWork(
    { id: 'live_quill', name: 'Live Quill', status: 'idle', currentTask: '   ' },
    [],
    [],
  )
  assert.equal(blank.subtitle, 'Idle')
  assert.equal(blank.working, false)
})

test('activity names the assignee and never the word system', () => {
  const roster = [{ id: 'live_quill', name: 'Live Quill', role: 'writer' }]
  const tickets = [{ id: 't', key: 'MC-200', title: 'Live notes', assignee: 'Live Quill', status: 'qa' }]
  const fromAgent = live.activityActor({ agent: 'system', ticket: 'MC-200', name: 'ticket MC-200 → qa' }, roster, tickets)
  assert.equal(fromAgent.name, 'Live Quill')
  const fromTicket = live.activityActor({ ticket: 'MC-200', name: 'ticket MC-200' }, roster, tickets)
  assert.equal(fromTicket.name, 'Live Quill')
  const missing = live.activityActor({ agent: 'system', name: 'health' }, roster, tickets)
  assert.equal(missing, null)
  const runNamed = live.activityActor({ id: 'r1', name: 'Write' }, roster, tickets, [{ id: 'r1', agent: 'Live Quill' }])
  assert.equal(runNamed.id, 'live_quill')
  const fromRosterId = live.activityActor(
    { id: 'live_quill', action: 'register' },
    roster,
    tickets,
    [{ id: 'live_quill', agent: 'Someone Else' }],
  )
  assert.equal(fromRosterId.name, 'Live Quill')
  assert.equal(fromRosterId.id, 'live_quill')
})

test('Agents, Team, and Office all read deriveLiveWork', async () => {
  const agents = await readFile(new URL('../src/pages/Agents.tsx', import.meta.url), 'utf8')
  const team = await readFile(new URL('../src/pages/Team.tsx', import.meta.url), 'utf8')
  const officePage = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  for (const page of [agents, team, officePage]) {
    assert.match(page, /deriveLiveWork/)
    assert.match(page, /data-live-room/)
    assert.match(page, /data-live-subtitle/)
  }
  assert.match(officePage, /useWorkLive/)
  assert.match(agents, /useWorkLive/)
  assert.match(team, /useWorkLive/)
})
