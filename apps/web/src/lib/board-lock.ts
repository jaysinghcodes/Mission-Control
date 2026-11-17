/**
 * Tasks board lock. The rules live in apps/api/src/tickets/move-rules.ts.
 * This file only decides what the board draws.
 */

export const LOCK_NOTE =
  'Agents pick up tickets in To Do and move them from there. Turn on Manual moves in Settings to move them yourself.'

export const MANUAL_ON_NOTE = 'Manual moves are on. Agents still pick up tickets in To Do.'

export const REFUSED_MOVE_NOTICE =
  'Agents move this ticket. Turn on Manual moves in Settings to move it yourself.'

export const AGENTS_OWN_API_MESSAGE =
  'Agents move tickets past To Do. Turn on Manual moves in Settings to move it yourself.'

export const WAITING_CHIP = 'Waiting for an agent'

export const BOARD_SECTION = 'Board'

export const MANUAL_MOVES_LABEL = 'Manual moves'

export const MANUAL_MOVES_OPTIONS = ['Automatic', 'On', 'Off'] as const

export const MANUAL_MOVES_HELP =
  'Manual moves let you move tickets past To Do. Automatic turns them off once an agent registers.'

export function manualMovesStateLine(on: boolean): string {
  return on ? 'Manual moves are on right now.' : 'Manual moves are off right now.'
}

export function backlogAddedNotice(key: string): string {
  return `${key} added to Backlog. Move it to To Do when it is ready for agents.`
}

const ON_BOARD = new Set(['todo', 'build', 'inprogress', 'qa', 'review', 'done'])
const DROP_COLUMNS = new Set(['todo', 'build', 'qa', 'review', 'done'])
const HELD_COLUMNS = new Set(['build', 'qa', 'review', 'done'])

const SAMPLE_IDS = new Set([
  'demo-ticket-1',
  'demo-ticket-2',
  'demo-ticket-3',
  'demo-ticket-4',
  'demo-ticket-5',
  'demo-ticket-6',
  'demo-ticket-7',
  'demo-ticket-8',
])

export function isSampleTicket(ticket: { id?: string | null; key?: string | null }): boolean {
  const id = (ticket.id ?? '').trim()
  if (SAMPLE_IDS.has(id)) return true
  return /^DEMO-\d+$/.test((ticket.key ?? '').trim())
}

/** Locked cards stay put. Sample tickets move with their buttons. */
export function cardDraggable(status: string, locked: boolean): boolean {
  if (!ON_BOARD.has(status)) return false
  return !locked
}

export function columnDroppable(status: string, locked: boolean): boolean {
  if (!DROP_COLUMNS.has(status)) return false
  if (!locked) return true
  return !HELD_COLUMNS.has(status)
}

export interface MoveButton {
  label: string
  status: string
  forward: boolean
}

function buttonsFor(status: string): MoveButton[] {
  if (status === 'todo') {
    return [
      { label: 'Start', status: 'build', forward: true },
      { label: 'Backlog', status: 'backlog', forward: false },
    ]
  }
  if (status === 'build' || status === 'inprogress') {
    return [
      { label: 'QA', status: 'qa', forward: true },
      { label: 'To-Do', status: 'todo', forward: false },
    ]
  }
  if (status === 'qa') {
    return [
      { label: 'Review', status: 'review', forward: true },
      { label: 'Build', status: 'build', forward: false },
    ]
  }
  if (status === 'review') {
    return [
      { label: 'Done', status: 'done', forward: true },
      { label: 'QA', status: 'qa', forward: false },
    ]
  }
  return []
}

export function moveButtons(status: string, locked: boolean, sample = false): MoveButton[] {
  const all = buttonsFor(status)
  if (!locked || sample) return all
  if (status === 'todo') return all.filter((button) => button.status === 'backlog')
  if (status === 'build' || status === 'inprogress' || status === 'qa' || status === 'review') return []
  return []
}

export function showWaitingChip(status: string, locked: boolean, sample = false): boolean {
  return locked && !sample && status === 'todo'
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To-Do',
  build: 'Build',
  inprogress: 'Build',
  qa: 'QA',
  review: 'Review',
  done: 'Done',
}

/** The banner for a failed board move. A lock refusal replaces the generic line. */
export function boardMoveNotice(targetStatus: string, httpStatus: number, error: string): string {
  if (error === AGENTS_OWN_API_MESSAGE) return REFUSED_MOVE_NOTICE
  if (httpStatus === 404) return 'That ticket no longer exists. The board has been refreshed.'
  const what = STATUS_LABEL[targetStatus] ?? targetStatus
  return `Couldn't move ticket to ${what}. ${error}`
}

const COPY = [
  LOCK_NOTE,
  MANUAL_ON_NOTE,
  REFUSED_MOVE_NOTICE,
  AGENTS_OWN_API_MESSAGE,
  WAITING_CHIP,
  BOARD_SECTION,
  MANUAL_MOVES_LABEL,
  ...MANUAL_MOVES_OPTIONS,
  MANUAL_MOVES_HELP,
  manualMovesStateLine(true),
  manualMovesStateLine(false),
  backlogAddedNotice('MC-150'),
]

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]| - /

export function boardCopyProblems(): string[] {
  return COPY.filter((line) => DASH.test(line))
}
