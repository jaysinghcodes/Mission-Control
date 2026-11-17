/**
 * Ticket editing copy, field limits, column sort, and the delete rule.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

function transpile(src) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

async function loadText(rel) {
  return readFile(new URL(rel, import.meta.url), 'utf8')
}

function asModule(source) {
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}

const fieldsJs = transpile(await loadText('../src/lib/ticket-fields.ts'))
const fieldsUrl = 'data:text/javascript;base64,' + Buffer.from(fieldsJs).toString('base64')
const editJs = transpile(await loadText('../src/lib/ticket-edit.ts')).replaceAll(
  "from './ticket-fields'",
  `from '${fieldsUrl}'`,
)
const fields = await import(fieldsUrl)
const sort = await asModule(transpile(await loadText('../src/lib/ticket-sort.ts')))
const edit = await asModule(editJs)
const lock = await asModule(transpile(await loadText('../src/lib/board-lock.ts')))

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]| - |->|<-/

test('field limits match the API and the sheet errors', async () => {
  const api = await readFile(new URL('../../api/src/tickets/ticket-fields.ts', import.meta.url), 'utf8')
  assert.match(api, /TITLE_MAX = 120/)
  assert.match(api, /DESCRIPTION_MAX = 4000/)
  assert.match(api, /ASSIGNEE_MAX = 100/)
  assert.equal(fields.TITLE_MAX, 120)
  assert.equal(fields.DESCRIPTION_MAX, 4000)
  assert.equal(fields.titleFieldError(''), 'Title is required')
  assert.equal(fields.titleFieldError('   '), 'Title is required')
  assert.equal(fields.titleFieldError('x'.repeat(121)), 'Title must be 120 characters or fewer')
  assert.equal(fields.titleFieldError(`  ${'x'.repeat(120)}  `), null)
  assert.equal(fields.descriptionFieldError('d'.repeat(4001)), 'Description must be 4000 characters or fewer')
  assert.equal(fields.descriptionFieldError(''), null)
  assert.equal(fields.storedPriority('urgent'), 'med')
  assert.equal(fields.storedPriority('high'), 'high')
  assert.equal(fields.priorityLabel('low'), 'Low')
  assert.equal(fields.priorityLabel('nope'), 'Medium')
})

test('sheet copy matches the spec and has no dash punctuation or arrows', () => {
  assert.deepEqual(edit.ticketEditCopyProblems(), [])
  assert.equal(edit.SHEET_HEADING, 'Edit task')
  assert.equal(edit.CLOSE_TASK, 'Close task')
  assert.equal(edit.DESCRIPTION_PLACEHOLDER, 'Add detail for whoever picks this up.')
  assert.equal(edit.SAVING_LABEL, 'Saving…')
  assert.equal(edit.DELETING_LABEL, 'Deleting…')
  assert.equal(edit.ASSIGNEE_PICKUP, 'Only this agent can pick it up.')
  assert.equal(edit.ASSIGNEE_HAND_OFF, 'Changing the assignee hands this ticket to another agent.')
  assert.equal(edit.DELETE_HEADING, 'Delete this ticket?')
  assert.equal(edit.DELETE_DIALOG, 'Delete this ticket')
  assert.equal(edit.DELETE_REFUSAL, 'Agents own this ticket. Turn on Manual moves in Settings to delete it.')
  assert.equal(lock.DELETE_REFUSAL, edit.DELETE_REFUSAL)
  assert.equal(edit.GONE_UNKNOWN, 'That task is no longer on this board.')
  assert.equal(edit.savedNotice('MC-150'), 'MC-150 saved.')
  assert.equal(edit.deletedNotice('MC-150'), 'MC-150 deleted.')
  assert.equal(edit.saveFailed('MC-150', 'title is required'), "Couldn't save MC-150. title is required")
  assert.equal(edit.deleteFailed('MC-150', 'nope'), "Couldn't delete MC-150. nope")
  assert.equal(edit.goneNotice(null), 'That task is no longer on this board.')
  assert.equal(edit.goneNotice('MC-9'), 'MC-9 no longer exists. The board has been refreshed.')
  assert.equal(edit.deleteConfirmBody('MC-9', false), 'MC-9 goes away. Its Activity history stays.')
  assert.equal(
    edit.deleteConfirmBody('MC-9', true),
    'MC-9 goes away and an agent may be working on it. Its Activity history stays.',
  )
  assert.equal(edit.editDialogLabel('MC-9'), 'Edit MC-9')
  const lines = [
    edit.savedNotice('MC-150'),
    edit.deletedNotice('DEMO-1'),
    edit.saveFailed('MC-1', 'bad'),
    edit.deleteFailed('MC-1', 'bad'),
    edit.goneNotice('MC-1'),
    edit.goneNotice(''),
    edit.deleteConfirmBody('MC-1', true),
    edit.deleteConfirmBody('MC-1', false),
  ]
  for (const line of lines) assert.equal(DASH.test(line), false, line)
})

test('the sheet sends only changed fields and never status', () => {
  const live = {
    title: 'Old',
    description: 'Note',
    priority: 'med',
    assignee: 'Operator',
    projectId: null,
  }
  assert.equal(edit.sheetPatch(live, {}), null)
  assert.deepEqual(edit.sheetPatch(live, { priority: 'high' }), { priority: 'high' })
  assert.deepEqual(edit.sheetPatch(live, { title: '  New  ' }), { title: 'New' })
  assert.deepEqual(edit.sheetPatch(live, { title: 'Old' }), null)
  assert.deepEqual(edit.sheetPatch(live, { description: 'Note' }), null)
  assert.deepEqual(edit.sheetPatch(live, { projectId: 'p1' }), { projectId: 'p1' })
  const body = edit.sheetPatch(live, { title: 'New', priority: 'low', assignee: 'forge' })
  assert.equal('status' in body, false)
  assert.deepEqual(body, { title: 'New', priority: 'low', assignee: 'forge' })
  assert.equal(edit.shownTitle(live, {}), 'Old')
  assert.equal(edit.shownTitle({ ...live, title: 'Live' }, {}), 'Live')
  assert.equal(edit.shownTitle({ ...live, title: 'Live' }, { title: 'Mine' }), 'Mine')
  assert.equal(edit.shownDescription({ ...live, description: 'From agent' }, {}), 'From agent')
  assert.equal(edit.shownDescription({ ...live, description: 'From agent' }, { description: 'Mine' }), 'Mine')
  assert.equal(edit.shownPriority({ ...live, priority: 'urgent' }, {}), 'med')
  assert.equal(edit.sheetErrors(live, { title: '' }).title, 'Title is required')
  assert.equal(edit.sheetErrors(live, { description: 'd'.repeat(4001) }).description, 'Description must be 4000 characters or fewer')
})

test('column sort covers priority, newest, oldest, ties, unknown priority, and a blocked store', () => {
  const rows = [
    { id: 'b', priority: 'low', createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'a', priority: 'high', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c', priority: 'high', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'd', priority: 'med', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'e', priority: 'weird', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'f', priority: 'med', createdAt: '2026-01-02T00:00:00.000Z' },
  ]
  assert.deepEqual(sort.sortTickets(rows, 'priority').map((row) => row.id), ['c', 'a', 'e', 'd', 'f', 'b'])
  assert.deepEqual(sort.sortTickets(rows, 'newest').map((row) => row.id), ['b', 'a', 'd', 'f', 'c', 'e'])
  assert.deepEqual(sort.sortTickets(rows, 'oldest').map((row) => row.id), ['c', 'e', 'a', 'd', 'f', 'b'])
  assert.equal(sort.defaultSortMode('done'), 'newest')
  for (const column of ['backlog', 'todo', 'build', 'qa', 'review']) {
    assert.equal(sort.defaultSortMode(column), 'priority')
  }
  assert.equal(sort.modeForColumn({}, 'done'), 'newest')
  assert.equal(sort.modeForColumn({ todo: 'oldest' }, 'todo'), 'oldest')
  assert.equal(sort.modeForColumn({ todo: 'banana' }, 'todo'), 'priority')

  const memory = new Map()
  const store = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  }
  assert.deepEqual(sort.readSortMap(store), {})
  sort.writeSortMap({ todo: 'oldest', done: 'priority', build: 'nope' }, store)
  assert.deepEqual(sort.readSortMap(store), { todo: 'oldest', done: 'priority' })
  store.getItem = () => '{not json'
  assert.deepEqual(sort.readSortMap(store), {})
  const blocked = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  assert.deepEqual(sort.readSortMap(blocked), {})
  assert.doesNotThrow(() => sort.writeSortMap({ todo: 'newest' }, blocked))
  assert.equal(sort.SORT_STORAGE_KEY, 'mc-ticket-sort')
  assert.deepEqual(sort.SORT_LABELS, { priority: 'Priority', newest: 'Newest', oldest: 'Oldest' })
})

test('delete follows the lock, and sample tickets stay deletable', () => {
  for (const status of ['backlog', 'todo', 'done']) {
    assert.equal(lock.canDeleteTicket(status, true, false), true)
    assert.equal(lock.canDeleteTicket(status, false, false), true)
  }
  for (const status of ['build', 'qa', 'review', 'inprogress']) {
    assert.equal(lock.canDeleteTicket(status, true, false), false)
    assert.equal(lock.canDeleteTicket(status, false, false), true)
    assert.equal(lock.canDeleteTicket(status, true, true), true)
  }
  assert.equal(lock.canDeleteTicket('nope', true, false), false)
  assert.equal(lock.ticketHeld('inprogress'), true)
  assert.equal(lock.ticketHeld('todo'), false)
})
