/**
 * Runs that belong on a ticket. Match by id only, the same rule as Pipeline Started.
 * A shared title is not a link.
 */

export interface LinkedRun {
  id: string
  name: string
  status: string
  agent?: string | null
  progress?: number | null
  ticketId?: string | null
}

export function runsForTicket<T extends { ticketId?: string | null }>(runs: T[], ticketId: string): T[] {
  return runs.filter((row) => !!row.ticketId && row.ticketId === ticketId)
}

/** Short label for a run status. Unknown values stay off the chip. */
export function runStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'needs_approval':
      return 'Needs approval'
    default:
      return 'Unknown'
  }
}

export function runStatusTone(status: string): 'blue' | 'orange' | 'green' | 'gray' {
  switch (status) {
    case 'running':
      return 'blue'
    case 'done':
      return 'green'
    case 'failed':
    case 'needs_approval':
      return 'orange'
    default:
      return 'gray'
  }
}
