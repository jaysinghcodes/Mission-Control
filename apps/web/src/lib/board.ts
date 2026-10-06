/**
 * One status → stage map for the board, Pipeline, and the Office pipeline
 * panel. Build / QA / Ship / Deploy match the kanban columns
 * (build, qa, review, done). To-Do and Backlog are not stages.
 *
 * Needs-you is an id link: approval.meta → ticket or run → the assignee.
 * Approval prose is never searched, so an agent named Patch cannot match
 * the words "security patch".
 */

export const STAGES = ['Build', 'QA', 'Ship', 'Deploy'] as const

export const BOARD_COLUMNS = [
  { title: 'To-Do', status: 'todo', aliases: [] as string[] },
  { title: 'Build', status: 'build', aliases: ['inprogress'] },
  { title: 'QA', status: 'qa', aliases: [] as string[] },
  { title: 'Review', status: 'review', aliases: [] as string[] },
  { title: 'Done', status: 'done', aliases: [] as string[] },
] as const

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

export function inColumn(
  status: string,
  col: { status: string; aliases: readonly string[] },
): boolean {
  const s = status.toLowerCase()
  return s === col.status || col.aliases.some((alias) => alias === s)
}

/** Working means the agent status, including someone who also needs a decision. */
export function isWorking(agent: { status?: string | null }): boolean {
  return agent.status === 'working'
}

export interface ApprovalLink {
  ticketId?: string | null
  ticketKey?: string | null
  runId?: string | null
  agentId?: string | null
}

export interface ApprovalLike {
  id?: string
  tag?: string | null
  desc?: string | null
  meta?: ApprovalLink | null
}

function links(rows: ApprovalLike[]): ApprovalLink[] {
  const out: ApprovalLink[] = []
  for (const row of rows) {
    const meta = row.meta
    if (!meta || typeof meta !== 'object') continue
    if (meta.ticketId || meta.ticketKey || meta.runId) out.push(meta)
  }
  return out
}

export function ticketNeedsYou(
  ticket: { id?: string | null; key?: string | null },
  rows: ApprovalLike[],
): boolean {
  return links(rows).some(
    (meta) =>
      (!!meta.ticketId && !!ticket.id && meta.ticketId === ticket.id) ||
      (!!meta.ticketKey && !!ticket.key && meta.ticketKey === ticket.key),
  )
}

function sameAgent(agent: { id?: string; name: string }, id: string | null | undefined): boolean {
  return !!id && (id === agent.id || id === agent.name)
}

export function agentNeedsYou(
  agent: { id?: string; name: string },
  rows: ApprovalLike[],
  tickets: { id?: string | null; key?: string | null; assignee?: string | null }[],
): boolean {
  for (const row of rows) {
    const meta = row.meta
    if (!meta || typeof meta !== 'object') continue
    // agentId is the assignee link when the approval carries one.
    if (meta.agentId) {
      if (sameAgent(agent, meta.agentId)) return true
      continue
    }
    const assigned = tickets.some((ticket) => {
      const linked =
        (!!meta.ticketId && !!ticket.id && meta.ticketId === ticket.id) ||
        (!!meta.ticketKey && !!ticket.key && meta.ticketKey === ticket.key)
      return linked && sameAgent(agent, ticket.assignee)
    })
    if (assigned) return true
  }
  return false
}

export function activityNeedsYou(
  payload: { ticket?: string | null; run?: string | null; job?: string | null } | null | undefined,
  rows: ApprovalLike[],
): boolean {
  const ticket = payload?.ticket ?? null
  const run = payload?.run ?? payload?.job ?? null
  if (!ticket && !run) return false
  return links(rows).some(
    (meta) =>
      (!!ticket && (ticket === meta.ticketId || ticket === meta.ticketKey)) ||
      (!!run && run === meta.runId),
  )
}
