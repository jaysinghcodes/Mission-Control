/**
 * Ticket 11 — Tasks board drag moves.
 *
 * Renders a column list from useBoardDrag (the state the board paints) and
 * drives the same moveTo the drop handler calls. node --test cannot import
 * .ts, so the module is transpiled into test/_gen first.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'
import { Window } from 'happy-dom'

const dom = new Window({ url: 'http://localhost/' })
function installGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
installGlobal('window', dom)
installGlobal('document', dom.document)
// Node 22 already has navigator. Node 20 does not, and React reads it while rendering.
if (typeof globalThis.navigator === 'undefined') {
  installGlobal('navigator', dom.navigator)
}
installGlobal('HTMLElement', dom.HTMLElement)
installGlobal('Element', dom.Element)
installGlobal('Node', dom.Node)
installGlobal('DocumentFragment', dom.DocumentFragment)
installGlobal('MutationObserver', dom.MutationObserver)
installGlobal('getComputedStyle', dom.getComputedStyle.bind(dom))
installGlobal('requestAnimationFrame', dom.requestAnimationFrame.bind(dom))
installGlobal('cancelAnimationFrame', dom.cancelAnimationFrame.bind(dom))
installGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const gen = new URL('./_gen/', import.meta.url)
await mkdir(gen, { recursive: true })

async function compile(srcRel, outName) {
  const src = await readFile(new URL(srcRel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const js = outputText.replaceAll("from './board'", "from './board.js'")
  const out = new URL(outName, gen)
  await writeFile(out, js)
  return out
}

await compile('../src/lib/board.ts', 'board.js')
await compile('../src/lib/boardDrag.ts', 'boardDrag.js')

const { createElement: h, useState } = await import('react')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useBoardDrag } = await import('./_gen/boardDrag.js')
const { BOARD_COLUMNS, inColumn } = await import('./_gen/board.js')

const initial = [
  { id: 'a', status: 'todo' },
  { id: 'b', status: 'todo' },
  { id: 'c', status: 'build' },
]

function columnIds(container, label) {
  const section = [...container.querySelectorAll('section')].find((node) => node.getAttribute('aria-label') === label)
  assert.ok(section, `missing column ${label}`)
  return [...section.querySelectorAll(':scope > article')].map((node) => node.textContent)
}

async function renderBoard(patch, { onSettled, tickets = initial } = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const api = {}

  function Probe() {
    const [server, setServer] = useState(tickets)
    const [notice, setNotice] = useState(null)
    const board = useBoardDrag(server, patch, {
      onError: (msg) => setNotice(msg),
      onSettled,
    })
    api.moveTo = board.moveTo
    api.setServer = setServer
    return h(
      'div',
      null,
      notice ? h('div', { role: 'alert' }, notice) : null,
      BOARD_COLUMNS.map((col) => h(
        'section',
        { key: col.status, 'aria-label': col.title },
        board.tickets.filter((row) => inColumn(row.status, col)).map((row) => h('article', { key: row.id }, row.id)),
      )),
    )
  }

  await act(async () => { root.render(h(Probe)) })
  return {
    container,
    api,
    ids: (label) => columnIds(container, label),
    alert: () => container.querySelector('[role="alert"]')?.textContent ?? null,
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

test('optimistic move puts the card in the target column, in its list position, before the PATCH returns', async () => {
  let resolvePatch
  const calls = []
  const patch = (id, status) => {
    calls.push({ id, status })
    return new Promise((resolve) => { resolvePatch = resolve })
  }
  const view = await renderBoard(patch)
  // Don't await moveTo: the PATCH is still pending, and that await would deadlock.
  let pending
  await act(async () => { pending = view.api.moveTo('a', 'build') })
  assert.deepEqual(calls, [{ id: 'a', status: 'build' }])
  // a stays ahead of c: only the status changes, so the array order is the position.
  assert.deepEqual(view.ids('Build'), ['a', 'c'])
  assert.deepEqual(view.ids('To-Do'), ['b'])
  assert.equal(view.alert(), null)

  // A poll that still has the old column must not yank the card back mid-flight.
  await act(async () => { view.api.setServer(initial.map((row) => ({ ...row }))) })
  assert.deepEqual(view.ids('Build'), ['a', 'c'])
  assert.deepEqual(view.ids('To-Do'), ['b'])

  resolvePatch({ ok: true, ticket: { id: 'a', status: 'build' } })
  await act(async () => { await pending })
  assert.deepEqual(view.ids('Build'), ['a', 'c'])
  await view.unmount()
})

test('a failed PATCH snaps the card back to its original column and position and shows the move error', async () => {
  const patch = async () => ({ ok: false, httpStatus: 503, error: 'Request failed (HTTP 503)' })
  const view = await renderBoard(patch)
  await act(async () => { await view.api.moveTo('a', 'qa') })
  assert.deepEqual(view.ids('To-Do'), ['a', 'b'])
  assert.deepEqual(view.ids('QA'), [])
  assert.deepEqual(view.ids('Build'), ['c'])
  assert.equal(view.alert(), "Couldn't move ticket to QA — Request failed (HTTP 503)")
  await view.unmount()
})

test('an out-of-order PATCH response cannot overwrite a newer drag', async () => {
  const resolvers = []
  const patch = (_id, status) => new Promise((resolve) => { resolvers.push({ status, resolve }) })
  const view = await renderBoard(patch)

  await act(async () => { view.api.moveTo('a', 'build') })
  await act(async () => { view.api.moveTo('a', 'qa') })
  assert.deepEqual(view.ids('QA'), ['a'])
  assert.equal(resolvers.map((item) => item.status).join(','), 'build,qa')

  // The first drag's success arrives while the second is still the one on screen.
  await act(async () => {
    resolvers[0].resolve({ ok: true, ticket: { id: 'a', status: 'build' } })
  })
  assert.deepEqual(view.ids('QA'), ['a'])
  assert.deepEqual(view.ids('Build'), ['c'])

  // And it still must not win if it arrives after the newer drag has succeeded.
  await act(async () => {
    resolvers[1].resolve({ ok: true, ticket: { id: 'a', status: 'qa' } })
  })
  assert.deepEqual(view.ids('QA'), ['a'])

  await view.unmount()

  // Newer success first, then the stale success.
  const late = []
  const view2 = await renderBoard((_id, status) => new Promise((resolve) => { late.push({ status, resolve }) }))
  await act(async () => { view2.api.moveTo('a', 'build') })
  await act(async () => { view2.api.moveTo('a', 'review') })
  await act(async () => {
    late[1].resolve({ ok: true, ticket: { id: 'a', status: 'review' } })
  })
  await act(async () => {
    late[0].resolve({ ok: true, ticket: { id: 'a', status: 'build' } })
  })
  assert.deepEqual(view2.ids('Review'), ['a'])
  assert.deepEqual(view2.ids('Build'), ['c'])
  assert.equal(view2.alert(), null)
  await view2.unmount()
})

test('a fast double drag that both fail returns the card to its original column', async () => {
  const resolvers = []
  const patch = () => new Promise((resolve) => { resolvers.push(resolve) })
  const view = await renderBoard(patch)
  await act(async () => { view.api.moveTo('a', 'build') })
  await act(async () => { view.api.moveTo('a', 'done') })
  assert.deepEqual(view.ids('Done'), ['a'])

  const fail = () => ({ ok: false, httpStatus: 0, error: 'API unreachable — is the server running?' })
  // Newer failure first, then the earlier one (the API died under both).
  await act(async () => { resolvers[1](fail()) })
  await act(async () => { resolvers[0](fail()) })
  assert.deepEqual(view.ids('To-Do'), ['a', 'b'])
  assert.deepEqual(view.ids('Done'), [])
  assert.equal(view.alert(), "Couldn't move ticket to Done — API unreachable — is the server running?")
  await view.unmount()
})

test('a card can move through every board column, including Done', async () => {
  const seen = []
  const patch = async (id, status) => {
    seen.push(status)
    return { ok: true, ticket: { id, status } }
  }
  const view = await renderBoard(patch)
  const steps = [
    ['build', 'Build'],
    ['qa', 'QA'],
    ['review', 'Review'],
    ['done', 'Done'],
    ['todo', 'To-Do'],
  ]
  for (const [status, label] of steps) {
    await act(async () => { await view.api.moveTo('a', status) })
    assert.ok(view.ids(label).includes('a'), `expected a in ${label}`)
  }
  assert.deepEqual(seen, ['build', 'qa', 'review', 'done', 'todo'])
  // Back in To-Do, still ahead of b.
  assert.deepEqual(view.ids('To-Do'), ['a', 'b'])
  await view.unmount()
})
