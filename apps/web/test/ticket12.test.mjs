/**
 * Ticket 12 — robot roster, overflow numbering, OpenClaw starter limits,
 * and the narrow board/Backlog layout.
 *
 * node --test cannot import .tsx, so the two modules under test are
 * transpiled into test/_gen (gitignored) and imported from there. react
 * resolves because that folder sits under apps/web/.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import ts from 'typescript'

const gen = new URL('./_gen/', import.meta.url)
await mkdir(gen, { recursive: true })

/** Transpile one src file into test/_gen, rewriting the robots import. */
async function compile(srcRel, outName) {
  const src = await readFile(new URL(srcRel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  // The transpiled files sit next to each other in _gen, so relative imports need .js.
  const js = outputText
    .replaceAll("from './robots'", "from './robots.js'")
    .replaceAll("from './robotAssign'", "from './robotAssign.js'")
  const out = new URL(outName, gen)
  await writeFile(out, js)
  return out
}

await compile('../src/components/robots.tsx', 'robots.js')
await compile('../src/components/robotAssign.ts', 'robotAssign.js')
await compile('../src/components/AgentAvatar.tsx', 'AgentAvatar.js')

const { ROSTER, ROBOT_COUNT, slotForId } = await import(new URL('robots.js', gen))
const { robotFaces, slotForAgent, rosterSlotForAgent } = await import(new URL('robotAssign.js', gen))
const { createElement: h } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { AgentAvatar } = await import(new URL('AgentAvatar.js', gen))

test('roster is exactly the 12 hand-tuned slots, each combo unique', () => {
  assert.equal(ROSTER.length, 12)
  assert.equal(ROBOT_COUNT, 12)
  const roles = ROSTER.map((s) => s.role)
  assert.deepEqual(roles, [
    'Chief of Staff', 'Product', 'Engineer', 'QA', 'Research', 'Designer',
    'Ops', 'Data', 'Writer', 'Security', 'Support', 'Scout',
  ])
  // Same uniqueness check the render script uses: head + locomotion + color.
  const seen = new Set()
  for (const s of ROSTER) {
    const key = `${s.head.shape}|${s.loco}|${s.color}`
    assert.equal(seen.has(key), false, `duplicate robot combo: ${key}`)
    seen.add(key)
  }
})

test('slotForId is stable and always lands in 0–11', () => {
  const a = slotForId('agent-nova')
  const b = slotForId('agent-nova')
  assert.equal(a, b)
  assert.ok(a >= 0 && a < 12)
  // Different ids may collide (it's a hash into 12 buckets) but a spread of
  // them must not all collapse to one slot.
  const slots = new Set(['main', 'qa', 'dev', 'scout', 'writer', 'ops', 'data', 'security', 'support', 'design'].map(slotForId))
  assert.ok(slots.size > 1)
})

test('known lanes wear the matching robot; unknown lanes hash', () => {
  assert.equal(rosterSlotForAgent({ role: 'chief of staff' }), 0)
  assert.equal(rosterSlotForAgent({ role: 'QA' }), 3)
  assert.equal(rosterSlotForAgent({ role: 'development' }), 2) // Engineer
  assert.equal(rosterSlotForAgent({ role: 'summary' }), 8) // Writer
  assert.equal(rosterSlotForAgent({ role: 'alerts' }), 9) // Security
  assert.equal(rosterSlotForAgent({ role: 'design' }), 5)
  // "lead" is not a roster job — must not steal the Chief robot via a substring.
  assert.equal(rosterSlotForAgent({ name: 'Lead Designer', role: 'design' }), 5)
  assert.equal(rosterSlotForAgent({ role: 'scrum master' }), null)
  const hashed = slotForAgent({ id: 'subagent-94ce', name: 'Subagent', role: 'scrum master' })
  assert.equal(hashed, slotForId('subagent-94ce'))
})

test('at or under 12 agents every face is a full robot (no child number)', () => {
  const agents = Array.from({ length: 12 }, (_, i) => ({
    id: `a${i}`,
    name: `Agent ${i}`,
    role: i === 0 ? 'chief of staff' : 'development',
    parentId: i === 0 ? null : 'a0',
  }))
  const faces = robotFaces(agents)
  assert.equal(faces.size, 12)
  for (const face of faces.values()) assert.equal(face.childNumber, null)
  assert.equal(faces.get('a0').slot, 0)
  assert.equal(faces.get('a1').slot, 2)
})

test('past 12 agents, overflow children are numbered copies of the parent robot', () => {
  // 1 chief + 7 roster lanes + 8 spawned children of the chief = 16 agents.
  // Seats: the chief, the 7 named jobs, then 4 spawns. The last 4 spawns
  // copy the chief (slot 0) and are numbered 1..4 in name order.
  const lanes = [
    ['chief', 'Chief', 'chief of staff', null],
    ['plan', 'Planner', 'scrum master', 'chief'],
    ['dev', 'Builder', 'development', 'chief'],
    ['qa', 'Tester', 'qa', 'chief'],
    ['res', 'Researcher', 'research', 'chief'],
    ['des', 'Designer', 'design', 'chief'],
    ['wri', 'Writer', 'summary', 'chief'],
    ['mon', 'Monitor', 'alerts', 'chief'],
  ]
  const agents = lanes.map(([id, name, role, parentId]) => ({ id, name, role, parentId }))
  for (let i = 0; i < 8; i++) {
    agents.push({ id: `spawn-${i}`, name: `Spawn ${String(i).padStart(2, '0')}`, role: null, parentId: 'chief' })
  }
  assert.ok(agents.length > 12)
  const faces = robotFaces(agents)
  assert.equal(faces.size, agents.length)

  // Named jobs keep their own robots — a swarm of "Spawn …" must not push QA out.
  assert.equal(faces.get('chief').childNumber, null)
  assert.equal(faces.get('chief').slot, 0)
  assert.equal(faces.get('qa').childNumber, null)
  assert.equal(faces.get('qa').slot, 3)
  assert.equal(faces.get('dev').slot, 2)
  assert.equal(faces.get('wri').slot, 8)
  assert.equal(faces.get('mon').slot, 9)
  // Scrum master is not one of the 12 jobs, but it is inside the first 12
  // seats (root + roster roles + fill), so it is still a full robot.
  assert.equal(faces.get('plan').childNumber, null)

  const overflow = ['spawn-0', 'spawn-1', 'spawn-2', 'spawn-3', 'spawn-4', 'spawn-5', 'spawn-6', 'spawn-7']
    .map((id) => ({ id, face: faces.get(id) }))
    .filter((x) => x.face.childNumber != null)
  // 16 agents, 12 seats → 4 numbered copies, all of the chief's robot.
  assert.equal(overflow.length, 4)
  const numbers = overflow.map((x) => x.face.childNumber).sort((a, b) => a - b)
  assert.deepEqual(numbers, [1, 2, 3, 4])
  for (const x of overflow) assert.equal(x.face.slot, faces.get('chief').slot)

  // The 4 spawns that DID get a seat are full robots, not numbered.
  const seated = ['spawn-0', 'spawn-1', 'spawn-2', 'spawn-3', 'spawn-4', 'spawn-5', 'spawn-6', 'spawn-7']
    .filter((id) => faces.get(id).childNumber == null)
  assert.equal(seated.length, 4)
})

test('dark UI renders the sticker halo; a 13th agent is a smaller numbered parent copy', () => {
  // No document in this test → useDarkUi() takes the dark default, which is
  // also the app's first paint. Halo on means the artwork group references
  // the dilate filter (the defs exist either way; the filter= attribute is the switch).
  const qa = renderToStaticMarkup(h(AgentAvatar, {
    agent: { id: 'qa-1', name: 'Tester', role: 'qa', status: 'working' },
    size: 1,
  }))
  assert.match(qa, /filter="url\(#/)
  assert.match(qa, /width="40"/)
  assert.match(qa, /Tester — QA robot/)

  const agents = [{ id: 'chief', name: 'Chief', role: 'chief of staff', status: 'idle', parentId: null }]
  for (let i = 1; i <= 12; i++) {
    agents.push({
      id: `spawn-${String(i).padStart(2, '0')}`,
      name: `Spawn ${String(i).padStart(2, '0')}`,
      role: null,
      status: 'idle',
      parentId: 'chief',
    })
  }
  // 13 agents: chief + 11 spawns keep seats; Spawn 12 is child 1 of the chief.
  const overflow = agents[agents.length - 1]
  const copy = renderToStaticMarkup(h(AgentAvatar, { agent: overflow, agents, size: 1 }))
  assert.match(copy, /filter="url\(#/)
  // 40px card × 0.62 → 25px. Smaller than the full robot, badge reads "1".
  assert.match(copy, /width="25"/)
  assert.match(copy, />1</)
  assert.match(copy, /child 1 of Chief/)
})

test('starter OpenClaw defaults are maxChildrenPerAgent 3 and maxConcurrent 4', async () => {
  const raw = await readFile(new URL('../../../bridge/openclaw.starter.json', import.meta.url), 'utf8')
  const cfg = JSON.parse(raw)
  const sub = cfg.agents.defaults.subagents
  assert.equal(sub.maxChildrenPerAgent, 3)
  assert.equal(sub.maxConcurrent, 4)
  // The pair lives under subagents — that is the OpenClaw block these keys belong to.
  assert.equal(cfg.agents.defaults.maxChildrenPerAgent, undefined)
})

test('Spawn 11 is the numbered copy when names are not zero-padded', () => {
  // Lexicographic order is Spawn 0, 1, 10, 11, 2… so the badge used to land
  // on Spawn 9. Numeric order keeps Spawn 0–10 as full robots and Spawn 11
  // as child 1 of the chief.
  const agents = [{ id: 'chief', name: 'Chief', role: 'chief of staff', parentId: null }]
  for (let i = 0; i <= 11; i++) {
    agents.push({ id: `s${i}`, name: `Spawn ${i}`, role: null, parentId: 'chief' })
  }
  const faces = robotFaces(agents)
  assert.equal(faces.get('s11').childNumber, 1)
  assert.equal(faces.get('s11').slot, faces.get('chief').slot)
  for (let i = 0; i <= 10; i++) assert.equal(faces.get(`s${i}`).childNumber, null, `Spawn ${i}`)
  const seated = ['chief', ...Array.from({ length: 11 }, (_, i) => `s${i}`)]
  assert.equal(new Set(seated.map((id) => faces.get(id).slot)).size, 12)
})

test('a number in the name beats creation time; creation time beats A–Z', () => {
  // Spawn 11 was created first, Spawn 0 last. The badge still follows the
  // number, not the clock and not code-unit order.
  const numbered = [{ id: 'chief', name: 'Chief', role: 'chief of staff', parentId: null, createdAt: '2020-01-01T00:00:00Z' }]
  for (let i = 0; i <= 11; i++) {
    numbered.push({
      id: `s${i}`,
      name: `Spawn ${i}`,
      role: null,
      parentId: 'chief',
      createdAt: new Date(Date.UTC(2024, 0, 12 - i)).toISOString(),
    })
  }
  const byNumber = robotFaces(numbered)
  assert.equal(byNumber.get('s11').childNumber, 1)
  assert.equal(byNumber.get('s0').childNumber, null)

  // No digits in the names. Lex order would overflow "Zed" (last letter).
  // Creation time overflows the latest child ("Amy") instead.
  const timed = [{ id: 'chief', name: 'Chief', role: 'chief of staff', parentId: null, createdAt: '2020-01-01T00:00:00Z' }]
  const names = ['Zed', 'Yan', 'Xin', 'Wes', 'Val', 'Uma', 'Ted', 'Sam', 'Ray', 'Qin', 'Bea', 'Amy']
  names.forEach((name, i) => {
    timed.push({
      id: name.toLowerCase(),
      name,
      role: null,
      parentId: 'chief',
      createdAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
    })
  })
  const byTime = robotFaces(timed)
  assert.equal(byTime.get('amy').childNumber, 1)
  assert.equal(byTime.get('zed').childNumber, null)
})

test('the first 12 seats are unique even when a hash lands on a taken robot', () => {
  // Find a scrum-master id whose hash is Writer (slot 8) — the Demo Planner
  // collision. The Writer keeps slot 8; the planner walks to a free robot.
  let collided = null
  for (let i = 0; i < 500; i++) {
    const id = `planner-${i}`
    if (slotForId(id) === 8) { collided = id; break }
  }
  assert.ok(collided, 'expected some id to hash to slot 8')
  const pair = robotFaces([
    { id: 'wri', name: 'Demo Writer', role: 'summary', parentId: null },
    { id: collided, name: 'Demo Planner', role: 'scrum master', parentId: null },
  ])
  assert.equal(slotForAgent({ id: collided, role: 'scrum master' }), 8)
  assert.equal(pair.get('wri').slot, 8)
  assert.notEqual(pair.get(collided).slot, pair.get('wri').slot)
  assert.equal(pair.get(collided).childNumber, null)

  // Chief + 11 spawns (12 agents, all seated) must be 12 different robots,
  // including a spawn whose hash is the chief's slot.
  const team = [{ id: 'chief', name: 'Chief', role: 'chief of staff', parentId: null }]
  for (let i = 0; i < 11; i++) team.push({ id: `s${i}`, name: `Spawn ${i}`, role: null, parentId: 'chief' })
  const faces = robotFaces(team)
  assert.equal(faces.size, 12)
  assert.equal(new Set([...faces.values()].map((f) => f.slot)).size, 12)
  for (const face of faces.values()) assert.equal(face.childNumber, null)
  assert.equal(faces.get('chief').slot, 0)
})

test('board and backlog scroll sideways and wrap actions (layout only)', async () => {
  const tickets = await readFile(new URL('../src/pages/Tickets.tsx', import.meta.url), 'utf8')
  const backlog = await readFile(new URL('../src/pages/Backlog.tsx', import.meta.url), 'utf8')
  const activity = await readFile(new URL('../src/pages/Activity.tsx', import.meta.url), 'utf8')
  const office = await readFile(new URL('../src/pages/Office.tsx', import.meta.url), 'utf8')
  // Fixed-width columns inside a sideways scroller. A shrinking grid clipped
  // titles at ~768px; w-[260px] shrink-0 keeps each column readable.
  assert.match(tickets, /overflow-x-auto/)
  assert.match(tickets, /w-\[260px\]/)
  assert.match(tickets, /shrink-0/)
  assert.match(tickets, /w-max/)
  assert.match(tickets, /flex-wrap/)
  assert.match(tickets, /break-words/)
  assert.match(tickets, /whitespace-nowrap/)
  assert.match(tickets, /AgentAvatar/)
  // Titles must not be ellipsized, and the generic bot glyph is gone.
  assert.equal(tickets.includes('truncate'), false)
  assert.equal(tickets.includes('<Bot'), false)
  assert.equal(activity.includes('<Bot'), false)
  assert.match(activity, /AgentAvatar/)
  // Same-room agents drop by STACK_STEP instead of sharing one left point.
  assert.match(office, /STACK_STEP/)
  assert.match(office, /place\.i \* STACK_STEP/)
  assert.match(backlog, /overflow-x-auto/)
  assert.match(backlog, /min-w-\[1020px\]/)
  assert.match(backlog, /flex-wrap/)
  assert.match(backlog, /break-words/)
  assert.equal(backlog.includes('overflow-hidden'), false)
  assert.equal(backlog.includes('truncate'), false)
  // The old fixed row height clipped a wrapped title. min-h lets the row grow.
  assert.match(backlog, /min-h-16/)
  // min-h-16 contains the letters h-16; the old fixed height was a class of its own.
  assert.equal(backlog.includes(' h-16 '), false)
})
