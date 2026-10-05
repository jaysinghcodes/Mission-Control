import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { PillButton, SearchField } from '../components/ui'

/**
 * Logs — REAL gateway log tail (the API reads /tmp/openclaw/*.log),
 * auto-refreshing, filterable by level and source text.
 */

interface LogLine { tm: string; lvl: string; msg: string }
/**
 * `available` / `reason` are additive API fields (ticket 2). `available === false`
 * means this machine has no OpenClaw gateway log (/tmp/openclaw missing — e.g.
 * a fresh clone, docker, or demo-seed install), which is a normal state, not an
 * error. Optional so an older API (fields absent) keeps the previous rendering.
 */
interface LogsResp { logs: LogLine[]; available?: boolean; reason?: string | null }

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR'] as const

export default function Logs() {
  const { data } = useApi<LogsResp>('/logs?lines=300', { pollMs: 10000 })
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('ALL')
  const [q, setQ] = useState('')

  // No log source on this box → clean empty state instead of "no matching lines".
  const noSource = data?.available === false

  const lines = (data?.logs ?? []).filter(
    (l) => (level === 'ALL' || l.lvl === level) && (q === '' || l.msg.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[22px] font-semibold">Gateway Logs</div>
          <div className="mt-1 text-[13px] text-mc-sub">Live tail of the real OpenClaw gateway log, auto-refreshing.</div>
        </div>
        <div className="flex items-center gap-2">
          <PillButton label="Export" />
          <PillButton label="❚❚  Pause" />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6">
        {LEVELS.map((l) => (
          <PillButton key={l} label={l} on={level === l} className="w-[60px] px-0" onClick={() => setLevel(l)} />
        ))}
        <SearchField w={300} h={30} placeholder="Filter by source…" value={q} onChange={setQ} />
      </div>

      <div className="mt-4 h-[470px] rounded-2xl border border-mc-border bg-mc-inner p-4 font-mono text-[12px] overflow-y-auto">
        {noSource && (
          // Empty state for machines without OpenClaw. The API supplies the
          // exact reason (missing dir / no files / unreadable) — shown verbatim.
          <div className="pt-2">
            <div className="text-mc-sub font-semibold">No gateway log source</div>
            <div className="mt-1 text-mc-faint">
              {data?.reason ?? 'OpenClaw is not running on this machine.'}
            </div>
            <div className="mt-1 text-mc-faint">See bridge/README.md to connect an OpenClaw instance.</div>
          </div>
        )}
        {!noSource && lines.length === 0 && (
          <div className="text-mc-faint pt-2">No matching log lines{data ? '' : ' — waiting for the API…'}.</div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="flex whitespace-pre py-[3px]">
            <span className="text-mc-faint w-[80px] shrink-0">{l.tm}</span>
            <span
              className="w-[52px] shrink-0 font-semibold"
              style={{ color: l.lvl === 'ERROR' ? 'var(--mc-redtext)' : l.lvl === 'WARN' ? 'var(--mc-orangetext)' : 'var(--mc-bluetext)' }}
            >
              {l.lvl}
            </span>
            <span className="text-mc-text">{l.msg}</span>
          </div>
        ))}
        {/* Only claim a live tail when there is actually a log being tailed. */}
        {!noSource && <div className="mt-3 text-[12px] font-semibold text-mc-greentext">● LIVE TAIL — streaming…</div>}
      </div>
    </div>
  )
}
