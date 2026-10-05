import { useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { PageHeader, Segmented, SoftCard, StatusChip, Btn, Face, Kicker, EmptyState } from '../components/shell'
import { agentCaption } from '../data/roster'
import type { Agent, AgentsResp } from '../types'

/**
 * Approvals — decide what agents are waiting on.
 * Pending is the default list. Decided is behind the segment (GET ?status=decided).
 */

interface Approval {
  id: string
  kind: string
  tag: string
  desc: string
  status: string
  createdAt: string
  meta?: { number?: number; url?: string; repo?: string; branch?: string | null; state?: string } | null
}
interface ApprovalsResp { approvals: Approval[] }

function guessAgent(row: Approval, roster: Agent[]): Agent | { id: string; name: string; role: string | null; status: string } {
  const blob = `${row.tag} ${row.desc}`.toLowerCase()
  const hit = roster.find((a) => {
    const cap = agentCaption(a.name, a.role)
    return blob.includes(a.name.toLowerCase()) || blob.includes(cap.name.toLowerCase())
  })
  if (hit) return hit
  return { id: row.id, name: row.tag || 'Agent', role: null, status: row.status === 'pending' ? 'blocked' : 'idle' }
}

export default function Approvals() {
  const [tab, setTab] = useState(0)
  const pendingQ = useApi<ApprovalsResp>('/approvals', { pollMs: 10000 })
  const decidedQ = useApi<ApprovalsResp>('/approvals?status=decided', { pollMs: 15000 })
  const rosterQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const roster = rosterQ.data?.agents ?? []
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const pending = pendingQ.data?.approvals ?? []
  const decided = decidedQ.data?.approvals ?? []
  const summary = pendingQ.data
    ? `${pending.length} waiting on you · ${decided.filter((d) => Date.now() - new Date(d.createdAt).getTime() < 86_400_000).length} decided today`
    : 'Loading approvals…'

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id)
    await apiPost(`/approvals/${id}/decide`, { action })
    setBusy(null)
    void pendingQ.refetch()
    void decidedQ.refetch()
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        summary={summary}
        tools={<Segmented labels={['Pending', 'Decided']} active={tab} onChange={setTab} ariaLabel="Approvals" />}
      />

      {tab === 0 && (
        <div className="mx-auto max-w-3xl">
          {pendingQ.data && pending.length === 0 && (
            <EmptyState title="Nothing is waiting on you" body="When an agent needs a decision, it shows up here. Approve merges a pull request on GitHub when that is what was asked." />
          )}
          {pending.length > 0 && <Kicker tone="red">Needs you</Kicker>}
          <div className="mt-3 space-y-8">
            {pending.map((row, i) => {
              const who = guessAgent(row, roster)
              const cap = agentCaption(who.name, who.role)
              const meta = row.meta
              return (
                <div key={row.id}>
                  {i === 1 && <div className="mb-3"><Kicker>Coming up</Kicker></div>}
                  <SoftCard className="px-5 py-5">
                    <div className="flex gap-4">
                      <span className="mt-1 w-1 self-stretch rounded-full bg-mc-red" aria-hidden />
                      <Face agent={{ ...who, status: 'blocked' }} agents={roster} px={64} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[20px] font-bold tracking-tight">{row.tag || row.desc}</div>
                        <p className="mt-1 text-[14px] text-mc-sub2">
                          <span className="font-semibold text-mc-text">{cap.name}</span>
                          <span className="text-mc-sub"> · {cap.role}</span>
                          {' '}{row.desc}
                        </p>
                        <p className="mt-1 text-[12.5px] text-mc-sub">
                          {row.kind} · asked {new Date(row.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-mc-sep pt-3">
                      <button type="button" onClick={() => setOpen(open === row.id ? null : row.id)} className="text-[13px] font-semibold text-mc-accent">
                        {open === row.id ? 'Hide details' : 'Show details'}
                      </button>
                      <div className="flex gap-2">
                        <Btn kind="plain" disabled={busy === row.id} onClick={() => void decide(row.id, 'reject')}>Deny</Btn>
                        <Btn kind="primary" disabled={busy === row.id} onClick={() => void decide(row.id, 'approve')}>Approve</Btn>
                      </div>
                    </div>
                    {open === row.id && (
                      <div className="mt-3 text-[13px] text-mc-sub2">
                        <div>{row.desc}</div>
                        {meta?.repo && <div className="mt-1 font-mono text-[12px]">Repo {meta.repo}{meta.branch ? ` · ${meta.branch}` : ''}{meta.number ? ` · #${meta.number}` : ''}</div>}
                        {meta?.url && <a className="mt-1 block text-mc-accent" href={meta.url} target="_blank" rel="noreferrer">{meta.url}</a>}
                        {row.kind === 'pr' && <p className="mt-2 text-[12px] text-mc-sub">Approving a pull request merges it on GitHub.</p>}
                      </div>
                    )}
                  </SoftCard>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 1 && (
        <div className="mx-auto max-w-3xl">
          <Kicker>Decided</Kicker>
          {decided.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="No decisions yet" body="Approved and declined requests stay here. A fresh database has none until you decide one, or until seed:demo inserts a sample." />
            </div>
          ) : (
            <SoftCard className="mt-3 divide-y divide-mc-sep">
              {decided.map((row) => {
                const ok = row.status === 'approved'
                const who = guessAgent(row, roster)
                return (
                  <div key={row.id} className="flex items-center gap-3 px-4 py-3">
                    <Face agent={who} agents={roster} px={36} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">{row.tag || row.desc}</div>
                      <div className="truncate text-[12.5px] text-mc-sub">{row.desc}</div>
                    </div>
                    <StatusChip label={ok ? 'Approved' : 'Declined'} tone={ok ? 'green' : 'gray'} />
                    <span className="whitespace-nowrap text-[12px] text-mc-sub">{new Date(row.createdAt).toLocaleDateString()}</span>
                  </div>
                )
              })}
            </SoftCard>
          )}
        </div>
      )}
    </div>
  )
}
