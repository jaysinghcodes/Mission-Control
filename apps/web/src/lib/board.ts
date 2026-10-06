/**
 * One status → stage map for the board, Pipeline, and the Office pipeline
 * panel. Build / QA / Ship / Deploy match the kanban columns
 * (build, qa, review, done). To-Do and Backlog are not stages.
 */

export const STAGES = ['Build', 'QA', 'Ship', 'Deploy'] as const

export function stageIndexForStatus(status: string | null | undefined): number | null {
  const s = (status ?? '').toLowerCase()
  if (s === 'build' || s === 'inprogress') return 0
  if (s === 'qa') return 1
  if (s === 'review') return 2
  if (s === 'done') return 3
  return null
}

export function stageCounts(tickets: { status: string }[]): number[] {
  const counts = [0, 0, 0, 0]
  for (const ticket of tickets) {
    const i = stageIndexForStatus(ticket.status)
    if (i !== null) counts[i] += 1
  }
  return counts
}

export interface ApprovalLike {
  tag?: string | null
  desc?: string | null
}

/** Pending approvals only. Callers pass the default GET /approvals list. */
export function pendingBlob(rows: ApprovalLike[]): string {
  return rows.map((row) => `${row.tag ?? ''} ${row.desc ?? ''}`).join('\n').toLowerCase()
}

export function mentions(blob: string, ...parts: (string | null | undefined)[]): boolean {
  if (!blob) return false
  return parts.some((part) => {
    const s = (part ?? '').trim().toLowerCase()
    return s.length >= 2 && blob.includes(s)
  })
}

export function ticketNeedsYou(
  ticket: { key?: string | null; title?: string | null },
  rows: ApprovalLike[],
): boolean {
  return mentions(pendingBlob(rows), ticket.key, ticket.title)
}

export function agentNeedsYou(
  agent: { name: string },
  rows: ApprovalLike[],
  tickets: { key?: string | null; title?: string | null; assignee?: string | null }[],
): boolean {
  const blob = pendingBlob(rows)
  if (!blob) return false
  if (mentions(blob, agent.name)) return true
  return tickets.some(
    (ticket) => ticket.assignee === agent.name && mentions(blob, ticket.key, ticket.title),
  )
}
