import { useState } from 'react'
import { useApi, apiPost, apiSend } from '../hooks/useApi'
import { Card, Chip, PillButton, Progress, SectionLabel } from '../components/ui'

/**
 * Usage & Cost — real usage snapshot pushed by the bridge (usage.snapshot)
 * plus user-configured models (ModelConfig) added with the "+" button.
 *
 * Provider entries are intentionally shape-tolerant: the bridge may push
 * {name, balance} (account balance), {name, model, cost, pct, detail}
 * (estimated spend) or {name, tokensIn, tokensOut} (token usage). Any
 * missing field renders as "—" — a provider row must NEVER crash the page.
 */

interface Provider {
  name?: string
  model?: string
  balance?: number
  cost?: number
  pct?: number
  detail?: string
  tokensIn?: number
  tokensOut?: number
}

interface Usage {
  period: string
  totalCost: number
  tokensIn: number
  tokensOut: number
  providers: Provider[] | Record<string, Provider> | null
}
interface UsageResp { usage: Usage | null }

interface ModelConfig { id: string; provider: string; model: string; label: string | null; createdAt: string }
interface ModelsResp { models?: ModelConfig[] }

const RANGES = ['24h', '7d', '30d', 'month']

const fmt = (n: number | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—')
const num = (n: number | undefined): string => (typeof n === 'number' ? n.toLocaleString() : '—')

export default function Usage() {
  const [range, setRange] = useState('24h')
  const { data, error } = useApi<UsageResp>(`/usage?period=${range}`, { pollMs: 30000 })
  const usage = data?.usage
  const models = useApi<ModelsResp>('/models', { pollMs: 30000 })
  const [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('')
  const [label, setLabel] = useState('')
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Normalize providers: array or object → array; tolerate anything missing.
  let providers: Provider[] = []
  if (Array.isArray(usage?.providers)) providers = usage.providers
  else if (usage?.providers && typeof usage.providers === 'object') providers = Object.values(usage.providers)

  const configured = models.data?.models ?? []

  async function addModel() {
    const res = await apiPost<ModelConfig>('/models', { provider, model, label })
    if (res) {
      setAdding(false)
      setModel('')
      setLabel('')
      setSaveMsg(null)
      models.refetch()
    } else {
      setSaveMsg('Could not save — provider and model id are required.')
    }
  }

  async function removeModel(id: string) {
    const res = await apiSend('DELETE', `/models/${id}`)
    if (res.ok) models.refetch()
  }

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Usage &amp; Cost</div>
      <div className="mt-1 text-[13px] text-mc-sub">Token spend per provider and model — real numbers from this instance.</div>

      <div className="flex gap-3 mt-6 items-center">
        {RANGES.map((r) => (
          <PillButton key={r} label={r === 'month' ? 'This month' : r} on={range === r} onClick={() => setRange(r)} />
        ))}
        <div className="flex-1" />
        <PillButton label="+ Add model" on onClick={() => setAdding(true)} />
      </div>

      {/* Add-model modal (review fix: user-configurable models, full flow) */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAdding(false)}>
          <Card className="w-[420px] px-6 py-5" rx="rounded-2xl" >
            <div onClick={(e) => e.stopPropagation()}>
              <SectionLabel>Add model to track</SectionLabel>
              <div className="mt-1 text-[12.5px] text-mc-sub">The bridge will fetch a live balance/usage for this model.</div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint mb-1">Provider</div>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full h-9 rounded-lg border border-mc-border bg-mc-inner px-3 text-[13px] text-mc-text outline-none"
                  >
                    <option value="deepseek">deepseek</option>
                    <option value="zai">zai (GLM)</option>
                    <option value="other">other</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint mb-1">Model id</div>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="deepseek-v4-flash · glm-5.2 · …"
                    className="w-full h-9 rounded-lg border border-mc-border bg-mc-inner px-3 text-[13px] text-mc-text outline-none placeholder:text-mc-faint"
                  />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint mb-1">Label (optional)</div>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="My GLM model"
                    className="w-full h-9 rounded-lg border border-mc-border bg-mc-inner px-3 text-[13px] text-mc-text outline-none placeholder:text-mc-faint"
                  />
                </div>
              </div>
              {saveMsg && <div className="mt-3 text-[12px] text-mc-redtext">{saveMsg}</div>}
              <div className="flex justify-end gap-2 mt-5">
                <PillButton label="Cancel" onClick={() => setAdding(false)} />
                <PillButton label="Save model" on onClick={() => void addModel()} />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Configured models (from the + flow) */}
      {configured.length > 0 && (
        <Card className="mt-6 px-4 py-4">
          <SectionLabel>Configured Models</SectionLabel>
          <div className="mt-3 flex flex-col gap-2">
            {configured.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg bg-mc-inner px-3 py-2.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--mc-blue)' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{m.label ?? m.model}</div>
                  <div className="text-[11px] text-mc-sub font-mono truncate">{m.provider} / {m.model}</div>
                </div>
                <PillButton label="Remove" onClick={() => void removeModel(m.id)} />
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-mc-faint">Balances for configured models stream in via the bridge — check Health for live provider balances.</div>
        </Card>
      )}

      <Card className="mt-6 px-4 py-4">
        <SectionLabel>Total Estimated Spend</SectionLabel>
        <div className="mt-2 text-[30px] font-semibold">{usage ? fmt(usage.totalCost) : '—'}</div>
        <div className="text-[12px] text-mc-sub">
          {usage
            ? `${num(usage.tokensIn)} tokens in · ${num(usage.tokensOut)} tokens out`
            : error
              ? 'API unreachable'
              : 'No usage snapshot for this period yet — the bridge syncs every few minutes.'}
        </div>
        <Chip label="PEAK WINDOW 01:00–07:00 CT" bg="var(--mc-orangebg)" fg="var(--mc-orangetext)" h={24} fs="text-[10.5px]" className="mt-3" />
      </Card>

      <div className="flex gap-[18px] mt-6 flex-wrap">
        {providers.map((p, i) => {
          const unfetchable = p.balance == null && p.cost == null
          const cfg = configured.find((c) => c.provider === p.name?.toLowerCase() || c.model === p.model)
          return (
            <Card key={p.name ?? `provider-${i}`} className="w-[248px] px-4 py-3 relative">
              {cfg && (
                <button
                  type="button"
                  title="Delete model config"
                  onClick={() => void removeModel(cfg.id)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-mc-inner border border-mc-border flex items-center justify-center text-[11px] text-mc-redtext hover:bg-mc-redbg"
                >
                  🗑
                </button>
              )}
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'var(--mc-blue)' }} />
                <span className="text-[14.5px] font-semibold">{p.name ?? 'Provider'}</span>
              </div>
              <div className="mt-2 font-mono text-[12px] text-mc-sub">{p.model ?? '—'}</div>
              {unfetchable ? (
                <div className="mt-2 rounded-lg bg-mc-orangebg px-2.5 py-1.5 text-[11px] font-semibold text-mc-orangetext inline-block">
                  Unable to fetch
                </div>
              ) : (
                <div className="mt-2 text-[24px] font-semibold">{p.balance != null ? fmt(p.balance) : fmt(p.cost)}</div>
              )}
              <div className="text-[11px] text-mc-sub">{p.balance != null ? 'account balance' : (unfetchable ? (p.detail ?? 'no data source') : p.detail ?? '—')}</div>
              {typeof p.pct === 'number' && !unfetchable && (
                <div className="flex items-center gap-2 mt-3">
                  <Progress pct={p.pct} color="var(--mc-blue)" w="flex-1" />
                  <span className="text-[10.5px] text-mc-faint">{p.pct}%</span>
                </div>
              )}
              {typeof p.tokensIn === 'number' && !unfetchable && (
                <div className="mt-2 text-[11px] text-mc-faint">{num(p.tokensIn)} in · {num(p.tokensOut)} out</div>
              )}
            </Card>
          )
        })}
        {providers.length === 0 && !error && (
          <Card className="w-full px-4 py-6 text-[12.5px] text-mc-faint">
            No provider breakdown yet — the bridge pushes balances/tokens every few minutes. Want exact billing? Add your
            provider API keys (DeepSeek / Z.AI platform keys) and I'll wire live cost queries.
          </Card>
        )}
      </div>

      <p className="mt-6 text-[12.5px] text-mc-sub">
        Peak-pricing alert: DeepSeek charges 2× during 01:00–07:00 CT — cron alerts are already wired.
      </p>
    </div>
  )
}
