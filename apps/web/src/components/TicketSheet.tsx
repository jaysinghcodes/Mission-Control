import { useEffect, useRef, useState } from 'react'
import type { Agent, Project } from '../types'
import { OPERATOR_ASSIGNEE } from '../config'
import { apiSend } from '../hooks/useApi'
import { Btn, FieldError, StatusChip } from './shell'
import { TicketRuns } from './TicketRuns'
import type { LinkedRun } from '../lib/ticket-runs'
import { useEscape } from '../lib/useEscape'
import { useNaming } from '../lib/naming'
import { canDeleteTicket, isSampleTicket, ticketHeld, ticketStage, DELETE_REFUSAL } from '../lib/board-lock'
import { PRIORITIES, priorityLabel, storedPriority } from '../lib/ticket-fields'
import {
  ASSIGNEE_HAND_OFF,
  ASSIGNEE_PICKUP,
  CANCEL_LABEL,
  CLOSE_TASK,
  DELETE_DIALOG,
  DELETE_HEADING,
  DELETE_LABEL,
  DELETING_LABEL,
  DESCRIPTION_PLACEHOLDER,
  FIELD_ASSIGNEE,
  FIELD_DESCRIPTION,
  FIELD_PRIORITY,
  FIELD_PROJECT,
  FIELD_TITLE,
  SAVE_LABEL,
  SAVING_LABEL,
  SHEET_HEADING,
  deleteConfirmBody,
  deleteFailed,
  editDialogLabel,
  saveFailed,
  sheetErrors,
  sheetPatch,
  shownAssignee,
  shownDescription,
  shownPriority,
  shownProject,
  shownTitle,
  ticketKeyLabel,
  type SheetDraft,
  type SheetLive,
} from '../lib/ticket-edit'
import type { SortMode } from '../lib/ticket-sort'
import { SORT_LABELS } from '../lib/ticket-sort'

const controlClass =
  'mt-1 w-full max-w-full rounded-lg bg-mc-ctl px-3 text-base text-mc-text outline-none sm:text-[13px]'

export interface SheetTicket {
  id: string
  key: string | null
  title: string
  description?: string | null
  status: string
  priority: string
  assignee: string | null
  projectId: string | null
}

export function PriorityChip({
  priority,
  surface,
}: {
  priority: string
  surface: 'card' | 'backlog'
}) {
  const kind = storedPriority(priority)
  if (surface === 'card' && kind === 'med') return null
  const tone = kind === 'high' ? 'orange' : kind === 'low' ? 'gray' : 'blue'
  return <StatusChip label={priorityLabel(kind)} tone={tone} />
}

export function SortControl({
  label,
  mode,
  onChange,
}: {
  label: string
  mode: SortMode
  onChange: (mode: SortMode) => void
}) {
  return (
    <label className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-mc-sub">
      <span className="shrink-0">{'Sort'}</span>
      <select
        aria-label={`Sort ${label}`}
        data-sort-column={label}
        value={mode}
        onChange={(event) => onChange(event.target.value as SortMode)}
        onPointerDown={(event) => event.stopPropagation()}
        className="h-8 min-w-0 flex-1 rounded-lg bg-mc-ctl px-2 text-base text-mc-text outline-none sm:text-[13px]"
      >
        {(Object.keys(SORT_LABELS) as SortMode[]).map((item) => (
          <option key={item} value={item}>{SORT_LABELS[item]}</option>
        ))}
      </select>
    </label>
  )
}

