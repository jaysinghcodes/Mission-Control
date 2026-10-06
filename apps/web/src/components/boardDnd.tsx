import { useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { statusFromOverId } from '../lib/boardDrag'

/**
 * Pointer and touch drags (Pointer Events cover both). The card is not in
 * the tab order: status buttons stay the keyboard path, unchanged.
 * A short distance threshold keeps a click on the title from becoming a drag.
 */
const sensors = { distance: 8 } as const

const collisionDetection: CollisionDetection = (args) => {
  const hit = pointerWithin(args)
  if (hit.length > 0) return hit
  return rectIntersection(args)
}

export function BoardDnd({
  children,
  onDrop,
  renderGhost,
}: {
  children: ReactNode
  onDrop: (ticketId: string, status: string) => void
  renderGhost: (ticketId: string) => ReactNode
}) {
  const pointer = useSensors(
    useSensor(PointerSensor, { activationConstraint: sensors }),
  )
  const [activeId, setActiveId] = useState<string | null>(null)

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const overId = event.over?.id
    if (overId == null) return
    const status = statusFromOverId(String(overId))
    if (!status) return
    onDrop(String(event.active.id), status)
  }

  return (
    <DndContext
      sensors={pointer}
      collisionDetection={collisionDetection}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null} zIndex={60} style={{ pointerEvents: 'none' }}>
        {activeId ? renderGhost(activeId) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** Column hit target, including the collapsed Done header. */
export function ColumnDrop({
  status,
  className,
  children,
}: {
  status: string
  className?: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` })
  return (
    <div
      ref={setNodeRef}
      className={className}
      style={
        isOver
          ? {
              borderRadius: '16px',
              background: 'var(--mc-sel)',
              boxShadow: 'inset 0 0 0 2px var(--mc-accent)',
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}

/**
 * Drag handle is the card itself. `tabIndex={-1}` keeps it out of the
 * keyboard sequence so the status buttons tab the way they did before.
 * `pan-y` lets a vertical swipe scroll the page; a horizontal move drags.
 */
export function CardDrag({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    attributes: { role: 'group', tabIndex: -1 },
  })
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'cursor-grabbing opacity-40' : 'cursor-grab'}
      style={{ touchAction: 'pan-y' }}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  )
}
