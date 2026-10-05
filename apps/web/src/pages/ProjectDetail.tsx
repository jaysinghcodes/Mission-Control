import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { PageHeader, SoftCard, Btn, Banner, Toast, FieldError, EmptyState, StatusChip } from '../components/shell'
import type { Project, ProjectDetailResp, ProjectTicket } from '../types'

/**
 * One project. Tickets stay when the project is archived.
 * Rename keeps a rejected name in the field and shows the error beside it.
 */

const TOAST_MS = 4000

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog', todo: 'To-Do', build: 'Build', inprogress: 'Build', qa: 'QA', review: 'Review', done: 'Done',
}

export default function ProjectDetail() {
  const { id = '' } = useParams()
  const { data, loading, errorMessage: loadError, refetch } = useApi<ProjectDetailResp>(`/projects/${encodeURIComponent(id)}`, { pollMs: 10000 })
  const project = data?.project ?? null
  const tickets = data?.tickets ?? []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function succeed(msg: string) {
    setBanner(null)
    setDraftError(null)
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  async function rename() {
    if (!project || busy) return
    setBusy(true)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${project.id}`, { name: draft })
    setBusy(false)
    if (!r.ok) {
      const msg = r.error ?? 'Could not rename the project'
      setDraftError(msg)
      setBanner(msg)
      return
    }
    setEditing(false)
    succeed(`Renamed to “${draft.trim()}”.`)
    void refetch()
  }

  async function setArchived(archived: boolean) {
    if (!project || busy) return
    setBusy(true)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${project.id}`, { archived })
    setBusy(false)
    if (!r.ok) {
      setBanner(r.error ?? 'Could not update the project')
      return
    }
    succeed(archived ? `Archived “${project.name}”.` : `Unarchived “${project.name}”.`)
    void refetch()
  }

  const progress = project ? `${project.doneCount} of ${project.ticketCount}` : ''

  return (
    <div>
      <Link to="/projects" className="mb-3 inline-block text-[13px] font-semibold text-mc-accent">← Projects</Link>
      {loadError && (
        <Banner>Couldn't load this project ({loadError}). {data ? 'Showing the last loaded page; retrying automatically.' : 'Retrying automatically.'}</Banner>
      )}
      {banner && <Banner onDismiss={() => setBanner(null)}>{banner}</Banner>}
      {!project && !loadError && <p className="text-[13px] text-mc-sub">{loading ? 'Loading…' : 'Not loaded — see the notice above.'}</p>}
      {project && (
        <>
          <PageHeader
            title={editing ? 'Rename project' : project.name}
            summary={`${progress} done${project.archivedAt ? ' · Archived — tickets stay on the board' : ''}`}
            tools={
              editing ? (
                <>
                  <Btn kind="primary" disabled={busy} onClick={() => void rename()}>{busy ? 'Saving…' : 'Save'}</Btn>
                  <Btn kind="plain" onClick={() => { setEditing(false); setDraftError(null) }}>Cancel</Btn>
                </>
              ) : (
                <>
                  <Btn kind="plain" onClick={() => { setDraft(project.name); setDraftError(null); setEditing(true) }}>Rename</Btn>
                  <Btn kind="plain" disabled={busy} onClick={() => void setArchived(!project.archivedAt)}>
                    {busy ? 'Saving…' : project.archivedAt ? 'Unarchive' : 'Archive'}
                  </Btn>
                  <Link to={`/tasks?project=${encodeURIComponent(project.id)}`} className="inline-flex h-8 items-center rounded-lg bg-mc-accent px-3.5 text-[13px] font-semibold text-white">
                    Open on board
                  </Link>
                </>
              )
            }
          />
          {editing && (
            <div className="mb-4 max-w-md">
              <input
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setDraftError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename()
                  if (e.key === 'Escape') { setEditing(false); setDraftError(null) }
                }}
                aria-label="Project name"
                aria-invalid={!!draftError}
                className="h-9 w-full rounded-lg bg-mc-ctl px-3 text-[14px] outline-none"
              />
              {draftError && <FieldError>{draftError}</FieldError>}
            </div>
          )}
          {tickets.length === 0 ? (
            <EmptyState
              title="No tickets in this project yet."
              body="Nothing is broken — this project has no tickets. Create one on the board while this project is selected, or assign an existing ticket from its card."
            />
          ) : (
            <SoftCard className="divide-y divide-mc-sep">
              {tickets.map((row) => <TicketLine key={row.id} row={row} />)}
            </SoftCard>
          )}
          {tickets.length === 0 && (
            <Link to={`/tasks?project=${encodeURIComponent(project.id)}`} className="mt-4 inline-flex h-8 items-center rounded-lg bg-mc-accent px-3.5 text-[13px] font-semibold text-white">
              Go to the board
            </Link>
          )}
        </>
      )}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}

function TicketLine({ row }: { row: ProjectTicket }) {
  const done = row.status === 'done'
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="w-24 whitespace-nowrap text-[12px] text-mc-sub">{row.key ?? row.id.slice(0, 8)}</span>
      <span className="min-w-0 flex-1 text-[14px] font-medium break-words">{row.title}</span>
      <StatusChip label={STATUS_LABEL[row.status] ?? row.status} tone={done ? 'green' : row.status === 'qa' ? 'orange' : 'blue'} />
    </div>
  )
}
