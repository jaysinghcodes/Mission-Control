import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, PillButton, SectionLabel } from '../components/ui'
import { pluralize } from '../lib/pluralize'

/**
 * Usage and cost. Spend comes from usage.snapshot. This page does not
 * call a provider and it does not show an account balance.
 * /#/usage redirects to System. This file stays so an old import still builds.
 */

interface Provider {
  name?: string
  model?: string
  cost?: number
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

const RANGES = ['24h', '7d', '30d', 'month']

const fmt = (n: number | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : 'none')
function tokenWords(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'none'
  if (n === 1) return pluralize(1, 'token')
  return `${n.toLocaleString()} tokens`
}

export default function Usage() {
  const [range, setRange] = useState('24h')
  const { data, error } = useApi<UsageResp>(`/usage?period=${range}`, { pollMs: 30000 })
  const usage = data?.usage

  let providers: Provider[] = []
  if (Array.isArray(usage?.providers)) providers = usage.providers
  else if (usage?.providers && typeof usage.providers === 'object') providers = Object.values(usage.providers)

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Usage and cost</div>
      <div className="mt-1 text-[13px] text-mc-sub">Estimated spend from the bridge. Open System for the same numbers.</div>

      <div className="flex gap-3 mt-6 items-center">
        {RANGES.map((r) => (
          <PillButton key={r} label={r === 'month' ? 'This month' : r} on={range === r} onClick={() => setRange(r)} />
        ))}
      </div>

      <Card className="mt-6 px-4 py-4">
        <SectionLabel>Total estimated spend</SectionLabel>
        <div className="mt-2 text-[30px] font-semibold">{usage ? fmt(usage.totalCost) : 'none'}</div>
        <div className="text-[12px] text-mc-sub">
          {usage
            ? `${tokenWords(usage.tokensIn)} in, ${tokenWords(usage.tokensOut)} out`
            : error
              ? 'API unreachable'
              : 'No usage snapshot for this period yet.'}
        </div>
      </Card>

      <div className="flex gap-[18px] mt-6 flex-wrap">
        {providers.map((p, i) => (
          <Card key={p.name ?? `provider-${i}`} className="w-[248px] px-4 py-3">
            <div className="text-[14.5px] font-semibold">{p.name ?? 'Provider'}</div>
            <div className="mt-2 font-mono text-[12px] text-mc-sub">{p.model ?? 'none'}</div>
            <div className="mt-2 text-[24px] font-semibold">{fmt(p.cost)}</div>
            <div className="text-[11px] text-mc-sub">{p.detail ?? 'estimated spend'}</div>
            {typeof p.tokensIn === 'number' && (
              <div className="mt-2 text-[11px] text-mc-faint">{tokenWords(p.tokensIn)} in, {tokenWords(p.tokensOut)} out</div>
            )}
          </Card>
        ))}
        {providers.length === 0 && !error && (
          <Card className="w-full px-4 py-6 text-[12.5px] text-mc-faint">
            No provider spend yet. The bridge posts usage when it can read sessions.
          </Card>
        )}
      </div>
    </div>
  )
}
