/**
 * Board lock copy and the per column controls.
 * The sentences are the spec, with no dash punctuation and no arrows.
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

const lock = await loadTs('../src/lib/board-lock.ts')

const COLUMNS = ['todo', 'build', 'inprogress', 'qa', 'review', 'done']

test('new board copy matches the spec and has no dash punctuation or arrows', () => {
  assert.equal(
    lock.LOCK_NOTE,
    'Agents pick up tickets in To Do and move them from there. Turn on Manual moves in Settings to move them yourself.',
  )
  assert.equal(lock.MANUAL_ON_NOTE, 'Manual moves are on. Agents still pick up tickets in To Do.')
  assert.equal(
    lock.REFUSED_MOVE_NOTICE,
    'Agents move this ticket. Turn on Manual moves in Settings to move it yourself.',
  )
  assert.equal(lock.WAITING_CHIP, 'Waiting for an agent')
  assert.equal(lock.BOARD_SECTION, 'Board')
  assert.equal(lock.MANUAL_MOVES_LABEL, 'Manual moves')
  assert.deepEqual([...lock.MANUAL_MOVES_OPTIONS], ['Automatic', 'On', 'Off'])
  assert.equal(
    lock.MANUAL_MOVES_HELP,
    'Manual moves let you move tickets past To Do. Automatic turns them off once an agent registers.',
  )
  assert.equal(lock.manualMovesStateLine(true), 'Manual moves are on right now.')
  assert.equal(lock.manualMovesStateLine(false), 'Manual moves are off right now.')
  assert.equal(
    lock.backlogAddedNotice('MC-151'),
    'MC-151 added to Backlog. Move it to To Do when it is ready for agents.',
  )
  assert.deepEqual(lock.boardCopyProblems(), [])
})

test('draggable, droppable, and buttons follow the column and the mode', () => {
  for (const status of COLUMNS) {
    assert.equal(lock.cardDraggable(status, false), true, status)
    assert.equal(lock.cardDraggable(status, true), false, status)
  }
  assert.equal(lock.cardDraggable('backlog', false), false)

  for (const status of ['todo', 'build', 'qa', 'review', 'done']) {
    assert.equal(lock.columnDroppable(status, false), true, status)
  }
  assert.equal(lock.columnDroppable('todo', true), true)
  for (const status of ['build', 'qa', 'review', 'done']) {
    assert.equal(lock.columnDroppable(status, true), false, status)
  }

  assert.deepEqual(
    lock.moveButtons('todo', true).map((button) => button.label),
    ['Backlog'],
  )
  assert.deepEqual(lock.moveButtons('build', true), [])
  assert.deepEqual(lock.moveButtons('inprogress', true), [])
  assert.deepEqual(lock.moveButtons('qa', true), [])
  assert.deepEqual(lock.moveButtons('review', true), [])
  assert.equal(lock.showWaitingChip('todo', true, false), true)
  assert.equal(lock.showWaitingChip('todo', true, true), false)
  assert.equal(lock.showWaitingChip('build', true, false), false)

  assert.deepEqual(
    lock.moveButtons('todo', false).map((button) => button.status),
    ['build', 'backlog'],
  )
  assert.deepEqual(
    lock.moveButtons('build', false).map((button) => button.status),
    ['qa', 'todo'],
  )
  assert.deepEqual(
    lock.moveButtons('qa', false).map((button) => button.status),
    ['review', 'build'],
  )
  assert.deepEqual(
    lock.moveButtons('review', false).map((button) => button.status),
    ['done', 'qa'],
  )
  assert.deepEqual(
    lock.moveButtons('build', true, true).map((button) => button.status),
    ['qa', 'todo'],
  )
})

test('a refused move notice replaces the generic failure', () => {
  assert.equal(
    lock.boardMoveNotice('qa', 409, lock.AGENTS_OWN_API_MESSAGE),
    lock.REFUSED_MOVE_NOTICE,
  )
  assert.equal(
    lock.boardMoveNotice('qa', 503, 'Request failed (HTTP 503)'),
    "Couldn't move ticket to QA. Request failed (HTTP 503)",
  )
})
