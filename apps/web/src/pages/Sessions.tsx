import { useApi } from '../hooks/useApi'
import { Bot, Card, Progress } from '../components/ui'

/**
 * Sessions — real agent sessions from the API (synced via sessions.snapshot).
 */

interface Session { id: string; name: string; agent: string; model: string | null; ctx: number; lastActivity: string | null; hot: boolean }
interface SessionsResp { sessions: Session[] }

const COLS = [
  { label: 'SESSION', w: 230 },
  { label: 'AGENT', w: 130 },
  { label: 'MODEL', w: 160 },
  { label: 'CONTEXT', w: 140 },
  { label: 'LAST ACTIVITY', w: 120 },
]

function ctxColor(ctx: number): string {
  if (ctx > 80) return 'var(--mc-red)'
  if (ctx > 50) return 'var(--mc-orange)'
  return 'var(--mc-blue)'
}

export default function Sessions() {
  const { data, error } = useApi<SessionsResp>('/sessions', { pollMs: 20000 })
  const rows = data?.sessions ?? []

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Sessions</div>
      <div className="mt-1 text-[13px] text-mc-sub">Active agent sessions on this instance, context pressure, last activity.</div>

      <Card className="mt-6 rounded-2xl px-0 pb-2 overflow-hidden">
        <div className="flex px-[18px] pt-4 pb-2">
          {COLS.map((c) => (
            <div key={c.label} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint" style={{ width: c.w }}>
              {c.label}
            </div>
          ))}
        </div>
        {error && <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">API unreachable.</div>}
        {!error && rows.length === 0 && (
          <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">
            No sessions synced yet. The bridge pushes real sessions every few minutes.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center px-[18px] h-[68px] border-t border-mc-border2">
            <div className="text-[13px] font-medium truncate" style={{ width: COLS[0].w }}>{row.name}</div>
            <div className="flex items-center gap-2" style={{ width: COLS[1].w }}>
              {row.hot && <span className="w-[5px] h-[5px] rounded-full bg-mc-blue" />}
              <Bot color="var(--mc-primary)" scale={0.8} />
              <span className="text-[12px] font-medium truncate">{row.agent}</span>
            </div>
            <div className="font-mono text-[12px] text-mc-sub truncate" style={{ width: COLS[2].w }}>{row.model ?? 'none'}</div>
            <div className="flex items-center gap-2" style={{ width: COLS[3].w }}>
              <Progress pct={row.ctx} color={ctxColor(row.ctx)} w="w-[90px]" />
              <span className="text-[11.5px] text-mc-sub">{row.ctx}%</span>
            </div>
            <div className="text-[12px] text-mc-faint" style={{ width: COLS[4].w }}>{row.lastActivity ?? 'none'}</div>
          </div>
        ))}
      </Card>
    </div>
  )
}
