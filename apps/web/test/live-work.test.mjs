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

/** Most cases place the bot on a roster of one. */
const derive = (agent, tickets, runs, roster = [agent]) => live.deriveLiveWork(agent, tickets, runs, roster)

const forge = { id: 'forge', name: 'Forge', role: 'engineer', status: 'working', currentTask: 'Ticket 4 · Projects' }

test('the stage map matches the board', () => {
  for (const status of ['build', 'inprogress', 'qa', 'review', 'done', 'todo', 'backlog', '']) {
    assert.equal(live.liveStageIndex(status), board.stageIndexForStatus(status))
  }
})

test('an active ticket stage beats the run and the heartbeat, and role does not place the bot', () => {
  const idle = derive(forge, [], [])
  assert.equal(idle.room, 'commons')
  assert.equal(idle.source, 'heartbeat')
  assert.equal(idle.subtitle, 'Ticket 4 · Projects')
  assert.equal(idle.working, true)

  const placed = derive(
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

test('an exact id seats the bot, and an id wins over a name another bot has', () => {
  const forgeBot = { id: 'forge', name: 'Forge', status: 'idle', currentTask: '' }
  const other = { id: 'Forge', name: 'Builder', status: 'idle', currentTask: '' }
  const roster = [forgeBot, other]
  const ticket = [{ id: 't', title: 'Wire calendar week view', status: 'build', assignee: 'Forge' }]
  const byId = derive(other, ticket, [], roster)
  assert.equal(byId.room, 'build')
  assert.equal(byId.source, 'ticket')
  const notForge = derive(forgeBot, ticket, [], roster)
  assert.equal(notForge.source, 'heartbeat')
  assert.equal(live.resolveRosterLabel(roster, '  forge  '), 'forge')
  assert.equal(live.resolveRosterLabel(roster, 'Forge'), 'Forge')
})

test('a unique display name seats the bot, ignoring case and spaces', () => {
  const quill = { id: 'reg_quill', name: 'Quill', status: 'idle', currentTask: '' }
  const roster = [quill, { id: 'reg_forge', name: 'Forge' }]
  for (const label of ['Quill', 'quill', '  QUILL ']) {
    const work = derive(quill, [{ id: 't', title: 'Release notes', status: 'qa', assignee: label }], [], roster)
    assert.equal(work.room, 'qa', label)
    assert.equal(work.subtitle, 'Release notes')
    assert.equal(work.working, true)
    assert.equal(work.source, 'ticket')
  }
  const run = derive(
    quill,
    [{ id: 't', title: 'Release notes', status: 'review', assignee: 'Someone' }],
    [{ id: 'r', name: 'Ship notes', agent: 'quill', status: 'running', ticketId: 't' }],
    roster,
  )
  assert.equal(run.room, 'ship')
  assert.equal(run.source, 'run')
})

test('a name two visible bots share seats nobody', () => {
  const a = { id: 'reg_forge', name: 'Forge', status: 'idle', currentTask: '' }
  const b = { id: 'forge_two', name: 'forge', status: 'idle', currentTask: '' }
  const roster = [a, b]
  const tickets = [{ id: 't', title: 'Wire calendar week view', status: 'build', assignee: 'Forge' }]
  const runs = [{ id: 'r', name: 'Wire', agent: 'FORGE', status: 'running', ticketId: 't' }]
  for (const bot of roster) {
    const work = derive(bot, tickets, runs, roster)
    assert.equal(work.room, 'commons')
    assert.equal(work.source, 'heartbeat')
    assert.equal(work.working, false)
  }
  assert.equal(live.resolveRosterLabel(roster, 'Forge'), null)
  assert.equal(live.resolveRosterLabel(roster, 'Nobody'), null)
})

test('an empty or blank label seats nobody', () => {
  const blank = { id: '', name: '', status: 'idle', currentTask: '' }
  const quill = { id: 'q', name: 'Quill', status: 'idle', currentTask: '' }
  const roster = [quill, blank]
  for (const label of ['', '   ', null, undefined]) {
    assert.equal(live.resolveRosterLabel(roster, label), null)
    const work = derive(quill, [{ id: 't', title: 'Notes', status: 'qa', assignee: label }], [], roster)
    assert.equal(work.source, 'heartbeat')
    const ghost = derive(blank, [{ id: 't', title: 'Notes', status: 'qa', assignee: label }], [], roster)
    assert.equal(ghost.source, 'heartbeat')
  }
})

test('an OpenClaw ingest ticket with the display name seats the bot, then done is Idle', () => {
  // OpenClaw registers with its own id and creates tickets through the
  // ingest API with assignee set to the display name.
  const quill = { id: 'oc-quill-7f3a', name: 'Quill', source: 'registered', status: 'idle', currentTask: '' }
  const speedy = { id: 'oc-speedy-1b2c', name: 'Speedy', source: 'registered', status: 'working', currentTask: 'Planning' }
  const roster = [speedy, quill]
  const ingest = { id: 'tk_9', key: 'MC-9', title: 'Launch notes', assignee: 'Quill', createdAt: '2026-10-27T15:00:00Z' }
  const inQa = derive(quill, [{ ...ingest, status: 'qa' }], [], roster)
  assert.equal(inQa.room, 'qa')
  assert.equal(inQa.subtitle, 'Launch notes')
  assert.equal(inQa.working, true)
  const done = derive(quill, [{ ...ingest, status: 'done' }], [], roster)
  assert.equal(done.room, 'commons')
  assert.equal(done.subtitle, 'Idle')
  assert.equal(done.working, false)
  const beat = derive(speedy, [{ ...ingest, status: 'qa' }], [], roster)
  assert.equal(beat.source, 'heartbeat')
  assert.equal(beat.subtitle, 'Planning')
})

test('hidden samples do not block a unique visible name, and sample tickets use the same rules', () => {
  const sample = { id: 'forge', name: 'Forge', source: 'default', status: 'idle', currentTask: '' }
  const real = { id: 'reg_forge', name: 'Forge', source: 'registered', status: 'idle', currentTask: '' }
  const demoTicket = [{ id: 'demo-ticket-3', title: 'Wire calendar week view', status: 'build', assignee: 'forge' }]
  const nameTicket = [{ id: 't', title: 'Real work', status: 'review', assignee: 'Forge' }]

  // Samples hidden: the visible roster is only the real bot.
  const visibleOnly = [real]
  assert.equal(derive(real, nameTicket, [], visibleOnly).room, 'ship')
  assert.equal(derive(real, demoTicket, [], visibleOnly).room, 'build')

  // Samples shown: the id goes to the sample, the shared name seats nobody.
  const both = [sample, real]
  assert.equal(derive(sample, demoTicket, [], both).room, 'build')
  assert.equal(derive(real, demoTicket, [], both).source, 'heartbeat')
  assert.equal(derive(real, nameTicket, [], both).source, 'heartbeat')
  assert.equal(derive(sample, nameTicket, [], both).source, 'heartbeat')

  // Samples only: a demo ticket by id seats its sample bot.
  assert.equal(derive(sample, demoTicket, [], [sample]).room, 'build')
})

test('todo, backlog, and done do not seat a bot, and pipeline still counts done', () => {
  const todo = derive(
    { id: 'q', name: 'Quill', status: 'idle', currentTask: null },
    [{ id: 't', title: 'Notes', status: 'todo', assignee: 'q', createdAt: '2026-10-01T00:00:00Z' }],
    [],
  )
  assert.equal(todo.room, 'commons')
  assert.equal(todo.subtitle, 'Idle')
  assert.equal(todo.working, false)

  const done = derive(
    { id: 'q', name: 'Quill', status: 'idle', currentTask: 'Keep me' },
    [{ id: 't', title: 'Notes', status: 'done', assignee: 'q' }],
    [],
  )
  assert.equal(done.room, 'commons')
  assert.equal(done.subtitle, 'Keep me')
  assert.equal(done.source, 'heartbeat')
  assert.deepEqual(board.stageCounts([{ status: 'done' }, { status: 'review' }, { status: 'done' }]), [0, 0, 1, 2])
})

test('an active run on a done ticket seats Deploy, then Commons when the run finishes', () => {
  const quill = { id: 'q', name: 'Quill', status: 'idle', currentTask: '' }
  const ticket = { id: 't', title: 'Notes', status: 'done', assignee: 'q' }
  const running = derive(
    quill,
    [ticket],
    [{ id: 'r', name: 'Ship notes', agent: 'q', status: 'running', ticketId: 't' }],
  )
  assert.equal(running.room, 'deploy')
  assert.equal(running.subtitle, 'Notes')
  assert.equal(running.source, 'run')

  const approval = derive(
    quill,
    [ticket],
    [{ id: 'r', name: 'Ship notes', agent: 'q', status: 'needs_approval', ticketId: 't' }],
  )
  assert.equal(approval.room, 'deploy')
  assert.equal(approval.source, 'run')

  const finished = derive(
    quill,
    [ticket],
    [{ id: 'r', name: 'Ship notes', agent: 'q', status: 'done', ticketId: 't' }],
  )
  assert.equal(finished.room, 'commons')
  assert.equal(finished.subtitle, 'Idle')
  assert.equal(finished.source, 'heartbeat')
})

test('a review ticket outranks a run on a done ticket, and a review run seats Ship', () => {
  const held = derive(
    { id: 'q', name: 'Quill', status: 'idle' },
    [
      { id: 'done', title: 'Shipped', status: 'done', assignee: 'q', createdAt: '2026-10-03T00:00:00Z' },
      { id: 'rev', title: 'Still shipping', status: 'review', assignee: 'q', createdAt: '2026-10-01T00:00:00Z' },
    ],
    [{ id: 'r', name: 'Ship notes', agent: 'q', status: 'running', ticketId: 'done' }],
  )
  assert.equal(held.room, 'ship')
  assert.equal(held.subtitle, 'Still shipping')
  assert.equal(held.source, 'ticket')

  const reviewRun = derive(
    { id: 'forge', name: 'Forge', status: 'idle', currentTask: 'Heartbeat line' },
    [{ id: 'rev', title: 'Still shipping', status: 'review', assignee: 'Quill' }],
    [{ id: 'r', name: 'Ship notes', agent: 'forge', status: 'running', ticketId: 'rev' }],
  )
  assert.equal(reviewRun.room, 'ship')
  assert.equal(reviewRun.source, 'run')
})

test('register and delete snapshots refetch work, and a heartbeat snapshot does not', () => {
  const quiet = live.latestWorkEventTs([
    { type: 'agents.snapshot', ts: 5, action: 'heartbeat' },
    { type: 'hello', ts: 9 },
  ])
  assert.equal(quiet, 0)
  assert.equal(
    live.latestWorkEventTs([{ type: 'agents.snapshot', ts: 12, action: 'register' }]),
    12,
  )
  assert.equal(
    live.latestWorkEventTs([{ type: 'agents.snapshot', ts: 14, action: 'delete' }]),
    14,
  )
  assert.equal(
    live.latestWorkEventTs([{ type: 'run.started', ts: 3 }, { type: 'agent.status', ts: 4 }]),
    4,
  )
})

test('an active run uses the linked ticket stage when the bot is not the assignee', () => {
  const work = derive(
    { id: 'forge', name: 'Forge', status: 'idle', currentTask: 'Heartbeat line' },
    [{ id: 't', title: 'Ship the notes', status: 'review', assignee: 'Quill' }],
    [{ id: 'r', name: 'Write notes', agent: 'forge', status: 'running', ticketId: 't', createdAt: '2026-10-04T00:00:00Z' }],
  )
  assert.equal(work.room, 'ship')
  assert.equal(work.subtitle, 'Ship the notes')
  assert.equal(work.source, 'run')

  const queued = derive(
    { id: 'forge', name: 'Forge', status: 'idle', currentTask: '' },
    [{ id: 't', title: 'Ship the notes', status: 'review', assignee: 'Quill' }],
    [{ id: 'r', name: 'Write notes', agent: 'forge', status: 'queued', ticketId: 't' }],
  )
  assert.equal(queued.room, 'commons')
  assert.equal(queued.source, 'heartbeat')

  const bare = derive(
    { id: 'forge', name: 'Forge', status: 'working', currentTask: 'Heartbeat line' },
    [],
    [{ id: 'r', name: 'Write notes', agent: 'forge', status: 'needs_approval' }],
  )
  assert.equal(bare.room, 'commons')
  assert.equal(bare.subtitle, 'Heartbeat line')
  assert.equal(bare.source, 'heartbeat')
})

test('a heartbeat currentTask is the subtitle only when no ticket or run supplies one', () => {
  const beat = derive(
    { id: 'live_quill', name: 'Live Quill', status: 'working', currentTask: 'Writing the live notes' },
    [],
    [],
  )
  assert.equal(beat.room, 'commons')
  assert.equal(beat.subtitle, 'Writing the live notes')
  assert.equal(beat.working, true)

  const blank = derive(
    { id: 'live_quill', name: 'Live Quill', status: 'idle', currentTask: '   ' },
    [],
    [],
  )
  assert.equal(blank.subtitle, 'Idle')
  assert.equal(blank.working, false)
})

test('activity names the assignee by id and never the word system', () => {
  const roster = [
    { id: 'live_quill', name: 'Live Quill', role: 'writer' },
    { id: 'forge', name: 'Forge', role: 'engineer' },
    { id: 'rogue', name: 'Forge', role: 'helper' },
  ]
  const tickets = [{ id: 't', key: 'MC-200', title: 'Live notes', assignee: 'live_quill', status: 'qa' }]
  const fromAgent = live.activityActor({ agent: 'system', ticket: 'MC-200', name: 'ticket MC-200 moved to qa' }, roster, tickets)
  assert.equal(fromAgent.id, 'live_quill')
  assert.equal(fromAgent.name, 'Live Quill')
  const fromTicket = live.activityActor({ ticket: 'MC-200', name: 'ticket MC-200' }, roster, tickets)
  assert.equal(fromTicket.id, 'live_quill')
  const byDisplayName = live.activityActor(
    { agent: 'system', ticket: 'MC-200' },
    roster,
    [{ id: 't', key: 'MC-200', assignee: 'Live Quill', status: 'qa' }],
  )
  assert.equal(byDisplayName.id, 'Live Quill')
  assert.notEqual(byDisplayName.id, 'live_quill')
  const missing = live.activityActor({ agent: 'system', name: 'health' }, roster, tickets)
  assert.equal(missing, null)
  const runNamed = live.activityActor({ id: 'r1', name: 'Write' }, roster, tickets, [{ id: 'r1', agent: 'live_quill' }])
  assert.equal(runNamed.id, 'live_quill')
  const runDisplay = live.activityActor({ id: 'r1', name: 'Write' }, roster, tickets, [{ id: 'r1', agent: 'Live Quill' }])
  assert.equal(runDisplay.id, 'Live Quill')
  const fromRosterId = live.activityActor(
    { id: 'live_quill', action: 'register', agent: 'Live Quill' },
    roster,
    tickets,
    [{ id: 'live_quill', agent: 'Someone Else' }],
  )
  assert.equal(fromRosterId.name, 'Live Quill')
  assert.equal(fromRosterId.id, 'live_quill')
  const rogue = live.activityActor({ id: 'rogue', agent: 'Forge', action: 'register' }, roster, [])
  assert.equal(rogue.id, 'rogue')
  assert.notEqual(rogue.id, 'forge')
  const onlyName = live.activityActor({ agent: 'Forge' }, roster, [])
  assert.equal(onlyName.id, 'Forge')
  assert.notEqual(onlyName.id, 'forge')
  assert.notEqual(onlyName.id, 'rogue')
})

test('Agents, Team, and Office all read deriveLiveWork with the visible roster', async () => {
  const agents = await readFile(new URL('../src/pages/Agents.tsx', import.meta.url), 'utf8')
  const team = await readFile(new URL('../src/pages/Team.tsx', import.meta.url), 'utf8')
  const officePage = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  for (const page of [agents, team, officePage]) {
    assert.match(page, /deriveLiveWork\([^)]*, (roster|ticketRows, runRows, roster)\)/)
    assert.match(page, /data-live-room/)
    assert.match(page, /data-live-subtitle/)
  }
  assert.match(officePage, /useWorkLive/)
  assert.match(agents, /useWorkLive/)
  assert.match(team, /useWorkLive/)
})
