import { useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, SoftCard, Face, AgentName, StatusChip, EmptyState, Btn } from '../components/shell'
import { agentCaption } from '../data/roster'

/**
 * Docs — specs, briefs and notes. There is no docs table. When the demo
 * roster is present, sample cards (the locked mock set) explain the product.
 * Otherwise the page is an intentional empty state. "New doc" drafts locally
 * in this browser only.
 */

interface Doc {
  id: string
  title: string
  type: 'Spec' | 'Brief' | 'Note'
  tone: 'blue' | 'orange' | 'green'
  author: string
  when: string
  state?: string
  body: string
}

const SAMPLES: Doc[] = [
  { id: 'd1', title: 'Ticket 13 · App-wide redesign', type: 'Spec', tone: 'blue', author: 'Atlas', when: 'Today', body: 'One purpose per page. Summary under the title. Details behind a click. Red only when something needs you.' },
  { id: 'd2', title: 'Morning Brief · today', type: 'Brief', tone: 'orange', author: 'Speedy', when: 'Today', body: 'What is moving, what is waiting, and what shipped.' },
  { id: 'd3', title: 'Release notes', type: 'Note', tone: 'green', author: 'Quill', when: 'Today', state: 'Draft', body: 'Draft notes for the next cut. Not published.' },
  { id: 'd4', title: 'Security review: deploy script', type: 'Spec', tone: 'blue', author: 'Aegis', when: 'Yesterday', state: 'In review', body: 'Deploys wait for approval. The script does not run unattended.' },
  { id: 'd5', title: 'Projects', type: 'Spec', tone: 'blue', author: 'Atlas', when: 'Yesterday', body: 'A ticket sits in one project or in none. Archive hides the project and keeps the tickets.' },
  { id: 'd6', title: 'QA checklist', type: 'Note', tone: 'green', author: 'Sentinel', when: 'Yesterday', body: 'Fresh clone, seed:demo, both themes, and the project name errors.' },
  { id: 'd7', title: 'Bridge setup guide', type: 'Note', tone: 'green', author: 'Bolt', when: 'This week', body: 'python3 bridge/mc-bridge-sync.py posts agents, sessions, usage and approvals.' },
  { id: 'd8', title: 'Onboarding: clone to running', type: 'Note', tone: 'green', author: 'Quill', when: 'This week', body: 'The eight ONBOARDING.md steps, including skip-with-seed.' },
]

const KEY = 'mc-local-docs'

function loadLocal(): Doc[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Doc[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default function Docs() {
  const { data } = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const agents = data?.agents ?? []
  const demo = agents.some((a) => ['Speedy', 'Forge', 'Aegis', 'Quill'].includes(agentCaption(a.name, a.role).name))
  const [tab, setTab] = useState(0)
  const [local, setLocal] = useState<Doc[]>(loadLocal)
  const [open, setOpen] = useState<Doc | null>(null)
  const [draft, setDraft] = useState('')

  const docs = useMemo(() => {
    const base = demo ? SAMPLES : []
    return [...local, ...base]
  }, [demo, local])

  const types = ['Recent', 'Specs', 'Briefs', 'Notes'] as const
  const visible = docs.filter((d) => {
    if (tab === 1) return d.type === 'Spec'
    if (tab === 2) return d.type === 'Brief'
    if (tab === 3) return d.type === 'Note'
    return true
  })

  function author(name: string): Agent | { id: string; name: string; role: string | null; status: string } {
    return agents.find((a) => agentCaption(a.name, a.role).name === name || a.name === name)
      ?? { id: name, name, role: null, status: 'idle' }
  }

  function add() {
    const title = draft.trim()
    if (!title) return
    const doc: Doc = { id: `local-${Date.now()}`, title, type: 'Note', tone: 'green', author: 'You', when: 'Just now', state: 'Draft', body: 'Local draft on this browser. It is not synced.' }
    const next = [doc, ...local]
    setLocal(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
    setDraft('')
    setOpen(doc)
  }

  return (
    <div>
      <PageHeader
        title="Docs"
        summary={docs.length ? `${docs.length} docs` : 'No docs yet'}
        tools={
          <>
            <Segmented labels={[...types]} active={tab} onChange={setTab} ariaLabel="Doc types" />
            <Btn kind="primary" onClick={() => setOpen({ id: 'new', title: '', type: 'Note', tone: 'green', author: 'You', when: 'Now', body: '' })}>New doc</Btn>
          </>
        }
      />

      {open?.id === 'new' && (
        <SoftCard className="mb-4 px-4 py-4">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Title" aria-label="New doc title" className="h-9 w-full max-w-md rounded-lg bg-mc-ctl px-3 text-[14px] outline-none" />
          <div className="mt-3 flex gap-2">
            <Btn kind="primary" onClick={add}>Save on this browser</Btn>
            <Btn kind="plain" onClick={() => setOpen(null)}>Cancel</Btn>
          </div>
        </SoftCard>
      )}

      {open && open.id !== 'new' && (
        <SoftCard className="mb-4 px-6 py-5">
          <button type="button" onClick={() => setOpen(null)} className="text-[13px] font-semibold text-mc-accent">← All docs</button>
          <h2 className="mt-3 text-[24px] font-bold tracking-tight">{open.title}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed">{open.body}</p>
        </SoftCard>
      )}

      {!open && visible.length === 0 && (
        <EmptyState
          title="No docs yet"
          body="Specs and notes land here. After seed:demo you will see sample cards. New doc saves only in this browser — there is no docs database."
        />
      )}

      {!open && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((doc) => {
            const who = author(doc.author)
            return (
              <button key={doc.id} type="button" onClick={() => setOpen(doc)} className="mc-card px-4 py-4 text-left">
                <div className="h-36 rounded-[10px] bg-mc-inner p-4">
                  <div className="mx-auto mt-2 h-24 w-[70%] rounded bg-mc-card shadow-sm">
                    <div className="px-3 pt-3">
                      <div className="h-1.5 w-1/2 rounded-full" style={{ background: `var(--mc-${doc.tone})` }} />
                      <div className="mt-2 space-y-1.5">
                        <div className="h-1 w-full rounded bg-mc-sep" />
                        <div className="h-1 w-4/5 rounded bg-mc-sep" />
                        <div className="h-1 w-3/5 rounded bg-mc-sep" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <StatusChip label={doc.type} tone={doc.tone} />
                  {doc.state && <StatusChip label={doc.state} tone="gray" />}
                </div>
                <div className="mt-2 text-[15px] font-semibold">{doc.title}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Face agent={who} agents={agents} px={24} />
                  <AgentName name={who.name} role={who.role} />
                  <span className="text-[12px] text-mc-sub">· {doc.when}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
