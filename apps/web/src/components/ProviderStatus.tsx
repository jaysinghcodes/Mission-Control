export interface DetectedModel {
  id: string
  provider: string
  model: string
  label?: string | null
  agentId?: string | null
  agentName?: string | null
}

function providerTitle(row: DetectedModel): string {
  const who = (row.agentName || row.label || row.agentId || '').trim()
  return who || 'Unassigned'
}

/**
 * Launch 5 detection. An empty list is the sentence the first open shows.
 */
export function ProviderStatus({ models }: { models: readonly DetectedModel[] }) {
  if (models.length === 0) {
    return <p className="text-[14px] text-mc-sub">No provider detected yet</p>
  }
  return (
    <ul className="divide-y divide-mc-sep rounded-[14px] bg-mc-inner" data-provider-list="true">
      {models.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2.5">
          <span className="text-[14px] font-semibold text-mc-text">{providerTitle(row)}</span>
          <span className="text-[13px] text-mc-sub">{row.provider} · {row.model}</span>
        </li>
      ))}
    </ul>
  )
}
