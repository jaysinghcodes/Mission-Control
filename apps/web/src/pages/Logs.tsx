import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { PillButton, SearchField } from '../components/ui'

/**
 * Logs. Real gateway log tail. The API reads the newest openclaw log
 * under the directory from OPENCLAW_LOG_DIR.
 * Auto refreshing, filterable by level and source text.
 */

interface LogLine { tm: string; lvl: string; msg: string }
/**
 * `available` and `reason` are additive. `available === false` means this
 * machine has no OpenClaw gateway log. `dir` is that directory from config.
 * A fresh clone is a normal state, not an error. Optional so an older API
 * (fields absent) keeps the previous rendering.
 */
interface LogsResp { logs: LogLine[]; available?: boolean; reason?: string | null; dir?: string | null }

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
    if (data) return
    const t = setTimeout(() => setWaitedOut(true), WAIT_LIMIT_MS)
    return () => clearTimeout(t)
  }, [data])
  // Can't show the log right now: never loaded and (failed or timed out).
  const unreachable = !data && (error || waitedOut)
  // Loaded once, but the latest refresh failed, so what is shown is stale.
  const stale = !!data && error
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('ALL')
  const [q, setQ] = useState('')

  // No log source on this box. Show the empty state instead of "no matching lines".
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
          // The directory comes from the API (`dir`), which reads OPENCLAW_LOG_DIR.
          <div className="pt-2">
            <div className="text-mc-sub font-semibold">No gateway log source</div>
            {data?.dir ? (
              <div className="mt-1 text-mc-faint">Looking in {data.dir}.</div>
            ) : null}
            <div className="mt-1 text-mc-faint">
              {data?.reason ?? 'OpenClaw is not running on this machine.'}
            </div>
            <div className="mt-1 text-mc-faint">Run the bridge after the gateway writes a log in that directory.</div>
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
            Showing the last loaded log. Refresh failed ({errorMessage}). Retrying every 10 s.
          </div>
        )}
        {!noSource && !unreachable && lines.length === 0 && (
          <div className="text-mc-faint pt-2">{data ? 'No matching log lines.' : 'No matching log lines. Waiting for the API…'}</div>
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
        {/* Only claim a live tail when a log is actually being tailed
            and the latest refresh worked. */}
        {!noSource && data && !error && <div className="mt-3 text-[12px] font-semibold text-mc-greentext">● LIVE TAIL, streaming…</div>}
      </div>
    </div>
  )
}
