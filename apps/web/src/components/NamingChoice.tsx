import { useEffect, useRef, useState } from 'react'
import { useNaming } from '../lib/naming'
import type { NamingMode } from '../lib/crew'
import type { Agent } from '../types'
import { assignCrewSeats, orderByPosition } from '../lib/crew'
import { Btn } from './shell'

/**
 * First run and Settings share this form.
 * A saved crew map is shown as stored. The first proposal matches
 * seat ids, then fills free seats in registration order.
 */
export function NamingChoice({
  agents,
  initialMode,
  initialMap,
  intro,
  submitLabel,
  onSaved,
  agentsReady = true,
}: {
  agents: readonly Agent[]
  initialMode: NamingMode | null
  initialMap: Record<string, string>
  intro: boolean
  submitLabel: string
  onSaved?: () => void
  /** False while the roster is still loading, so an empty list is not saved as the proposal. */
  agentsReady?: boolean
}) {
  const naming = useNaming()
  const seats = naming.seats
  const ordered = orderByPosition(agents)
  const locked = initialMode === 'crew' || initialMode === 'own' || Object.keys(initialMap).length > 0
  const [mode, setMode] = useState<NamingMode>(initialMode === 'own' ? 'own' : 'crew')
  const [map, setMap] = useState<Record<string, string>>(() => {
    if (locked) return storedMap(initialMode, initialMap)
    if (!agentsReady || seats.length === 0) return {}
    return assignCrewSeats(ordered, seats, {})
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proposed = useRef(locked || (agentsReady && seats.length > 0))

  useEffect(() => {
    if (proposed.current) return
    if (!agentsReady || seats.length === 0) return
    proposed.current = true
    setMap(assignCrewSeats(ordered, seats, {}))
  }, [agentsReady, seats, ordered])

  function choose(next: NamingMode) {
    setMode(next)
    setError(null)
    if (next === 'crew' && Object.keys(map).length === 0 && initialMode !== 'crew') {
      setMap(assignCrewSeats(ordered, seats, {}))
    }
  }

  function setSeat(agentId: string, seatId: string) {
    setMap((prev) => {
      const next = { ...prev }
      if (!seatId) delete next[agentId]
      else next[agentId] = seatId
      return next
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    const crewMap = mode === 'crew' ? map : {}
    const message = await naming.save({ namingMode: mode, crewMap })
    setSaving(false)
    if (message) setError(message)
    else onSaved?.()
  }

  return (
    <div data-naming-choice="true">
      {intro && (
        <>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-mc-text">Name your agents</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-mc-sub">
            This choice is saved for this Mission Control. You can change it later in Settings. Sample rows keep the names already stored on them.
          </p>
        </>
      )}

      <div className={`grid gap-3 ${intro ? 'mt-6' : ''}`}>
        <Choice
          selected={mode === 'crew'}
          title="Use the Mission Control crew"
          badge="Recommended"
          body="An agent whose id matches a crew seat takes that seat when the seat is free. A saved seat stays with that agent. Everyone else takes the next free seat in the order they first registered. When a seat opens, the earliest agent without a seat takes it. You can change any seat. A display name does not pick a seat."
          onSelect={() => choose('crew')}
        />
        <Choice
          selected={mode === 'own'}
          title="Keep my own names"
          body="Agents keep the name, role, and color they registered with. Desks stay generic."
          onSelect={() => choose('own')}
        />
      </div>

      {mode === 'crew' && (
        <div className="mt-5">
          {ordered.length === 0 ? (
            <p className="text-[13px] text-mc-sub">
              No agents yet. You can still continue. An agent that registers later takes the next free seat. A saved seat stays with that agent.
            </p>
          ) : (
            <ul className="divide-y divide-mc-sep rounded-[14px] bg-mc-inner">
              {ordered.map((agent) => {
                const taken = new Set(Object.entries(map).filter(([id]) => id !== agent.id).map(([, seat]) => seat))
                return (
                  <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-mc-text">{agent.name}</span>
                      <span className="block text-[12px] text-mc-sub">{agent.id} · {agent.role?.trim() || 'Agent'}</span>
                    </span>
                    <label className="text-[12px] text-mc-sub">
                      <span className="sr-only">Crew seat for {agent.id}</span>
                      <select
                        aria-label={`Crew seat for ${agent.id}`}
                        data-agent-id={agent.id}
                        value={map[agent.id] ?? ''}
                        onChange={(e) => setSeat(agent.id, e.target.value)}
                        className="h-8 rounded-lg bg-mc-ctl px-2 text-[13px] text-mc-text"
                      >
                        <option value="">Own name</option>
                        {seats.map((seat) => (
                          <option key={seat.id} value={seat.id} disabled={taken.has(seat.id)}>
                            {seat.name} · {seat.role}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-mc-orangetext">{error}</p>}
      <div className="mt-5">
        <Btn kind="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving' : submitLabel}</Btn>
      </div>
    </div>
  )
}

/** A saved crew or own choice is shown as stored. A first run proposes below. */
function storedMap(
  mode: NamingMode | null,
  initialMap: Record<string, string>,
): Record<string, string> {
  if (mode === 'own') return {}
  if (mode === 'crew') return { ...initialMap }
  if (Object.keys(initialMap).length > 0) return { ...initialMap }
  return {}
}

function Choice({
  selected,
  title,
  badge,
  body,
  onSelect,
}: {
  selected: boolean
  title: string
  badge?: string
  body: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`rounded-[14px] px-4 py-4 text-left ${selected ? 'bg-mc-sel ring-2 ring-mc-accent' : 'bg-mc-inner'}`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold text-mc-text">{title}</span>
        {badge && <span className="rounded-full bg-mc-accent-fill px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span>}
      </span>
      <span className="mt-1 block text-[13px] leading-relaxed text-mc-sub">{body}</span>
    </button>
  )
}
