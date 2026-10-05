import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { Card, PillButton } from '../components/ui'
import type { Project, ProjectsResp } from '../types'

/**
 * Projects list — /#/projects (ticket 4).
 *
 * Create, rename, archive. The API's default list hides archived projects;
 * this page asks for `archived=all` so the archived ones can sit in a
 * collapsed section instead of vanishing with no way back. The open list
 * is still only the active projects.
 *
 * Blank and duplicate names are NOT caught here. The request goes to the
 * API, which answers 400 / 409, and that message is what the notice shows.
 */

const NOTICE_MS = 6000

/** "1 of 2" — the done count over every ticket on the project. */
function progress(p: Project): string {
  return `${p.doneCount} of ${p.ticketCount}`
}

export default function Projects() {
  // archived=all so Unarchive has something to show. The visible list below
  // still drops archived rows — that is the default list.
  const { data, loading, errorMessage: loadError, refetch } = useApi<ProjectsResp>('/projects?archived=all', { pollMs: 15000 })
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const projects = data?.projects ?? []
  const active = projects.filter((p) => !p.archivedAt)
  const archived = projects.filter((p) => p.archivedAt)

  function showNotice(msg: string) {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  async function create() {
    if (saving) return
    setSaving(true)
    // Send the name as typed, including whitespace. The API trims and
    // returns 400 when nothing is left — we do not pre-empt that, so the
    // notice is the server's message.
    const r = await apiSend<{ project: Project }>('POST', '/projects', { name })
    setSaving(false)
    if (!r.ok) {
      showNotice(r.error ?? 'Could not create the project')
      return
    }
    setName('')
    void refetch()
  }

  async function rename(id: string) {
    if (busyId) return
    setBusyId(id)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${id}`, { name: draft })
    setBusyId(null)
    if (!r.ok) {
      showNotice(r.error ?? 'Could not rename the project')
      return
    }
    setEditingId(null)
    void refetch()
  }

  async function setArchived(id: string, archivedFlag: boolean) {
    if (busyId) return
    setBusyId(id)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${id}`, { archived: archivedFlag })
    setBusyId(null)
    if (!r.ok) {
      showNotice(r.error ?? 'Could not update the project')
      return
    }
    void refetch()
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-xl">
          <div className="text-[22px] font-semibold">Projects</div>
          <div className="mt-1 text-[13px] text-mc-sub">
            Group tickets. A ticket sits in one project, or in none. Archiving hides a project here and leaves its tickets on the board.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="New project name…"
            aria-label="New project name"
            className="h-9 w-64 max-w-full rounded-full border border-mc-border bg-mc-card px-4 text-[13px] text-mc-text placeholder:text-mc-faint outline-none focus:border-mc-primary"
          />
          <PillButton label={saving ? 'Saving…' : '+ New project'} on onClick={() => void create()} className="shrink-0" />
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mt-4 rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
          Couldn't load projects ({loadError}).{' '}
          {data ? 'Showing the last loaded list; retrying automatically.' : 'Retrying automatically.'}
        </div>
      )}

      {notice && (
        <div role="status" className="mt-4 flex items-center justify-between rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-4 text-[11px] font-semibold hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {active.length === 0 && (
          <Card className="px-5 py-8">
            <div className="text-[13px] text-mc-faint">
              {!data
                ? loading && !loadError
                  ? 'Loading…'
                  : 'Not loaded — see the notice above.'
                : 'No projects yet. Name one above — tickets can be attached from the Tickets board.'}
            </div>
          </Card>
        )}
        {active.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            editing={editingId === p.id}
            draft={draft}
            busy={busyId === p.id}
            onDraft={setDraft}
            onStartEdit={() => { setEditingId(p.id); setDraft(p.name) }}
            onCancelEdit={() => setEditingId(null)}
            onRename={() => void rename(p.id)}
            onArchive={() => void setArchived(p.id, true)}
          />
        ))}
      </div>

      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.08em] text-mc-faint">
            Archived ({archived.length})
          </summary>
          <p className="mt-2 text-[12.5px] text-mc-sub">
            Hidden from this list until you open this section. Their tickets were not deleted.
          </p>
          <div className="mt-3 space-y-3">
            {archived.map((p) => (
              <Card key={p.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/projects/${p.id}`} className="text-[14px] font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <div className="mt-1 text-[12px] text-mc-sub">{progress(p)} done</div>
                </div>
                <button
                  type="button"
                  disabled={busyId === p.id}
                  onClick={() => void setArchived(p.id, false)}
                  className="h-7 px-3 rounded-full bg-mc-inner text-mc-sub text-[11px] font-semibold hover:opacity-80 disabled:opacity-50"
                >
                  {busyId === p.id ? 'Saving…' : 'Unarchive'}
                </button>
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ProjectRow({
  project, editing, draft, busy, onDraft, onStartEdit, onCancelEdit, onRename, onArchive,
}: {
  project: Project
  editing: boolean
  draft: string
  busy: boolean
  onDraft: (v: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onRename: () => void
  onArchive: () => void
}) {
  return (
    <Card className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename()
              if (e.key === 'Escape') onCancelEdit()
            }}
            aria-label={`Rename ${project.name}`}
            className="h-8 w-64 max-w-full rounded-full border border-mc-border bg-mc-card px-3 text-[13px] text-mc-text outline-none focus:border-mc-primary"
          />
        ) : (
          <Link to={`/projects/${project.id}`} className="text-[15px] font-semibold hover:underline">
            {project.name}
          </Link>
        )}
        <div className="mt-1 text-[12px] text-mc-sub">{progress(project)} done</div>
      </div>
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <button type="button" disabled={busy} onClick={onRename} className="h-7 px-3 rounded-full bg-mc-primary text-white text-[11px] font-semibold disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onCancelEdit} className="h-7 px-3 rounded-full bg-mc-inner text-mc-sub text-[11px] font-semibold">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onStartEdit} className="h-7 px-3 rounded-full bg-mc-inner text-mc-sub text-[11px] font-semibold hover:opacity-80">
              Rename
            </button>
            <button type="button" disabled={busy} onClick={onArchive} className="h-7 px-3 rounded-full bg-mc-inner text-mc-sub text-[11px] font-semibold hover:opacity-80 disabled:opacity-50">
              {busy ? 'Saving…' : 'Archive'}
            </button>
          </>
        )}
      </div>
    </Card>
  )
}
