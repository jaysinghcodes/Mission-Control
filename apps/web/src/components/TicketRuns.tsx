import { StatusChip } from './shell'
import { Progress } from './ui'
import { runStatusLabel, runStatusTone, type LinkedRun } from '../lib/ticket-runs'

/**
 * Runs linked to one ticket. Uses the same status chip and progress bar as
 * the rest of the dashboard. Renders nothing when the ticket has no runs.
 */
export function TicketRuns({ runs }: { runs: LinkedRun[] }) {
  if (runs.length === 0) return null
  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-semibold text-mc-sub">Runs</div>
      <ul className="space-y-2" aria-label="Runs">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-mc-text">{run.name}</span>
            {run.agent ? <span className="text-[12px] text-mc-sub">{run.agent}</span> : null}
            <StatusChip label={runStatusLabel(run.status)} tone={runStatusTone(run.status)} />
            <Progress
              pct={typeof run.progress === 'number' ? run.progress : 0}
              color="var(--mc-blue)"
              w="w-16"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
