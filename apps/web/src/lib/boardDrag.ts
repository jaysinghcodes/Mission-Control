/**
 * Optimistic kanban moves for the Tasks board.
 *
 * A drag PATCHes the same `/tickets/:id` status field the column buttons use.
 * The card changes column immediately. A failed latest save puts it back in
 * the column and list position it had before that unconfirmed chain, and the
 * caller shows the existing move-failure notice.
 *
 * In-flight drags are ordered with a per-ticket sequence (the same counter
 * the button path uses when one is shared). A fast A→B→C keeps C on screen
 * even if B's response arrives last. An earlier response never writes status.
 * If the newest drag fails, the card falls back to the previous unconfirmed
 * column, and from there to the last server column once every in-flight
 * drag has failed — so a dead API cannot leave the card mid-chain.
 */
import { useCallback, useRef, useState } from 'react'
import { BOARD_COLUMNS, inColumn } from './board'

const DROPPABLE_STATUSES = new Set(['todo', 'build', 'qa', 'review', 'done'])

/** Column id written on a droppable (`col:build`). Unknown ids do not move. */
export function statusFromOverId(overId: string): string | null {
  if (!overId.startsWith('col:')) return null
  const status = overId.slice(4)
  return DROPPABLE_STATUSES.has(status) ? status : null
}

