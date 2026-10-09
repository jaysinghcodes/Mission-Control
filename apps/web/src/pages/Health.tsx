import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, Chip, Progress, SectionLabel } from '../components/ui'

/**
 * Health — ONLY live, tangible data. Real OS metrics from GET /system
 * (measured on the OpenClaw host), real API state from GET /health, and the
 * provider balance from /usage. No hardcoded wireframe values (review fix #5).
 * The OS shown is the host's; SSH setup steps adapt to YOUR machine below.
 */

interface SystemResp {
  cpu: { cores: number; model: string; load1: number; pct: number }
  memory: { totalGb: number; freeGb: number; pct: number }
  disk: { usedGb: number; totalGb: number; pct: number }
  os: { platform: string; release: string; arch: string; hostname: string; node: string }
  uptimeSeconds: number
  apiUptimeSeconds: number
}
interface HealthResp { status: string; uptimeSeconds: number; connectedClients: number; database: string }
interface UsageResp { usage: { providers: { name?: string; balance?: number; cost?: number; pct?: number; model?: string; detail?: string }[] | Record<string, { name?: string; balance?: number; cost?: number; pct?: number; model?: string; detail?: string }> | null } | null }

const fmtUptime = (s: number): string => `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`

function clientOS(): string {
  const p = navigator.platform.toLowerCase()
  if (p.includes('win')) return 'windows'
  if (p.includes('mac')) return 'mac'
  if (p.includes('linux')) return 'linux'
  return 'other'
}

const SSH_STEPS: Record<string, string> = {
  mac: 'Open Terminal, then run:\nssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
  linux: 'Open a terminal, then run:\nssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
  windows: 'Open PowerShell (built-in OpenSSH), then run:\nssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
  other: 'Open a terminal, then run:\nssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
}

