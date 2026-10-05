import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { Card, Chip } from '../components/ui'
import type { Project, ProjectDetailResp, ProjectTicket } from '../types'

/**
 * One project — /#/projects/:id (ticket 4).
 *
 * Lists that project's tickets and how many are done ("1 of 2 done").
 * Zero tickets is a normal empty state, not an error: the API returns
 * `tickets: []` and `0 of 0`.
 *
 * Archived projects still open from a direct link. Archive does not
 * remove the tickets.
 */

const NOTICE_MS = 6000

const PRIO: Record<string, { bg: string; fg: string }> = {
  high: { bg: 'var(--mc-redbg)', fg: 'var(--mc-redtext)' },
  med: { bg: 'var(--mc-orangebg)', fg: 'var(--mc-orangetext)' },
  low: { bg: 'var(--mc-inner)', fg: 'var(--mc-sub)' },
}

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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showNotice(msg: string) {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  async function rename() {
    if (!project || busy) return
    setBusy(true)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${project.id}`, { name: draft })
    setBusy(false)
    if (!r.ok) {
      showNotice(r.error ?? 'Could not rename the project')
      return
    }
    setEditing(false)
    void refetch()
  }

  async function setArchived(archived: boolean) {
    if (!project || busy) return
    setBusy(true)
    const r = await apiSend<{ project: Project }>('PATCH', `/projects/${project.id}`, { archived })
    setBusy(false)
    if (!r.ok) {
      showNotice(r.error ?? 'Could not update the project')
      return
    }
    void refetch()
  }

  const progress = project ? `${project.doneCount} of ${project.ticketCount}` : ''

  return (
    <div className="p-6">
      <Link to="/projects" className="text-[12px] font-semibold text-mc-sub hover:text-mc-text">
        ← Projects
      </Link>

      {loadError && (
        <div role="alert" className="mt-4 rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
          Couldn't load this project ({loadError}).{' '}
          {data ? 'Showing the last loaded page; retrying automatically.' : 'Retrying automatically.'}
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

      {!project && !loadError && (
        <div className="mt-6 text-[13px] text-mc-faint">{loading ? 'Loading…' : 'Not loaded — see the notice above.'}</div>
      )}

      {project && (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {editing ? (
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  aria-label="Project name"
                  className="h-9 w-72 max-w-full rounded-full border border-mc-border bg-mc-card px-4 text-[15px] text-mc-text outline-none focus:border-mc-primary"
                />
              ) : (
                <h1 className="text-[22px] font-semibold">{project.name}</h1>
              )}
              <div className="mt-1 text-[13px] text-mc-sub">
                <span className="font-semibold text-mc-text">{progress}</span> done
                {project.archivedAt ? ' · Archived — hidden from the projects list. Tickets are still here.' : ''}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <button type="button" disabled={busy} onClick={() => void rename()} className="h-8 px-4 rounded-full bg-mc-primary text-white text-[12px] font-semibold disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="h-8 px-4 rounded-full bg-mc-inner text-mc-sub text-[12px] font-semibold">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setDraft(project.name); setEditing(true) }}
                    className="h-8 px-4 rounded-full bg-mc-inner text-mc-sub text-[12px] font-semibold hover:opacity-80"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setArchived(!project.archivedAt)}
                    className="h-8 px-4 rounded-full bg-mc-inner text-mc-sub text-[12px] font-semibold hover:opacity-80 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : project.archivedAt ? 'Unarchive' : 'Archive'}
                  </button>
                  <Link
                    to={`/tickets?project=${encodeURIComponent(project.id)}`}
                    className="h-8 px-4 rounded-full bg-mc-primary text-white text-[12px] font-semibold inline-flex items-center"
                  >
                    Open on board
                  </Link>
                </>
              )}
            </div>
          </div>

          {tickets.length === 0 ? (
            <Card className="mt-6 px-5 py-10">
              <div className="text-[15px] font-semibold">No tickets in this project yet.</div>
              <p className="mt-2 max-w-md text-[13px] text-mc-sub">
                Nothing is broken — this project has no tickets. Create one on the Tickets board while this project is selected, or assign an existing ticket from its card.
              </p>
              <Link
                to={`/tickets?project=${encodeURIComponent(project.id)}`}
                className="mt-4 inline-flex h-8 items-center rounded-full bg-mc-primary px-4 text-[12px] font-semibold text-white"
              >
                Go to the board
              </Link>
            </Card>
          ) : (
            <Card className="mt-6 rounded-2xl px-0 pb-2 overflow-hidden">
              <div className="flex px-[18px] pt-4 pb-2">
                {['TICKET', 'TITLE', 'STATUS', 'PRIORITY'].map((h) => (
                  <div key={h} className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint" style={{ width: h === 'TITLE' ? 360 : 140 }}>
                    {h}
                  </div>
                ))}
              </div>
              {tickets.map((row) => (
                <TicketLine key={row.id} row={row} />
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function TicketLine({ row }: { row: ProjectTicket }) {
  return (
    <div className="flex items-center px-[18px] min-h-14 py-2 border-t border-mc-border2">
      <div className="font-mono text-[11.5px] font-semibold text-mc-faint" style={{ width: 140 }}>{row.key ?? row.id.slice(0, 8)}</div>
      <div className="text-[13px] font-medium break-words pr-3" style={{ width: 360 }}>{row.title}</div>
      <div className="text-[12px] text-mc-sub" style={{ width: 140 }}>{STATUS_LABEL[row.status] ?? row.status}</div>
      <div style={{ width: 140 }}>
        <Chip label={row.priority.toUpperCase()} bg={PRIO[row.priority]?.bg ?? PRIO.med.bg} fg={PRIO[row.priority]?.fg ?? PRIO.med.fg} h={19} fs="text-[10px]" />
      </div>
    </div>
  )
}