/** Board column for a ticket status. `inprogress` lives in Build. */
export function columnKey(status: string): string | null {
  const col = BOARD_COLUMNS.find((c) => inColumn(status, c))
  return col ? col.status : null
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

/** Same sentences the status buttons already show. */
export function moveFailureNotice(status: string, httpStatus: number, error: string): string {
  if (httpStatus === 404) return 'That ticket no longer exists — the board has been refreshed.'
  const what = STATUS_LABEL[status] ?? status
  return `Couldn't move ticket to ${what} — ${error}`
}

export type DragPatchResult<T> =
  | { ok: true; ticket: T | null }
  | { ok: false; httpStatus: number; error: string }

interface PendingMove {
  seq: number
  nextStatus: string
  /** Status before this ticket's current run of unconfirmed drags. */
  originStatus: string
  /** Set when an earlier drag's PATCH already returned ok. Kept so a newer failure can fall back to it. */
  settled?: 'ok'
}

export interface BoardDragState<T extends { id: string; status: string }> {
  tickets: T[]
  pending: Map<string, PendingMove[]>
}

export function emptyBoardDrag<T extends { id: string; status: string }>(
  tickets: T[] = [],
): BoardDragState<T> {
  return { tickets, pending: new Map() }
}

/** Server list arrived. In-flight cards keep the column the user dragged them to. */
export function acceptServer<T extends { id: string; status: string }>(
  state: BoardDragState<T>,
  server: T[],
): BoardDragState<T> {
  if (state.pending.size === 0) return { ...state, tickets: server }
  const local = new Map(state.tickets.map((t) => [t.id, t]))
  const tickets = server.map((row) => {
    const queue = state.pending.get(row.id)
    if (!queue || queue.length === 0) return row
    const optimistic = local.get(row.id)
    return optimistic ? { ...row, status: optimistic.status } : row
  })
  return { ...state, tickets }
}

export function beginDrag<T extends { id: string; status: string }>(
  state: BoardDragState<T>,
  id: string,
  nextStatus: string,
  seq: number,
): { ok: true; state: BoardDragState<T> } | { ok: false; reason: 'missing' | 'same-column' } {
  const index = state.tickets.findIndex((t) => t.id === id)
  if (index < 0) return { ok: false, reason: 'missing' }
  const current = state.tickets[index]
  const from = columnKey(current.status)
  const to = columnKey(nextStatus)
  if (!to || from === to) return { ok: false, reason: 'same-column' }
  const existing = state.pending.get(id) ?? []
  const originStatus = existing.length > 0 ? existing[0].originStatus : current.status
  const tickets = state.tickets.map((t, i) => (i === index ? { ...t, status: nextStatus } : t))
  const pending = new Map(state.pending)
  pending.set(id, [...existing, { seq, nextStatus, originStatus }])
  return { ok: true, state: { tickets, pending } }
}

export interface SettleResult<T extends { id: string; status: string }> {
  state: BoardDragState<T>
  /** False when this seq is not one of the ticket's in-flight drags. */
  known: boolean
  /** This response was the newest drag still in flight, so it may notify. */
  authoritative: boolean
  snappedBack: boolean
  notice: string | null
  /** No drags left in flight for this ticket — safe to refetch. */
  idle: boolean
}

/**
 * Apply one PATCH result.
 * `authoritative` is false for an earlier drag whose newer sibling is still
 * the one on screen: the status is left alone so a late body cannot win.
 */
export function settleDrag<T extends { id: string; status: string }>(
  state: BoardDragState<T>,
  id: string,
  seq: number,
  result: DragPatchResult<T>,
): SettleResult<T> {
  const list = state.pending.get(id) ?? []
  const index = list.findIndex((move) => move.seq === seq)
  if (index < 0) {
    return { state, known: false, authoritative: false, snappedBack: false, notice: null, idle: false }
  }
  const move = list[index]
  const wasLatest = index === list.length - 1
  const pending = new Map(state.pending)

  // An earlier response must not paint over a newer drag. Remember a success
  // so the newer drag, if it fails, can fall back to that column. A failure
  // is dropped — that column was never saved.
  if (!wasLatest) {
    const next = result.ok
      ? list.map((item) => (item.seq === seq ? { ...item, settled: 'ok' as const } : item))
      : list.filter((item) => item.seq !== seq)
    if (next.length > 0) pending.set(id, next)
    else pending.delete(id)
    return {
      state: { tickets: state.tickets, pending },
      known: true,
      authoritative: false,
      snappedBack: false,
      notice: null,
      idle: next.length === 0,
    }
  }

  if (result.ok) {
    pending.delete(id)
    const tickets = result.ticket
      ? state.tickets.map((t) => (t.id === id ? { ...t, ...result.ticket } : t))
      : state.tickets
    return {
      state: { tickets, pending },
      known: true,
      authoritative: true,
      snappedBack: false,
      notice: null,
      idle: true,
    }
  }

  const rest = list.filter((item) => item.seq !== seq)
  const fallback = rest.length > 0 ? rest[rest.length - 1].nextStatus : move.originStatus
  const stillInFlight = rest.some((item) => item.settled !== 'ok')
  if (rest.length > 0 && stillInFlight) pending.set(id, rest)
  else pending.delete(id)
  const tickets = state.tickets.map((t) => (t.id === id ? { ...t, status: fallback } : t))
  const snappedBack = state.tickets.some((t) => t.id === id && t.status !== fallback)
  return {
    state: { tickets, pending },
    known: true,
    authoritative: true,
    snappedBack,
    notice: moveFailureNotice(move.nextStatus, result.httpStatus, result.error),
    idle: !stillInFlight,
  }
}

export interface BoardDragOptions {
  onError?: (message: string) => void
  onSettled?: () => void
  /** Fires when a ticket gains or loses an in-flight drag. */
  onBusy?: (id: string, busy: boolean) => void
  /**
   * Shared with the status-button path so a button response that loses the
   * race does not repaint over a newer drag (and the reverse).
   */
  moveSeq?: { current: Map<string, number> }
}

/**
 * Board tickets plus `moveTo`, the drop handler.
 * `server` is the last list from the API. While a drag is in flight, a poll
 * may replace that list; the in-flight card keeps its dragged column.
 */
export function useBoardDrag<T extends { id: string; status: string }>(
  server: T[] | null,
  patch: (id: string, status: string) => Promise<DragPatchResult<T>>,
  opts?: BoardDragOptions,
): {
  tickets: T[]
  moveTo: (id: string, status: string) => Promise<void>
  busy: ReadonlySet<string>
  /** Synchronous in-flight set, so a status button can ignore a click during a drag before the next paint. */
  busyRef: { current: Set<string> }
} {
  const [state, setState] = useState<BoardDragState<T>>(() => emptyBoardDrag(server ?? []))
  const stateRef = useRef(state)
  const [seen, setSeen] = useState(server)
  const ownSeq = useRef(new Map<string, number>())
  const seqRef = opts?.moveSeq ?? ownSeq
  const busyRef = useRef(new Set<string>())
  const patchRef = useRef(patch)
  const onErrorRef = useRef(opts?.onError)
  const onSettledRef = useRef(opts?.onSettled)
  const onBusyRef = useRef(opts?.onBusy)
  patchRef.current = patch
  onErrorRef.current = opts?.onError
  onSettledRef.current = opts?.onSettled
  onBusyRef.current = opts?.onBusy

  let display = state
  if (server !== seen) {
    setSeen(server)
    if (server) {
      display = acceptServer(stateRef.current, server)
      stateRef.current = display
      setState(display)
    }
  }

  const commit = useCallback((next: BoardDragState<T>) => {
    stateRef.current = next
    setState(next)
  }, [])

  const moveTo = useCallback(async (id: string, status: string) => {
    const map = seqRef.current
    const prev = map.get(id)
    const seq = (prev ?? 0) + 1
    map.set(id, seq)
    const wasBusy = (stateRef.current.pending.get(id)?.length ?? 0) > 0
    const begun = beginDrag(stateRef.current, id, status, seq)
    if (!begun.ok) {
      if (map.get(id) === seq) {
        if (prev === undefined) map.delete(id)
        else map.set(id, prev)
      }
      return
    }
    commit(begun.state)
    if (!wasBusy) {
      busyRef.current.add(id)
      onBusyRef.current?.(id, true)
    }
    let result: DragPatchResult<T>
    try {
      result = await patchRef.current(id, status)
    } catch {
      result = { ok: false, httpStatus: 0, error: 'API unreachable — is the server running?' }
    }
    // A newer drag may have replaced this ticket's queue while we waited.
    // settleDrag drops a response that is no longer the newest pending one.
    const settled = settleDrag(stateRef.current, id, seq, result)
    if (!settled.known) return
    commit(settled.state)
    // An earlier drag that fails after a newer one already failed must not
    // replace that notice. The newest issued seq is the drag the user sees.
    if (settled.notice && seqRef.current.get(id) === seq) onErrorRef.current?.(settled.notice)
    if (settled.idle) {
      busyRef.current.delete(id)
      onBusyRef.current?.(id, false)
      onSettledRef.current?.()
    }
  }, [commit, seqRef])

  const busy = new Set<string>()
  for (const [id, queue] of display.pending) {
    if (queue.length > 0) busy.add(id)
  }
  return { tickets: display.tickets, moveTo, busy, busyRef }
}