export default function Health() {
  const sys = useApi<SystemResp>('/system', { pollMs: 10000 })
  const health = useApi<HealthResp>('/health', { pollMs: 10000 })
  const usage = useApi<UsageResp>('/usage?period=24h', { pollMs: 30000 })
  const [client, setClient] = useState('other')
  useEffect(() => setClient(clientOS()), [])

  const s = sys.data
  const h = health.data
  const providers = Array.isArray(usage.data?.usage?.providers)
    ? usage.data!.usage!.providers
    : usage.data?.usage?.providers
      ? Object.values(usage.data.usage.providers)
      : []

  const metrics = [
    { label: 'CPU', big: s ? `${s.cpu.pct}%` : '—', pct: s?.cpu.pct ?? 0, color: s && s.cpu.pct > 80 ? 'var(--mc-red)' : 'var(--mc-green)', sub: s ? `load ${s.cpu.load1} · ${s.cpu.cores} core(s)` : 'loading…' },
    { label: 'Memory', big: s ? `${s.memory.pct}%` : '—', pct: s?.memory.pct ?? 0, color: s && s.memory.pct > 80 ? 'var(--mc-red)' : 'var(--mc-green)', sub: s ? `${s.memory.totalGb - s.memory.freeGb} / ${s.memory.totalGb} GB` : 'loading…' },
    { label: 'Disk', big: s ? `${s.disk.pct}%` : '—', pct: s?.disk.pct ?? 0, color: s && s.disk.pct > 80 ? 'var(--mc-red)' : 'var(--mc-green)', sub: s ? `${s.disk.usedGb} / ${s.disk.totalGb} GB` : 'loading…' },
  ]

  // Provider balances — one card PER provider (DeepSeek + GLM + any added
  // models), each with its own live balance. Never just the first one.
  const providerCards = providers.map((p) => {
    const unfetchable = p.balance == null && p.cost == null
    return {
      name: p.name ?? 'provider',
      balance: !unfetchable && p.balance != null ? `$${Number(p.balance).toFixed(2)}` : !unfetchable && p.cost != null ? `$${Number(p.cost).toFixed(4)}` : null,
      unfetchable,
      pct: typeof p.pct === 'number' ? p.pct : !unfetchable && p.balance != null ? 100 : 0,
      sub: p.balance != null ? (p.model ?? p.detail ?? p.name) : (p.detail ?? p.model ?? p.name),
      model: p.model ?? null,
    }
  })

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">System Health</div>
      <div className="mt-1 text-[13px] text-mc-sub">Live vitals from the machine running your OpenClaw instance — nothing hardcoded.</div>

      {/* Gateway/API banner — real */}
      <Card className="mt-6 px-5 py-4 flex items-center gap-4">
        <span className="w-[20px] h-[20px] rounded-full" style={{ backgroundColor: h ? (h.status === 'ok' ? 'var(--mc-green)' : 'var(--mc-red)') : 'var(--mc-faint)' }} />
        <div className="flex-1">
          <div className="text-[18px] font-semibold">
            {h ? `API ${h.status === 'ok' ? 'Running' : 'Degraded'}` : 'Contacting API…'}
          </div>
          <div className="text-[12.5px] text-mc-sub">
            {h
              ? `uptime ${fmtUptime(h.uptimeSeconds)} · database ${h.database} · ${h.connectedClients} dashboard client(s)`
              : 'probe failed — check your SSH tunnel'}
          </div>
        </div>
        <Chip label={`HOST · ${s?.os.platform ?? '?'} ${s?.os.arch ?? ''}`} bg="var(--mc-inner)" fg="var(--mc-sub)" h={24} fs="text-[11px]" />
        <Chip label={h?.database === 'connected' ? 'DB · OK' : 'DB · DOWN'} bg={h?.database === 'connected' ? 'var(--mc-greenbg)' : 'var(--mc-redbg)'} fg={h?.database === 'connected' ? 'var(--mc-greentext)' : 'var(--mc-redtext)'} h={24} fs="text-[11px]" />
      </Card>

      {/* Real metric cards — CPU / Memory / Disk */}
      <div className="flex gap-[10px] mt-5 flex-wrap">
        {metrics.map((m) => (
          <Card key={m.label} className="w-[148px] px-3 py-2.5">
            <SectionLabel>{m.label}</SectionLabel>
            <div className="mt-2 text-[22px] font-semibold">{m.big}</div>
            <Progress pct={m.pct} color={m.color} className="mt-2" />
            <div className="mt-2 text-[10.5px] text-mc-sub truncate">{m.sub}</div>
          </Card>
        ))}
      </div>

      {/* Provider balances — one card per provider (DeepSeek + GLM + added models) */}
      <div className="mt-6">
        <SectionLabel>Provider Balances</SectionLabel>
        <div className="flex gap-[10px] mt-3 flex-wrap">
          {providerCards.length === 0 && (
            <Card className="w-full px-4 py-4 text-[12px] text-mc-faint">
              No balance data yet — the bridge syncs every few minutes.
            </Card>
          )}
          {providerCards.map((p) => (
            <Card key={p.name} className="w-[190px] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="w-[10px] h-[10px] rounded-full" style={{ backgroundColor: 'var(--mc-blue)' }} />
                <span className="text-[12.5px] font-semibold capitalize">{p.name}</span>
              </div>
              {p.unfetchable ? (
                <div className="mt-2 rounded-lg bg-mc-orangebg px-2.5 py-1.5 text-[11px] font-semibold text-mc-orangetext inline-block">
                  Unable to fetch
                </div>
              ) : (
                <div className="mt-2 text-[22px] font-semibold font-mono">{p.balance}</div>
              )}
              <Progress pct={p.pct} color="var(--mc-blue)" className="mt-2" />
              <div className="mt-2 text-[10.5px] text-mc-sub truncate" title={p.sub}>{p.model ?? p.sub}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Host details — real */}
      <Card className="mt-6 px-4 py-4">
        <SectionLabel>Host</SectionLabel>
        <div className="mt-3">
          {[
            { k: 'Hostname', v: s?.os.hostname ?? '—' },
            { k: 'OS', v: s ? `${s.os.platform} ${s.os.release} (${s.os.arch})` : '—' },
            { k: 'Node', v: s?.os.node ?? '—' },
            { k: 'Host uptime', v: s ? fmtUptime(s.uptimeSeconds) : '—' },
            { k: 'CPU', v: s?.cpu.model ?? '—' },
          ].map((r) => (
            <div key={r.k} className="flex py-[6px] text-[12.5px]">
              <span className="w-[150px] text-mc-sub">{r.k}</span>
              <span className="font-medium text-mc-text">{r.v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Access — real + per-OS steps */}
      <Card className="mt-6 px-4 py-4">
        <SectionLabel>Access · Your Machine ({client})</SectionLabel>
        <pre className="mt-3 whitespace-pre-wrap font-mono text-[12px] text-mc-sub bg-mc-inner rounded-lg p-3">{SSH_STEPS[client]}</pre>
        <p className="mt-3 text-[12px] text-mc-faint">
          Mission Control binds to loopback only. Vite listens on 127.0.0.1:5173 and the API listens on 127.0.0.1:3000. The SSH tunnel forwards those ports to your machine. Keep the session open while you browse.
        </p>
      </Card>
    </div>
  )
}
