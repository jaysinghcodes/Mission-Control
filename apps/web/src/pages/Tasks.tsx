import { useEffect, useRef, useState } from 'react'
import { useApi, apiPost } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { Bot, Card, Chip, PillButton, Progress } from '../components/ui'
// Recognise runs that defaulted to the operator (API: OPERATOR_NAME / "Operator").
import { OPERATOR_ASSIGNEE } from '../config'

/**
 * Tasks — REAL runs with a visible stage trail. Every run shows its
 * queued → running → done timestamps (persisted by the API on each
 * transition), so even a 3-second task visibly moves through stages
 * (review fix #3). Socket events trigger an instant refetch, plus a flash
 * on the row whose stage just changed.
 */

interface Run { id: string; name: string; agent: string | null; status: string; progress: number; createdAt: string; startedAt: string | null; finishedAt: string | null }
interface RunsResp { runs: Run[] }

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  running: { bg: 'var(--mc-bluebg)', fg: 'var(--mc-bluetext)', label: 'RUNNING' },
  queued: { bg: 'var(--mc-orangebg)', fg: 'var(--mc-orangetext)', label: 'QUEUED' },
  done: { bg: 'var(--mc-greenbg)', fg: 'var(--mc-greentext)', label: 'DONE' },
  failed: { bg: 'var(--mc-redbg)', fg: 'var(--mc-redtext)', label: 'FAILED' },
  needs_approval: { bg: 'var(--mc-yellowbg)', fg: 'var(--mc-orangetext)', label: 'NEEDS APPROVAL' },
}

const STAGES = ['queued', 'running', 'done'] as const
const t = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString([], { hour12: false }) : '—')

export default function Tasks() {
  const { data, refetch } = useApi<RunsResp>('/runs', { pollMs: 10000 })
  const { events } = useLiveActivity()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const prevStatus = useRef<Record<string, string>>({})

  // Instant updates: any run.* event → refetch; flash the changed row.
  useEffect(() => {
    const runEvents = events.filter((e) => e.type.startsWith('run.'))
    if (runEvents.length === 0) return
    const changedId = runEvents[0].payload && typeof runEvents[0].payload === 'object' && 'id' in runEvents[0].payload
      ? String((runEvents[0].payload as { id: unknown }).id)
      : null
    if (changedId) {
      setFlashId(changedId)
      setTimeout(() => setFlashId(null), 1800)
    }
    void refetch()
  }, [events, refetch])

  // Flash rows whose status changed since last render.
  useEffect(() => {
    for (const run of data?.runs ?? []) {
      const prev = prevStatus.current[run.id]
      if (prev && prev !== run.status) {
        setFlashId(run.id)
        setTimeout(() => setFlashId(null), 1800)
      }
      prevStatus.current[run.id] = run.status
    }
  }, [data])

  async function create() {
    const name = title.trim()
    if (!name || busy) return
    setBusy(true)
    await apiPost('/runs', { name })
    setTitle('')
    setBusy(false)
    void refetch()
  }

  const groups: { title: string; statuses: string[] }[] = [
    { title: 'In Flight', statuses: ['running'] },
    { title: 'Queued', statuses: ['queued', 'needs_approval'] },
    { title: 'Done Today', statuses: ['done', 'failed'] },
  ]

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Tasks</div>
      <div className="mt-1 text-[13px] text-mc-sub">Real runs from OpenClaw — watch them move queued → running → done live.</div>

      <div className="flex items-center gap-3 mt-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
          placeholder="Queue a task… e.g. run the web tests"
          className="h-9 flex-1 max-w-md rounded-full border border-mc-border bg-mc-card px-4 text-[13px] text-mc-text placeholder:text-mc-faint outline-none focus:border-mc-primary"
        />
        <PillButton label="+ New task" on onClick={() => void create()} />
      </div>

      <div className="mt-8 space-y-8">
        {groups.map((group) => {
          const rows = (data?.runs ?? []).filter((r) => group.statuses.includes(r.status))
          return (
            <div key={group.title}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mc-faint mb-2.5">{group.title}</div>
              {rows.length === 0 ? (
                <Card className="px-4 py-6 text-[12.5px] text-mc-faint">
                  Nothing {group.title.toLowerCase()}. {group.title === 'Queued' ? 'Use the field above to queue a task for your agents.' : ''}
                </Card>
              ) : (
                <Card className="px-0 py-1">
                  {rows.map((row) => {
                    const chip = STATUS_CHIP[row.status] ?? STATUS_CHIP.queued
                    const stageIdx = STAGES.indexOf(row.status as (typeof STAGES)[number])
                    return (
                      <div
                        key={row.id}
                        className={`flex items-center gap-4 px-4 h-[52px] border-b border-mc-border2 last:border-0 transition-colors ${
                          flashId === row.id ? 'bg-mc-bluebg/40' : ''
                        }`}
                      >
                        <span className="text-[13px] font-medium w-[240px] truncate">{row.name}</span>
                        {/* Primary tint for runs owned by the operator (the API's default
                            assignee), blue for everything an agent picked up. Was a
                            hardcoded personal agent name — ticket 3. */}
                        <Bot color={row.agent === OPERATOR_ASSIGNEE ? 'var(--mc-primary)' : 'var(--mc-blue)'} scale={0.8} />
                        <span className="text-[12px] text-mc-sub w-[80px] truncate">{row.agent ?? '—'}</span>
                        <Chip label={chip.label} bg={chip.bg} fg={chip.fg} h={20} />
                        {row.status === 'running' ? (
                          <span className="flex items-center gap-2 w-[120px]">
                            <Progress pct={row.progress} color="var(--mc-blue)" w="w-[80px]" />
                            <span className="text-[11.5px] text-mc-sub">{row.progress}%</span>
                          </span>
                        ) : (
                          <span className="w-[120px]" />
                        )}
                        {/* Stage trail — proves the movement even when fast */}
                        <div className="flex items-center gap-1.5 font-mono text-[10px] text-mc-faint">
                          {STAGES.map((s, i) => {
                            const when = s === 'queued' ? row.createdAt : s === 'running' ? row.startedAt : row.finishedAt
                            const reached = stageIdx >= i
                            return (
                              <span key={s} className="flex items-center gap-1.5">
                                {i > 0 && <span className="text-mc-border">→</span>}
                                <span className={reached ? 'text-mc-bluetext' : ''}>
                                  {s} {reached ? t(when) : ''}
                                </span>
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </Card>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
