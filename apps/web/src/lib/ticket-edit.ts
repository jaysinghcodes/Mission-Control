/**
 * Ticket sheet copy and the PATCH the sheet is allowed to send.
 * Status is never included.
 */

import { descriptionFieldError, storedPriority, titleFieldError, type TicketPriority } from './ticket-fields'

export const SHEET_HEADING = 'Edit task'
export const CLOSE_TASK = 'Close task'
export const FIELD_TITLE = 'Title'
export const FIELD_DESCRIPTION = 'Description'
export const FIELD_PRIORITY = 'Priority'
export const FIELD_ASSIGNEE = 'Assignee'
export const FIELD_PROJECT = 'Project'
export const DESCRIPTION_PLACEHOLDER = 'Add detail for whoever picks this up.'
export const SAVE_LABEL = 'Save'
export const SAVING_LABEL = 'Saving…'
export const CANCEL_LABEL = 'Cancel'
export const DELETE_LABEL = 'Delete'
export const DELETING_LABEL = 'Deleting…'
export const ASSIGNEE_PICKUP = 'Only this agent can pick it up.'
export const ASSIGNEE_HAND_OFF = 'Changing the assignee hands this ticket to another agent.'
export const DELETE_HEADING = 'Delete this ticket?'
export const DELETE_DIALOG = 'Delete this ticket'
export const DELETE_REFUSAL = 'Agents own this ticket. Turn on Manual moves in Settings to delete it.'
export const GONE_UNKNOWN = 'That task is no longer on this board.'
export const SORT_LABEL = 'Sort'
export const NEW_TASK_PRIORITY = 'New task priority'
export const PRIORITY_HIGH = 'High'
export const PRIORITY_MEDIUM = 'Medium'
export const PRIORITY_LOW = 'Low'

const COPY = [
  SHEET_HEADING,
  CLOSE_TASK,
  FIELD_TITLE,
  FIELD_DESCRIPTION,
  FIELD_PRIORITY,
  FIELD_ASSIGNEE,
  FIELD_PROJECT,
  DESCRIPTION_PLACEHOLDER,
  SAVE_LABEL,
  SAVING_LABEL,
  CANCEL_LABEL,
  DELETE_LABEL,
  DELETING_LABEL,
  ASSIGNEE_PICKUP,
  ASSIGNEE_HAND_OFF,
  DELETE_HEADING,
  DELETE_DIALOG,
  DELETE_REFUSAL,
  GONE_UNKNOWN,
  SORT_LABEL,
  NEW_TASK_PRIORITY,
  PRIORITY_HIGH,
  PRIORITY_MEDIUM,
  PRIORITY_LOW,
]

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]| - |->|<-/

export function ticketEditCopyProblems(): string[] {
  return COPY.filter((line) => DASH.test(line))
}

export function ticketKeyLabel(key: string | null | undefined): string {
  const trimmed = key?.trim()
  return trimmed || 'Ticket'
}

export function savedNotice(key: string): string {
  return `${key} saved.`
}

export function deletedNotice(key: string): string {
  return `${key} deleted.`
}

export function saveFailed(key: string, message: string): string {
  return `Couldn't save ${key}. ${message}`
}

export function deleteFailed(key: string, message: string): string {
  return `Couldn't delete ${key}. ${message}`
}

export function goneNotice(key: string | null | undefined): string {
  const trimmed = key?.trim()
  if (!trimmed) return GONE_UNKNOWN
  return `${trimmed} no longer exists. The board has been refreshed.`
}

export function editDialogLabel(key: string): string {
  return `Edit ${key}`
}

export function deleteConfirmBody(key: string, held: boolean): string {
  if (held) return `${key} goes away and an agent may be working on it. Its Activity history stays.`
  return `${key} goes away. Its Activity history stays.`
}

export interface SheetLive {
  title: string
  description: string
  priority: string
  assignee: string | null
  projectId: string | null
}

export interface SheetDraft {
  title?: string
  description?: string
  priority?: TicketPriority
  assignee?: string
  projectId?: string | null
}

export function shownTitle(live: SheetLive, draft: SheetDraft): string {
  return draft.title !== undefined ? draft.title : live.title
}

export function shownDescription(live: SheetLive, draft: SheetDraft): string {
  return draft.description !== undefined ? draft.description : live.description
}

export function shownPriority(live: SheetLive, draft: SheetDraft): TicketPriority {
  if (draft.priority !== undefined) return draft.priority
  return storedPriority(live.priority)
}

export function shownAssignee(live: SheetLive, draft: SheetDraft): string {
  return draft.assignee !== undefined ? draft.assignee : (live.assignee ?? '')
}

export function shownProject(live: SheetLive, draft: SheetDraft): string | null {
  return draft.projectId !== undefined ? draft.projectId : live.projectId
}

export function sheetPatch(live: SheetLive, draft: SheetDraft): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (draft.title !== undefined) {
    const title = draft.title.trim()
    if (title !== live.title) body.title = title
  }
  if (draft.description !== undefined && draft.description !== live.description) {
    body.description = draft.description
  }
  if (draft.priority !== undefined && draft.priority !== live.priority) {
    body.priority = draft.priority
  }
  if (draft.assignee !== undefined && draft.assignee !== (live.assignee ?? '')) {
    body.assignee = draft.assignee
  }
  if (draft.projectId !== undefined && draft.projectId !== live.projectId) {
    body.projectId = draft.projectId
  }
  return Object.keys(body).length > 0 ? body : null
}

export function sheetErrors(live: SheetLive, draft: SheetDraft): { title: string | null; description: string | null } {
  return {
    title: titleFieldError(shownTitle(live, draft)),
    description: descriptionFieldError(shownDescription(live, draft)),
  }
}
