import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, Segmented, SoftCard, SearchInput, Face, StatusChip, EmptyState, Banner } from '../components/shell'
import { agentCaption } from '../data/roster'
import { API_URL } from '../lib/apiBase'
import { formatDocWhen } from '../lib/when'

/**
 * Docs — the ticket 13 cards grid, wired to GET /docs.
 * The API reads DOCS_ROOT. This page never reads disk and never sends a
 * filesystem path: each card opens by the server-issued id. Read-only.
 */

interface DocItem {
  id: string
  slug: string
  title: string
  preview: string
  type: 'Spec' | 'Brief' | 'Note'
  state: string | null
  author: string
  updatedAt: string
}

interface DocList {
  docs: DocItem[]
  total: number
}

interface DocDetail extends DocItem {
  html: string
}

function toneFor(type: string): 'blue' | 'orange' | 'green' {
  if (type === 'Brief') return 'orange'
  if (type === 'Note') return 'green'
  return 'blue'
}

export default function Docs() {
  const { data: roster } = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const agents = roster?.agents ?? []
  const { data, loading, errorMessage } = useApi<DocList>('/docs')
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [detailError, setDetailError] = useState(false)

  const docs = data?.docs ?? []
  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => docs.filter((doc) => {
    if (tab === 1 && doc.type !== 'Spec') return false
    if (tab === 2 && doc.type !== 'Brief') return false
    if (tab === 3 && doc.type !== 'Note') return false
    if (needle && !doc.title.toLowerCase().includes(needle)) return false
    return true
  }), [docs, tab, needle])

  const open = docs.find((doc) => doc.id === openId) ?? null

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      setDetailError(false)
      return
    }
    const ctrl = new AbortController()
    let live = true
    setDetailError(false)
    void (async () => {
      try {
        const res = await fetch(`${API_URL}/docs/${encodeURIComponent(openId)}`, { signal: ctrl.signal })
        if (!res.ok) {
          if (live) setDetailError(true)
          return
        }
        const json = (await res.json()) as { doc?: DocDetail }
        if (live && json.doc) setDetail(json.doc)
        else if (live) setDetailError(true)
      } catch {
        if (live && !ctrl.signal.aborted) setDetailError(true)
      }
    })()
    return () => {
      live = false
      ctrl.abort()
    }
  }, [openId])

  function author(name: string): Agent | { id: string; name: string; role: string | null; status: string } {
    const found = agents.find((a) => agentCaption(a.name, a.role).name === name || a.name === name)
    if (found) return found
    const cap = agentCaption(name, null)
    return { id: name, name: cap.name, role: cap.role, status: 'idle' }
  }

  const summary = !data
    ? (loading && !errorMessage ? 'Loading docs…' : 'Docs not loaded')
    : data.total === 0
      ? 'No docs yet'
      : `${data.total} ${data.total === 1 ? 'doc' : 'docs'}`

  const shown = detail && detail.id === openId ? detail : null
  const title = shown?.title ?? open?.title ?? ''

  return (
    <div>
      <PageHeader
        title="Docs"
        summary={summary}
        tools={
          <>
            <Segmented labels={['Recent', 'Specs', 'Briefs', 'Notes']} active={tab} onChange={setTab} ariaLabel="Doc types" />
            <SearchInput value={query} onChange={setQuery} placeholder="Search titles" label="Search docs by title" />
          </>
        }
      />

      {errorMessage && data && <Banner>{errorMessage}</Banner>}
      {!data && errorMessage && (
        <EmptyState title="Docs not loaded" body={errorMessage} />
      )}

      {openId && (
        <SoftCard className="mb-4 px-6 py-5">
          <button type="button" onClick={() => setOpenId(null)} className="text-[13px] font-semibold text-mc-accent-text">← All docs</button>
          <h2 className="mt-3 text-[24px] font-bold tracking-tight">{title}</h2>
          {shown && (shown.html ?? '').trim() ? (
            <div className="mc-doc mt-4 max-w-3xl" dangerouslySetInnerHTML={{ __html: shown.html }} />
          ) : detailError ? (
            <p className="mt-4 text-[15px] text-mc-sub">This doc could not be opened.</p>
          ) : shown ? (
            <p className="mt-4 text-[15px] text-mc-sub">This doc is empty.</p>
          ) : (
            <p className="mt-4 text-[15px] text-mc-sub">Loading…</p>
          )}
        </SoftCard>
      )}

      {!openId && data && data.total === 0 && (
        <EmptyState
          title="No docs yet"
          body="Specs, briefs, and notes show up here after the docs folder has files. This page does not read the disk."
        >
          <Link to="/connect" className="mt-3 inline-block text-[13px] font-semibold text-mc-accent-text">Setup</Link>
          <p className="mt-2 text-[13px] text-mc-sub">
            Or run <code className="font-mono text-mc-text">npm run seed:demo</code>
          </p>
        </EmptyState>
      )}

      {!openId && data && data.total > 0 && visible.length === 0 && (
        <EmptyState title="No docs match" body="Try another title, or switch the type filter back to Recent." />
      )}

      {!openId && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((doc) => {
            const who = author(doc.author)
            const tone = toneFor(doc.type)
            return (
              <button key={doc.id} type="button" onClick={() => setOpenId(doc.id)} className="mc-card px-4 py-4 text-left">
                <div className="h-36 rounded-[10px] bg-mc-inner p-4">
                  <div className="mx-auto mt-2 h-24 w-[70%] rounded bg-mc-card shadow-sm">
                    <div className="px-3 pt-3">
                      <div className="h-1.5 w-1/2 rounded-full" style={{ background: `var(--mc-${tone})` }} />
                      <div className="mt-2 space-y-1.5">
                        <div className="h-1 w-full rounded bg-mc-sep" />
                        <div className="h-1 w-4/5 rounded bg-mc-sep" />
                        <div className="h-1 w-3/5 rounded bg-mc-sep" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <StatusChip label={doc.type} tone={tone} />
                  {doc.state && <StatusChip label={doc.state} tone="gray" />}
                </div>
                <div className="mt-2 text-[15px] font-semibold">{doc.title}</div>
                <div className="mt-2 text-[12px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <Face agent={who} agents={agents} px={24} />
                    <div className="flex min-w-0 flex-1 items-baseline gap-1">
                      <span className="shrink-0 font-semibold text-mc-text">{agentCaption(who.name, who.role).name}</span>
                      <span className="min-w-0 truncate font-normal text-mc-sub">· {agentCaption(who.name, who.role).role}</span>
                    </div>
                  </div>
                  <div className="mt-0.5 text-right text-mc-sub">{formatDocWhen(doc.updatedAt)}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
