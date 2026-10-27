/**
 * Criteria 1 to 8 for the sample roster and the Offline label.
 * Display rules live in src/lib/sample-roster.ts. The pages only render them.
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

const roster = await loadTs('../src/lib/sample-roster.ts')

const sample = (id) => ({ id, name: id, source: 'default', online: true, lastSeenAt: null, status: 'idle' })
const registered = (id, extra = {}) => ({
  id,
  name: id,
  source: 'registered',
  online: true,
  lastSeenAt: new Date(1_000).toISOString(),
  status: 'idle',
  ...extra,
})
const seeded = ['speedy', 'atlas', 'forge', 'sentinel', 'echo', 'pixel', 'bolt', 'ledger', 'quill', 'aegis', 'patch', 'scout'].map(sample)

test('criterion 1: a seed with only defaults shows every bot and each one is Sample', () => {
  const shown = roster.visibleAgents(seeded, false)
  assert.equal(shown.length, seeded.length)
  assert.deepEqual(shown.map((agent) => agent.id), seeded.map((agent) => agent.id))
  assert.ok(shown.every((agent) => roster.showSampleTag(agent)))
  assert.equal(roster.hasRealBot(seeded), false)
})

test('criterion 2: one registered bot hides unclaimed defaults and keeps the new bot', () => {
  const next = [...seeded, registered('ribbon')]
  const shown = roster.visibleAgents(next, false)
  assert.deepEqual(shown.map((agent) => agent.id), ['ribbon'])
  assert.equal(roster.showSampleTag(shown[0]), false)
})

test('criterion 3: registering a default id keeps that bot and drops the Sample tag', () => {
  const claimed = seeded.map((agent) => (agent.id === 'forge' ? { ...agent, source: 'registered', online: true, lastSeenAt: new Date(1_000).toISOString() } : agent))
  const shown = roster.visibleAgents(claimed, false)
  assert.deepEqual(shown.map((agent) => agent.id), ['forge'])
  assert.equal(roster.showSampleTag(shown[0]), false)
  const names = ['Speedy', 'Atlas', 'Forge']
  const people = roster.orderedPeople(
    shown,
    names,
    (agent) => (agent.id === 'forge' ? 'Forge' : agent.id),
  )
  assert.deepEqual(people.map((agent) => agent.id), ['forge'])
})

test('criterion 4: Show sample bots brings defaults back and the saved value is 1', () => {
  const next = [...seeded, registered('ribbon')]
  const hidden = roster.visibleAgents(next, false)
  assert.equal(hidden.length, 1)
  const shown = roster.visibleAgents(next, true)
  assert.equal(shown.length, next.length)
  assert.equal(shown.filter((agent) => roster.showSampleTag(agent)).length, seeded.length)
  const storage = { value: null, getItem() { return this.value }, setItem(_key, value) { this.value = value } }
  assert.equal(roster.readShowSampleBots(storage), false)
  roster.writeShowSampleBots(storage, true)
  assert.equal(storage.value, '1')
  assert.equal(roster.readShowSampleBots(storage), true)
  roster.writeShowSampleBots(storage, false)
  assert.equal(roster.readShowSampleBots(storage), false)
  assert.equal(roster.SHOW_SAMPLE_BOTS_LABEL, 'Show sample bots')
})

test('criterion 5: the API offline window without a heartbeat is Offline and the idle pose is what we dim', () => {
  const seen = 1_000_000
  const windowMs = 10 * 60 * 1000
  roster.setOfflineWindowMs(windowMs)
  const bot = registered('ribbon', { lastSeenAt: new Date(seen).toISOString(), online: true, status: 'working' })
  assert.equal(roster.isRegisteredOffline(bot, seen + windowMs - 1), false)
  assert.equal(roster.isRegisteredOffline(bot, seen + windowMs), true)
  assert.equal(roster.robotStatusFor(bot, seen + windowMs, 'working'), 'idle')
  assert.equal(roster.robotStatusFor(bot, seen, 'working'), 'working')
  assert.equal(roster.isRegisteredOffline(registered('ribbon', { online: false, lastSeenAt: new Date(seen).toISOString() }), seen + 1000), true)
  assert.equal(roster.isRegisteredOffline(sample('forge'), seen + windowMs), false)
  assert.equal(roster.OFFLINE_LABEL, 'Offline')
  assert.equal(roster.offlineWindowMsNow(), windowMs)
})

test('criterion 6: deleting every real bot brings the defaults back', () => {
  const withReal = [...seeded, registered('ribbon')]
  assert.equal(roster.visibleAgents(withReal, false).length, 1)
  const afterDelete = withReal.filter((agent) => agent.id !== 'ribbon')
  const shown = roster.visibleAgents(afterDelete, false)
  assert.equal(shown.length, seeded.length)
  assert.ok(shown.every((agent) => roster.showSampleTag(agent)))
})

test('criterion 7: a snapshot does not remove a registered bot from the visible roster', () => {
  const rows = [
    ...seeded,
    registered('ribbon'),
    { id: 'snap_only', name: 'Snap Only', source: 'snapshot', online: true, status: 'idle' },
  ]
  const shown = roster.visibleAgents(rows, false)
  assert.deepEqual(shown.map((agent) => agent.id), ['ribbon', 'snap_only'])
  roster.setOfflineWindowMs(10 * 60 * 1000)
  assert.equal(roster.isRegisteredOffline(shown[0], Date.parse(shown[0].lastSeenAt) + 1000), false)
  const afterSnapshotKeepsRegistered = rows.filter((agent) => agent.source !== 'snapshot')
  assert.ok(roster.visibleAgents(afterSnapshotKeepsRegistered, false).some((agent) => agent.id === 'ribbon'))
})

test('criterion 8: the only new labels are exact and the new files have no dash punctuation', async () => {
  assert.equal(roster.SAMPLE_LABEL, 'Sample')
  assert.equal(roster.SHOW_SAMPLE_BOTS_LABEL, 'Show sample bots')
  assert.equal(roster.OFFLINE_LABEL, 'Offline')
  const dash = /[\u2012\u2013\u2014\u2015]/
  for (const rel of [
    '../src/lib/sample-roster.ts',
    '../src/lib/useSampleRoster.ts',
    '../src/components/rosterMarks.tsx',
  ]) {
    const src = await readFile(new URL(rel, import.meta.url), 'utf8')
    assert.equal(dash.test(src), false, rel)
  }
  for (const rel of ['../src/pages/Agents.tsx', '../src/pages/Office.tsx', '../src/pages/Team.tsx']) {
    const src = await readFile(new URL(rel, import.meta.url), 'utf8')
    assert.match(src, /useRosterView/)
    assert.match(src, /SampleTag/)
    assert.match(src, /OFFLINE_LABEL/)
    assert.match(src, /RosterRobot/)
    assert.doesNotMatch(src, /status: 'offline'/)
  }
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(system, /SHOW_SAMPLE_BOTS_LABEL/)
  assert.match(system, /useShowSampleBots/)
  const avatar = await readFile(new URL('../src/components/AgentAvatar.tsx', import.meta.url), 'utf8')
  assert.match(avatar, /opacity: dim \? 0\.45 : 1/)
  const robots = await readFile(new URL('../src/components/robots.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(robots, /Show sample bots/)
  assert.doesNotMatch(robots, /SAMPLE_LABEL/)
})

test('the README shows doctor, the register curls, and Sample and Offline with no dash punctuation', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8')
  assert.equal(/[\u2012\u2013\u2014\u2015]/.test(readme), false)
  assert.match(readme, /npm run doctor/)
  assert.match(readme, /x-ingest-token: \$MC_TOKEN/)
  assert.match(readme, /\/agents\/register/)
  assert.match(readme, /\/agents\/forge_helper\/heartbeat/)
  assert.match(readme, /-X DELETE "http:\/\/127\.0\.0\.1:3000\/agents\/forge_helper"/)
  assert.match(readme, /Show sample bots/)
  assert.match(readme, /Sample tag/)
  assert.match(readme, /shows Offline/)
})

test('ordered people keep the sample roster and append a real bot', () => {
  const names = ['Speedy', 'Forge']
  const agents = [
    { id: 'forge', name: 'Forge' },
    { id: 'speedy', name: 'Speedy' },
    { id: 'ribbon', name: 'Ribbon' },
  ]
  const people = roster.orderedPeople(agents, names, (agent) => agent.name)
  assert.deepEqual(people.map((agent) => agent.id), ['speedy', 'forge', 'ribbon'])
  const onlyReal = roster.orderedPeople([{ id: 'ribbon', name: 'Ribbon' }], names, (agent) => agent.name)
  assert.deepEqual(onlyReal.map((agent) => agent.id), ['ribbon'])
})

test('issue 117: counts beside the floor skip work owned by hidden sample bots', async () => {
  const mixed = [...seeded, registered('stranger_bot')]
  const hidden = roster.hiddenAgentIds(mixed, false)
  assert.deepEqual([...hidden].sort(), seeded.map((agent) => agent.id).sort())
  assert.equal(roster.hiddenAgentIds(mixed, true).size, 0)
  assert.equal(roster.hiddenAgentIds(seeded, false).size, 0)

  const tickets = [
    { key: 'MC-1', status: 'build', assignee: 'speedy' },
    { key: 'MC-2', status: 'qa', assignee: 'forge' },
    { key: 'MC-3', status: 'review', assignee: 'atlas' },
    { key: 'MC-4', status: 'done', assignee: 'pixel' },
    { key: 'MC-150', status: 'qa', assignee: 'stranger_bot' },
    { key: 'MC-151', status: 'build', assignee: null },
    { key: 'MC-152', status: 'build', assignee: 'Operator' },
  ]
  const shown = roster.withoutHiddenBots(tickets, hidden)
  assert.deepEqual(shown.map((t) => t.key), ['MC-150', 'MC-151', 'MC-152'])
  assert.deepEqual(roster.withoutHiddenBots(tickets, new Set()).map((t) => t.key), tickets.map((t) => t.key))
  const runs = [{ id: 'r1', agent: 'echo' }, { id: 'r2', agent: 'stranger_bot' }]
  assert.deepEqual(roster.withoutHiddenBots(runs, hidden).map((r) => r.id), ['r2'])

  const office = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  assert.match(office, /const pipe = stageCounts\(shownTickets\)/)
  assert.match(office, /shownTickets\.filter\(\(ticket\) => stageIndexForStatus/)
  assert.doesNotMatch(office, /stageCounts\(ticketRows\)/)
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(system, /visibleAgentKeys\(roster, hidden, \[\.\.\.named, \.\.\.fromSessions\]\)/)
  assert.equal((system.match(/agentsFor\(model, focus, roster, sessions\.data\?\.sessions \?\? \[\], hiddenBots\)/g) ?? []).length, 2)
})

test('issue 117: System model agents with the demo usage shape keep only visible bots', () => {
  // GET /usage after seed:demo rolls providers up by line.bot, so agents are labels.
  const providers = [
    { name: 'openai', model: 'openai/gpt-4.1', agents: ['Quill'] },
    { name: 'anthropic', model: 'anthropic/claude-sonnet-4-6', agents: ['Sage'] },
    { name: 'deepseek', model: 'deepseek/deepseek-chat', agents: ['Nova'] },
    { name: 'google', model: 'google/gemini-2.5-flash', agents: ['Lens'] },
    { name: 'ollama', model: 'ollama/llama3.1', agents: ['Local'] },
  ]
  const mixed = [...seeded.map((agent) => ({ ...agent, name: agent.id[0].toUpperCase() + agent.id.slice(1) })), registered('ribbon', { name: 'Ribbon' })]
  const hidden = roster.hiddenAgentIds(mixed, false)
  assert.ok(hidden.has('quill'))
  for (const p of providers) {
    assert.deepEqual(roster.visibleAgentKeys(mixed, hidden, p.agents), [], `${p.model} should show No agent tagged`)
  }
  // Exact ids drop the same way (sessions.snapshot sends ids).
  assert.deepEqual(roster.visibleAgentKeys(mixed, hidden, ['quill', 'speedy']), [])

  // A visible bot stays by id or display name, ignoring case, once.
  assert.deepEqual(roster.visibleAgentKeys(mixed, hidden, ['Ribbon', 'ribbon', 'RIBBON', ' ', null, 'Quill']), ['ribbon'])
  assert.equal(roster.visibleBotFor(mixed, hidden, 'rIbBoN')?.id, 'ribbon')
  assert.equal(roster.visibleBotFor(mixed, hidden, 'Quill'), undefined)
  assert.equal(roster.visibleBotFor(mixed, hidden, 'Sage'), undefined)

  // A registered bot that is named Sage keeps the Sage usage line.
  const withSage = [...mixed, registered('sage_bot', { name: 'Sage' })]
  assert.deepEqual(roster.visibleAgentKeys(withSage, roster.hiddenAgentIds(withSage, false), ['Sage', 'Quill']), ['sage_bot'])

  // Show sample bots on, or a seed only roster: every label stays as sent.
  const labels = providers.flatMap((p) => p.agents)
  assert.deepEqual(roster.visibleAgentKeys(mixed, roster.hiddenAgentIds(mixed, true), labels), labels)
  assert.deepEqual(roster.visibleAgentKeys(seeded, roster.hiddenAgentIds(seeded, false), labels), labels)
})
