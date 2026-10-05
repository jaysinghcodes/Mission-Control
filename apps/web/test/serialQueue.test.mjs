/**
 * Regression test for QA-1 #1 (Atlas blocker on PR #20): a second
 * "+ New ticket" submitted while the first create is still in flight must be
 * SAVED (queued), never silently dropped.
 *
 * Runs with plain `node --test` (npm test -w web) — no test framework in the
 * web app yet. Node 20 cannot import .ts directly, so we transpile the one
 * module under test with the `typescript` package web already depends on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const src = await readFile(new URL('../src/lib/serialQueue.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { createSerialQueue } = await import(
  'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64')
)

/** A promise we resolve/reject by hand — stands in for a slow POST. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

test('second submit while the first is in flight is queued, not dropped (the QA-1 #1 bug)', async () => {
  const q = createSerialQueue()
  const sent = []
  const slowFirst = deferred()

  // Click 1: the POST is slow (QA: still pending when click 2 happened).
  const a = q.run(async () => {
    sent.push('A')
    return slowFirst.promise
  })
  // Click 2, ~1 s later, while A is still in flight. The old handler's
  // `if (busy) return` silently dropped this one.
  const b = q.run(async () => {
    sent.push('B')
    return 'saved B'
  })

  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(sent, ['A'], 'B waits for A (one create at a time)')
  assert.equal(q.pending, 2)

  slowFirst.resolve('saved A')
  assert.deepEqual(await Promise.all([a, b]), ['saved A', 'saved B'])
  assert.deepEqual(sent, ['A', 'B'], 'both creates reached the API, in order')
  assert.equal(q.pending, 0)
})

test('a failed create rejects only its own caller and does not block the next', async () => {
  const q = createSerialQueue()
  const failed = q.run(async () => {
    throw new Error('HTTP 500')
  })
  const next = q.run(async () => 'ok')
  await assert.rejects(failed, /HTTP 500/)
  assert.equal(await next, 'ok')
})

test('keeps submit order even when an earlier job is slower', async () => {
  const q = createSerialQueue()
  const log = []
  await Promise.all([
    q.run(async () => {
      await new Promise((r) => setTimeout(r, 20))
      log.push(1)
    }),
    q.run(async () => log.push(2)),
    q.run(async () => log.push(3)),
  ])
  assert.deepEqual(log, [1, 2, 3])
})
