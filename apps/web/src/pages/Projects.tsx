import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import type { Agent, AgentsResp, Project, ProjectsResp } from '../types'
import { PageHeader, Segmented, SoftCard, StatusChip, Btn, Face, AgentName, EmptyState, Banner, Toast, FieldError } from '../components/shell'
import { agentCaption } from '../data/roster'

/**
 * Projects — ticket 4, drawn as the Apple list.
 * Name errors stay in the field and show inline. A success toast replaces
 * the error banner. Archive is on the row (hover on a finished project).
 */

const TOAST_MS = 4000

function lead(project: Project, ticketsNote: string | undefined, roster: Agent[]): Agent | { id: string; name: string; role: string | null; status: string } {
  const hint = (ticketsNote ?? project.name).toLowerCase()
  const hit = roster.find((a) => hint.includes(a.name.toLowerCase()) || hint.includes(agentCaption(a.name, a.role).name.toLowerCase()))
  return hit ?? roster[0] ?? { id: project.id, name: 'Agent', role: null, status: 'idle' }
}

export default function Projects() {
  const { data, loading, errorMessage: loadError, refetch } = useApi<ProjectsResp>('/projects?archived=all', { pollMs: 15000 })
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const roster = rosterQ.data?.agents ?? []
  const [filter, setFilter] = useState(0)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const projects = data?.projects ?? []
  const active = projects.filter((p) => !p.archivedAt)
  const archived = projects.filter((p) => p.archivedAt)
  const rows = filter === 1 ? archived : filter === 2 ? projects : active
  const done = active.reduce((s, p) => s + p.doneCount, 0)
  const total = active.reduce((s, p) => s + p.ticketCount, 0)
  const summary = data ? `${active.length} active · ${done} of ${total} tasks done` : 'Loading projects…'

  function succeed(msg: string) {
    setBanner(null)
    setNameError(null)
    setDraftError(null)
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  async function create() {
    if (saving) return
    setSaving(true)
    const r = await apiSend<{ project: Project }>('POST', '/projects', { name })
    setSaving(false)
    if (!r.ok) {
      const msg = r.error ?? 'Could not create the project'
      setNameError(msg)
      setBanner(msg)
      return
    }
    const created = name.trim()
    setName('')
    setCreating(false)
    succeed(`Created “${created || r.data?.project.name || 'project'}”.`)
    void refetch()
  }

  async function rename(id: string) {
    if (busyId) return
    setBusyId(id)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${id}`, { name: draft })
    setBusyId(null)
    if (!r.ok) {
      const msg = r.error ?? 'Could not rename the project'
      setDraftError(msg)
      setBanner(msg)
      return
    }
    setEditingId(null)
    succeed(`Renamed to “${draft.trim()}”.`)
    void refetch()
  }

  async function setArchived(id: string, archivedFlag: boolean, label: string) {
    if (busyId) return
    setBusyId(id)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${id}`, { archived: archivedFlag })
    setBusyId(null)
    if (!r.ok) {
      setBanner(r.error ?? 'Could not update the project')
      return
    }
    succeed(archivedFlag ? `Archived “${label}”.` : `Unarchived “${label}”.`)
    void refetch()
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        summary={summary}
        tools={
          <>
            <Segmented labels={['Active', 'Archived', 'All']} active={filter} onChange={setFilter} ariaLabel="Project filter" />
            <Btn kind="primary" onClick={() => { setCreating(true); setNameError(null) }}>New project</Btn>
          </>
        }
      />

      {loadError && (
        <Banner>Couldn't load projects ({loadError}). {data ? 'Showing the last loaded list; retrying automatically.' : 'Retrying automatically.'}</Banner>
      )}
      {banner && <Banner onDismiss={() => setBanner(null)}>{banner}</Banner>}

      {creating && (
        <SoftCard className="mb-4 px-4 py-4">
          <label className="block text-[13px] font-semibold">
            Project name
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="Name"
              aria-label="New project name"
              aria-invalid={!!nameError}
              className="mt-2 h-9 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[13px] font-normal outline-none"
            />
          </label>
          {nameError && <FieldError>{nameError}</FieldError>}
          <div className="mt-3 flex gap-2">
            <Btn kind="primary" disabled={saving} onClick={() => void create()}>{saving ? 'Saving…' : 'Create'}</Btn>
            <Btn kind="plain" onClick={() => { setCreating(false); setNameError(null) }}>Cancel</Btn>
          </div>
        </SoftCard>
      )}

      {data && rows.length === 0 && (
        <EmptyState
          title={filter === 1 ? 'No archived projects' : 'No projects yet'}
          body={filter === 1 ? 'Archive hides a project from the active list and leaves its tickets on the board.' : 'Name one with New project. Tickets can be attached from the Tasks board.'}
        />
      )}

      <div className="space-y-3">
        {rows.map((p) => {
          const who = lead(p, undefined, roster)
          const frac = p.ticketCount ? p.doneCount / p.ticketCount : 0
          const finished = p.ticketCount > 0 && p.doneCount === p.ticketCount
          const needs = /needs you|approval/i.test(p.name)
          return (
            <SoftCard key={p.id} className="group px-4 py-3">
              <div className="flex flex-wrap items-center gap-4">
                <Face agent={who} agents={roster} px={52} />
                <div className="min-w-[200px] flex-1">
                  {editingId === p.id ? (
                    <div>
                      <input
                        value={draft}
                        onChange={(e) => { setDraft(e.target.value); setDraftError(null) }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(p.id)
                          if (e.key === 'Escape') { setEditingId(null); setDraftError(null) }
                        }}
                        aria-label={`Rename ${p.name}`}
                        aria-invalid={!!draftError}
                        className="h-8 w-64 max-w-full rounded-lg bg-mc-ctl px-3 text-[14px] outline-none"
                      />
                      {draftError && <FieldError>{draftError}</FieldError>}
                    </div>
                  ) : (
                    <Link to={`/projects/${p.id}`} className="text-[16px] font-semibold">{p.name}</Link>
                  )}
                  <div className="mt-0.5 text-[13px] text-mc-sub">
                    {p.archivedAt ? 'Archived · tickets stay on the board' : 'Open the project to see its tasks'}
                  </div>
                </div>
                <div className="w-[240px] max-w-full">
                  <div className="flex justify-between text-[13px]">
                    <span className="font-semibold">{p.doneCount} of {p.ticketCount} done</span>
                    <span className="text-mc-sub">{p.ticketCount ? `${Math.round(frac * 100)}%` : '—'}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mc-track">
                    <div className="h-full rounded-full" style={{ width: `${Math.round(frac * 100)}%`, background: finished ? 'var(--mc-green)' : 'var(--mc-accent)' }} />
                  </div>
                </div>
                <div className="flex min-w-[140px] items-center justify-end gap-2">
                  {editingId === p.id ? (
                    <>
                      <Btn kind="primary" disabled={busyId === p.id} onClick={() => void rename(p.id)}>{busyId === p.id ? 'Saving…' : 'Save'}</Btn>
                      <Btn kind="plain" onClick={() => { setEditingId(null); setDraftError(null) }}>Cancel</Btn>
                    </>
                  ) : p.archivedAt ? (
                    <Btn kind="plain" disabled={busyId === p.id} onClick={() => void setArchived(p.id, false, p.name)}>Unarchive</Btn>
                  ) : (
                    <>
                      {needs && <StatusChip label="Needs you" tone="red" />}
                      <button type="button" className="text-[12px] font-semibold text-mc-sub" onClick={() => { setEditingId(p.id); setDraft(p.name); setDraftError(null) }}>Rename</button>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => void setArchived(p.id, true, p.name)}
                        className={`text-[12px] font-semibold text-mc-sub ${finished ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                      >
                        {busyId === p.id ? 'Saving…' : 'Archive'}
                      </button>
                      {!needs && <AgentName name={who.name} role={who.role} />}
                    </>
                  )}
                </div>
              </div>
            </SoftCard>
          )
        })}
      </div>

      {filter === 0 && archived.length > 0 && (
        <button type="button" onClick={() => setFilter(1)} className="mt-4 text-[13px] text-mc-sub">
          {archived.length} archived project{archived.length === 1 ? '' : 's'} <span className="font-semibold text-mc-accent">Show</span>
        </button>
      )}
      {loading && !data && <p className="text-[13px] text-mc-sub">Loading…</p>}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
