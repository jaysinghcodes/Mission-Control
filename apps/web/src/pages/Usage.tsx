import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { EmptyState, PageHeader, Segmented, SoftCard } from '../components/shell'

/**
 * Cost so far. GET /usage prices tokens from config/prices.json.
 * A provider costUsd wins. Local providers are $0. Unknown models say
 * "Price not set". The page does not read a live balance.
 */

interface UsageGroup {
  day: string
  bot: string
  model: string
  provider?: string
  tokensIn: number
  tokensOut: number
  cost: number | null
  priceLabel: string | null
}

interface Usage {
  period: string
  totalCost: number
  priceLabel?: string | null
  tokensIn: number
  tokensOut: number
  groups?: UsageGroup[]
}

interface UsageResp {
  usage: Usage | null
  note?: string | null
  timeZone?: string
}

const PERIODS = [
  { id: '24h', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'month', label: 'Month to date' },
] as const

function costText(cost: number | null | undefined, label?: string | null): string {
  if (label === 'Price not set') return 'Price not set'
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return 'Price not set'
  if (cost === 0) return '$0.00'
  const abs = Math.abs(cost)
  if (abs < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function tokenCount(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}

function dayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)))
}

export default function Usage() {
  const [period, setPeriod] = useState(0)
  const id = PERIODS[period].id
  const { data, error } = useApi<UsageResp>(`/usage?period=${id}`, { pollMs: 30000 })
  const usage = data?.usage ?? null
  const groups = usage?.groups ?? []
  const unpriced = groups.some((row) => row.priceLabel === 'Price not set')

  return (
    <div>
      <PageHeader
        title="Usage"
        summary="Cost so far from tokens and the price table. A reported provider cost is used when OpenClaw sends one."
        tools={
          <Segmented
            labels={PERIODS.map((item) => item.label)}
            active={period}
            onChange={setPeriod}
            ariaLabel="Spend period"
          />
        }
      />

      {!data && !error && (
        <EmptyState title="Waiting for the API" body="Usage loads from the bridge snapshot. If this stays here, the API is not answering." />
      )}
      {error && !data && (
        <EmptyState title="Usage not loaded" body="Waiting for the API. If it stays down, cost on this page is missing rather than zero." />
      )}
      {data && !usage && (
        <EmptyState
          title="No usage yet"
          body="Run the bridge, or run npm run seed:demo on a machine without OpenClaw. Today, the last 7 days, and the month to date stay empty until a daily point exists."
        />
      )}

      {data && usage && (
        <>
          <SoftCard className="px-6 py-5">
            <div className="text-[12px] font-semibold text-mc-sub">{PERIODS[period].label}</div>
            <div className="mt-1 text-[32px] font-bold tracking-tight">{costText(usage.totalCost, usage.priceLabel)}</div>
            <div className="mt-1 text-[13px] text-mc-sub">
              {tokenCount(usage.tokensIn)} tokens in, {tokenCount(usage.tokensOut)} tokens out
            </div>
            <p className="mt-2 text-[12.5px] text-mc-sub">
              Days follow the server clock{data.timeZone ? ` (${data.timeZone})` : ''}. Ollama and any local provider are $0.00.
            </p>
            {data.note ? <p className="mt-2 text-[13px] text-mc-sub">{data.note}</p> : null}
            {unpriced ? (
              <p className="mt-2 text-[13px] text-mc-sub">
                Some models have no price. Their tokens are listed and they are not added into the total.
              </p>
            ) : null}
          </SoftCard>

          <SoftCard className="mt-4 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11.5px] text-mc-sub">
                  <th className="whitespace-nowrap px-4 py-2 font-semibold">Day</th>
                  <th className="whitespace-nowrap px-4 py-2 font-semibold">Bot</th>
                  <th className="whitespace-nowrap px-4 py-2 font-semibold">Model</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">Tokens in</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">Tokens out</th>
                  <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((row) => (
                  <tr key={`${row.day}-${row.bot}-${row.model}`} className="border-t border-mc-sep">
                    <td className="whitespace-nowrap px-4 py-3 text-[13.5px]">{dayLabel(row.day)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[14px] font-semibold">{row.bot}</td>
                    <td className="px-4 py-3 font-mono text-[12.5px]">{row.model}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{tokenCount(row.tokensIn)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{tokenCount(row.tokensOut)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-[14px] font-semibold tabular-nums">
                      {costText(row.cost, row.priceLabel)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SoftCard>
        </>
      )}
    </div>
  )
}
