/**
 * Length limits and priority values. The API source is
 * apps/api/src/tickets/ticket-fields.ts. Keep the two in step.
 */

export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 4000

export const PRIORITIES = ['high', 'med', 'low'] as const
export type TicketPriority = (typeof PRIORITIES)[number]

export const TITLE_REQUIRED_UI = 'Title is required'
export const TITLE_LENGTH_UI = 'Title must be 120 characters or fewer'
export const DESCRIPTION_LENGTH_UI = 'Description must be 4000 characters or fewer'

export function isTicketPriority(value: string): value is TicketPriority {
  return value === 'high' || value === 'med' || value === 'low'
}

/** Unknown stored values display as Medium and are not rewritten until a save. */
export function storedPriority(value: string | null | undefined): TicketPriority {
  if (value === 'high' || value === 'low' || value === 'med') return value
  return 'med'
}

export function priorityLabel(value: string | null | undefined): 'High' | 'Medium' | 'Low' {
  const stored = storedPriority(value)
  if (stored === 'high') return 'High'
  if (stored === 'low') return 'Low'
  return 'Medium'
}

export function titleFieldError(value: string): string | null {
  const title = value.trim()
  if (!title) return TITLE_REQUIRED_UI
  if (title.length > TITLE_MAX) return TITLE_LENGTH_UI
  return null
}

export function descriptionFieldError(value: string): string | null {
  if (value.length > DESCRIPTION_MAX) return DESCRIPTION_LENGTH_UI
  return null
}
