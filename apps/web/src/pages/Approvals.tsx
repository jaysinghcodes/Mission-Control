import { useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { Card, Inner, PillButton } from '../components/ui'

/**
 * Approvals — real pending approval requests (synced via approvals.snapshot).
 * - Tabs: All + PRs (exec/pairing/messages/sessions removed per owner review)
 * - PR rows expand to show details (repo, branch, GitHub link)
 * - Approving a PR merges it on GitHub automatically (API-side)
 */

interface Approval { id: string; kind: string; tag: string; desc: string; status: string; createdAt: string; meta?: { number?: number; url?: string; repo?: string; branch?: string | null; state?: string } | null }
interface ApprovalsResp { approvals: Approval[] }

const KIND_ICON: Record<string, { glyph: string; color: string }> = {
  pr: { glyph: '⎇', color: 'var(--mc-green)' },
  exec: { glyph: '›_', color: 'var(--mc-red)' },
  pair: { glyph: '⧉', color: 'var(--mc-blue)' },
  msg: { glyph: '✉', color: 'var(--mc-purple)' },
  sess: { glyph: '⑂', color: 'var(--mc-teal)' },
}

const FILTERS = ['All', 'PRs']

export default function Approvals() {
  const { data, refetch } = useApi<ApprovalsResp>('/approvals', { pollMs: 10000 })
  const [filter, setFilter] = useState('All')
  const [expanded, setExpanded] = useState<string | null>(null)
  const rows = (data?.approvals ?? []).filter((r) => filter === 'All' || (filter === 'PRs' && r.kind === 'pr'))

  async function decide(id: string, action: 'approve' | 'reject') {
    await apiPost(`/approvals/${id}/decide`, { action })
    void refetch()
  }

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Approvals</div>
      <div className="mt-1 text-[13px] text-mc-sub">Everything waiting on you — approve merges PRs on GitHub, reject declines.</div>

      <div className="flex gap-3 mt-6">
        {FILTERS.map((f) => (
          <PillButton key={f} label={f} on={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>

      <Card className="mt-6 rounded-2xl px-0 pb-1 overflow-hidden">
        {rows.length === 0 && (
          <div className="px-[18px] py-10 text-[12.5px] text-mc-faint">
            Nothing pending approval right now. PRs and agent requests land here live.
          </div>
        )}
        {rows.map((row, i) => {
          const icon = KIND_ICON[row.kind] ?? { glyph: '?', color: 'var(--mc-faint)' }
          const meta = row.meta
          const isOpen = expanded === row.id
          return (
            <div key={row.id}>
              <div className={`flex items-center px-[18px] py-4 ${i < rows.length - 1 || isOpen ? 'border-b border-mc-border2' : ''}`}>
                <button type="button" onClick={() => setExpanded(isOpen ? null : row.id)} className="flex items-center flex-1 min-w-0 text-left">
                  <Inner className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[13px] font-semibold mr-4 shrink-0">
                    <span style={{ color: icon.color }}>{icon.glyph}</span>
                  </Inner>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: icon.color }}>{row.tag}</div>
                    <div className="text-[13px] font-medium mt-0.5 truncate">{row.desc}</div>
                    {meta?.repo && (
                      <div className="text-[11px] text-mc-faint mt-0.5 font-mono truncate">{meta.repo}{meta.branch ? ` · ${meta.branch}` : ''}{meta.number ? ` · #${meta.number}` : ''}</div>
                    )}
                  </div>
                  <span className="text-[11px] text-mc-faint mr-4 whitespace-nowrap">{isOpen ? '▾' : '▸'}</span>
                </button>
                <PillButton label="Approve" on className="mr-2 shrink-0" style={{ backgroundColor: 'var(--mc-green)' }} onClick={() => void decide(row.id, 'approve')} />
                <PillButton label="Reject" className="shrink-0" onClick={() => void decide(row.id, 'reject')} />
              </div>
              {isOpen && (
                <div className="px-[18px] py-4 bg-mc-inner border-b border-mc-border2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Details</div>
                  <div className="mt-2 text-[12.5px] text-mc-text leading-relaxed">{row.desc}</div>
                  {meta && (
                    <div className="mt-3 space-y-1.5 text-[12px]">
                      {meta.repo && <div><span className="text-mc-faint">Repo: </span><span className="font-mono">{meta.repo}</span></div>}
                      {meta.number != null && <div><span className="text-mc-faint">PR: </span><span className="font-mono">#{meta.number}</span></div>}
                      {meta.branch && <div><span className="text-mc-faint">Branch: </span><span className="font-mono">{meta.branch}</span></div>}
                      {meta.url && (
                        <div>
                          <span className="text-mc-faint">GitHub: </span>
                          <a href={meta.url} target="_blank" rel="noreferrer" className="text-mc-bluetext hover:underline font-mono">{meta.url.replace('https://', '')}</a>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 text-[11.5px] text-mc-faint">Approving a PR merges it on GitHub and deletes its branch.</div>
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </div>
  )
}
