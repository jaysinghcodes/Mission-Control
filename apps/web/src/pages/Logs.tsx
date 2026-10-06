import { useEffect, useState } from 'react'
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

/**
 * How long "waiting for the API…" may show before it becomes an error
 * (QA-1 polish item 7). Before, a dead API meant waiting forever with no
 * explanation. 8 s ≈ a cold api start; the hook keeps retrying every poll.
 */
const WAIT_LIMIT_MS = 8000

export default function Logs() {
  const { data, error, errorMessage } = useApi<LogsResp>('/logs?lines=300', { pollMs: 10000 })
  // Item 7: flips true if the first load hasn't arrived within WAIT_LIMIT_MS.
  const [waitedOut, setWaitedOut] = useState(false)
  useEffect(() => {
    if (data) return // loaded — no timer needed (and none left running)
    const t = setTimeout(() => setWaitedOut(true), WAIT_LIMIT_MS)
    return () => clearTimeout(t)
  }, [data])
  // Can't show the log right now: never loaded and (failed or timed out).
  const unreachable = !data && (error || waitedOut)
  // Loaded once, but the latest refresh failed → what's shown is stale.
  const stale = !!data && error
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
          <PillButton key={l} label={l} on={level === l} className="min-w-[4.75rem] px-3" onClick={() => setLevel(l)} />
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
        {/* Item 7: "waiting" is time-boxed. After WAIT_LIMIT_MS (or a hard
            failure) say what went wrong, in the existing orange text used for
            WARN lines / notices; polling keeps retrying underneath. */}
        {unreachable && (
          <div className="text-mc-orangetext pt-2">
            Couldn't load the gateway log ({errorMessage ?? `no answer from the API after ${WAIT_LIMIT_MS / 1000} s`}). Retrying every 10 s.
          </div>
        )}
        {stale && (
          <div className="text-mc-orangetext pt-2 pb-2">
            Showing the last loaded log — refresh failed ({errorMessage}). Retrying every 10 s.
          </div>
        )}
        {!noSource && !unreachable && lines.length === 0 && (
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
        {/* Only claim a live tail when there is actually a log being tailed —
            and the latest refresh worked (item 7: no "streaming" over stale data). */}
        {!noSource && data && !error && <div className="mt-3 text-[12px] font-semibold text-mc-greentext">● LIVE TAIL — streaming…</div>}
      </div>
    </div>
  )
}