export function TicketSheet({
  ticket,
  roster,
  projects,
  projectsLoaded,
  locked,
  runs,
  onClose,
  onSaved,
  onDeleted,
  onMissing,
  onRefused,
}: {
  ticket: SheetTicket
  roster: readonly Agent[]
  projects: readonly Project[]
  projectsLoaded: boolean
  locked: boolean
  runs: readonly LinkedRun[]
  onClose: () => void
  onSaved: (ticket: SheetTicket) => void
  onDeleted: (ticket: SheetTicket) => void
  onMissing: (key: string) => void
  onRefused: () => void
}) {
  const naming = useNaming()
  const titleRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const [draft, setDraft] = useState<SheetDraft>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const key = ticketKeyLabel(ticket.key)

  const live: SheetLive = {
    title: ticket.title,
    description: ticket.description ?? '',
    priority: ticket.priority,
    assignee: ticket.assignee,
    projectId: ticket.projectId,
  }
  const errors = sheetErrors(live, draft)
  const patch = sheetPatch(live, draft)
  const dirty = patch !== null
  const invalid = Boolean(errors.title || errors.description)
  const canSave = dirty && !invalid && !saving
  const allowed = canDeleteTicket(ticket.status, locked, isSampleTicket(ticket))
  const assignee = shownAssignee(live, draft)
  const assigneeChanged = draft.assignee !== undefined && draft.assignee !== (live.assignee ?? '')
  const hint = assigneeHint(ticket.status, assignee, locked, assigneeChanged, roster)

  useEffect(() => {
    setDraft({})
    setFormError(null)
    setConfirming(false)
    setDeleteError(null)
    titleRef.current?.focus()
  }, [ticket.id])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEscape(() => {
    if (deleting || saving) return
    if (confirming) {
      setConfirming(false)
      setDeleteError(null)
      return
    }
    onClose()
  }, true)

  async function save() {
    if (savingRef.current || !canSave || !patch) return
    savingRef.current = true
    setSaving(true)
    setFormError(null)
    const result = await apiSend<{ ticket: SheetTicket }>('PATCH', `/tickets/${ticket.id}`, patch)
    savingRef.current = false
    setSaving(false)
    if (result.ok && result.data?.ticket) {
      onSaved(result.data.ticket)
      return
    }
    if (result.status === 404) {
      onMissing(key)
      return
    }
    setFormError(saveFailed(key, result.error ?? 'Request failed'))
  }

  async function confirmDelete() {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError(null)
    const result = await apiSend('DELETE', `/tickets/${ticket.id}`)
    if (result.ok) {
      onDeleted(ticket)
      return
    }
    deletingRef.current = false
    setDeleting(false)
    if (result.status === 404) {
      onMissing(key)
      return
    }
    if (result.status === 409) {
      setConfirming(false)
      onRefused()
      return
    }
    setDeleteError(deleteFailed(key, result.error ?? 'Request failed'))
  }

  function projectField() {
    const selected = shownProject(live, draft)
    const current = projects.find((project) => project.id === (draft.projectId !== undefined ? draft.projectId : ticket.projectId)) ?? null
    if (draft.projectId === undefined && ticket.projectId && !projectsLoaded) {
      return <div className="mt-1 text-[13px] text-mc-sub">Loading project…</div>
    }
    if (draft.projectId === undefined && ticket.projectId && (current?.archivedAt || (projectsLoaded && !current))) {
      const label = current ? `${current.name} (archived)` : 'Archived project'
      return (
        <div
          className="mt-1 break-words text-[13px] text-mc-sub"
          aria-readonly="true"
          title="This project is archived. Unarchive it on Projects before reassigning."
        >
          {label}
        </div>
      )
    }
    const active = projects.filter((project) => !project.archivedAt)
    return (
      <select
        aria-label={FIELD_PROJECT}
        value={selected ?? ''}
        onChange={(event) => setDraft((prev) => ({ ...prev, projectId: event.target.value || null }))}
        className={`${controlClass} h-10 sm:h-8`}
      >
        <option value="">No project</option>
        {active.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    )
  }

  const choices = assigneeChoices(roster, assignee, naming.present)

  return (
    <div className="fixed inset-0 z-50" data-ticket-sheet="true">
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={() => {
          if (!dirty && !saving && !confirming) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editDialogLabel(key)}
        data-ticket-dirty={dirty ? 'true' : 'false'}
        className="absolute inset-y-0 right-0 flex w-full min-w-0 flex-col bg-mc-card shadow-2xl outline-none sm:max-w-[420px] sm:border-l sm:border-mc-border"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-mc-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-mc-text">{SHEET_HEADING}</div>
            <div className="mt-1 break-words text-[12px] text-mc-sub">{key}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={CLOSE_TASK}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mc-faint hover:bg-mc-inner hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <label className="block text-[12px] font-semibold text-mc-sub">
            {FIELD_TITLE}
            <input
              ref={titleRef}
              value={shownTitle(live, draft)}
              aria-label={FIELD_TITLE}
              aria-invalid={errors.title ? true : undefined}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, title: event.target.value }))
                setFormError(null)
              }}
              className={`${controlClass} h-10 sm:h-8`}
            />
          </label>
          {errors.title && <FieldError>{errors.title}</FieldError>}

          <label className="block text-[12px] font-semibold text-mc-sub">
            {FIELD_DESCRIPTION}
            <textarea
              value={shownDescription(live, draft)}
              aria-label={FIELD_DESCRIPTION}
              aria-invalid={errors.description ? true : undefined}
              placeholder={DESCRIPTION_PLACEHOLDER}
              rows={5}
              onChange={(event) => {
                setDraft((prev) => ({ ...prev, description: event.target.value }))
                setFormError(null)
              }}
              className={`${controlClass} py-2`}
            />
          </label>
          {errors.description && <FieldError>{errors.description}</FieldError>}

          <label className="block text-[12px] font-semibold text-mc-sub">
            {FIELD_PRIORITY}
            <select
              aria-label={FIELD_PRIORITY}
              value={shownPriority(live, draft)}
              onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value as SheetDraft['priority'] }))}
              className={`${controlClass} h-10 sm:h-8`}
            >
              {PRIORITIES.map((item) => (
                <option key={item} value={item}>{priorityLabel(item)}</option>
              ))}
            </select>
          </label>

          <label className="block text-[12px] font-semibold text-mc-sub">
            {FIELD_ASSIGNEE}
            <select
              aria-label={FIELD_ASSIGNEE}
              value={assignee}
              onChange={(event) => setDraft((prev) => ({ ...prev, assignee: event.target.value }))}
              className={`${controlClass} h-10 sm:h-8`}
            >
              {choices.map((choice) => (
                <option key={choice.value || 'blank'} value={choice.value}>{choice.label}</option>
              ))}
            </select>
          </label>
          {hint && <p className="text-[12px] leading-snug text-mc-sub">{hint}</p>}

          <div>
            <div className="text-[12px] font-semibold text-mc-sub">{FIELD_PROJECT}</div>
            {projectField()}
          </div>

          <TicketRuns runs={[...runs]} />
          {formError && <p className="break-words text-[13px] text-mc-orangetext" data-sheet-error="true">{formError}</p>}
        </div>

        <div className="shrink-0 border-t border-mc-border px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Btn kind="primary" disabled={!canSave} onClick={() => void save()}>{saving ? SAVING_LABEL : SAVE_LABEL}</Btn>
            <Btn kind="plain" disabled={saving} onClick={onClose}>{CANCEL_LABEL}</Btn>
            <Btn kind="plain" disabled={!allowed || saving || deleting} onClick={() => { setDeleteError(null); setConfirming(true) }}>{DELETE_LABEL}</Btn>
          </div>
          {!allowed && <p className="mt-2 break-words text-[12px] leading-snug text-mc-sub" data-delete-refused="true">{DELETE_REFUSAL}</p>}
        </div>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4"
          onClick={() => {
            if (!deleting) {
              setConfirming(false)
              setDeleteError(null)
            }
          }}
        >
          <div
            className="mc-card w-full max-w-md px-6 py-5"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={DELETE_DIALOG}
            data-delete-confirm="true"
          >
            <div className="text-[17px] font-semibold">{DELETE_HEADING}</div>
            <p className="mt-3 break-words text-[14px] text-mc-sub2">{deleteConfirmBody(key, ticketHeld(ticket.status))}</p>
            {deleteError && <p className="mt-3 break-words text-[13px] text-mc-orangetext">{deleteError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn kind="primary" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? DELETING_LABEL : DELETE_LABEL}</Btn>
              <Btn kind="plain" disabled={deleting} onClick={() => { setConfirming(false); setDeleteError(null) }}>{CANCEL_LABEL}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function assigneeHint(
  status: string,
  assignee: string,
  locked: boolean,
  changed: boolean,
  roster: readonly Agent[],
): string | null {
  if (ticketStage(status) === 'todo' && roster.some((agent) => agent.id === assignee)) return ASSIGNEE_PICKUP
  if (ticketHeld(status) && locked && changed) return ASSIGNEE_HAND_OFF
  return null
}

function assigneeChoices(
  roster: readonly Agent[],
  assignee: string,
  present: (agent: Agent) => { name: string },
): { value: string; label: string }[] {
  const choices = [
    { value: OPERATOR_ASSIGNEE, label: OPERATOR_ASSIGNEE },
    ...roster.map((agent) => ({ value: agent.id, label: present(agent).name || agent.id })),
  ]
  if (!choices.some((choice) => choice.value === assignee)) {
    choices.push({ value: assignee, label: assignee })
  }
  return choices
}
