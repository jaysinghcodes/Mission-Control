import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Agent } from '../types'
import { SectionLabel } from './ui'
import { AgentAvatar } from './AgentAvatar'
import { channelHref, rosterDisplayName, rosterIdentity } from '../data/roster'

const statusColor = (status: string) => (status === 'working' ? 'var(--mc-green)' : 'var(--mc-faint)')

/**
 * Agent profile drawer — MC-202.
 *
 * Right-side drawer opened by clicking a Team page card (MC-201 wired the
 * cards as <button>s). Renders the agent's profile from the real agent
 * object: robot avatar (ticket 12 — one of 12 robots.tsx drawings, or a
 * numbered copy of the parent past that cap), roster
 * display name + role title, live
 * status, personality tags, current task, tasks completed, total cost and
 * recent activity — every field nullable until the bridge pushes it, so all
 * values fall back to '—' and the personality/task rows collapse cleanly.
 *
 * Per-agent deep link (bottom): when `channelHref()` resolves a channel
 * (agent.channel from the bridge — a full URL, or a Discord id expanded with
 * the operator's own VITE_DISCORD_GUILD_ID) a real <a href target="_blank">
 * button renders — never <#id>, never a dead link. When null (the default on
 * a fresh clone — no hardcoded server since ticket 3) the footer is absent.
 *
 * A11y: role=dialog + aria-label, initial focus into the panel, ESC/backdrop/
 * close-button all close, focus returns to the triggering card (Team.tsx
 * keeps the trigger ref). Mobile: panel spans the full width.
 */
export function AgentProfileDrawer({
  agent,
  agents,
  onClose,
}: {
  agent: Agent
  /** Roster the card was opened from, so the avatar matches the grid (ticket 12). */
  agents?: Agent[]
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Identity display mirrors the Team cards (roster map, not guessed).
  const identity = rosterIdentity(agent.name, agent.role)
  const name = rosterDisplayName(agent.name, agent.role)
  const roleTitle = identity?.role ?? agent.role ?? 'agent'
  const working = agent.status === 'working'
  const chief = !agent.parentId

  const href = channelHref(agent.channel, name)
  const tags = Array.isArray(agent.personalityTags) ? agent.personalityTags : []
  const completed = typeof agent.tasksCompleted === 'number' && Number.isFinite(agent.tasksCompleted) ? agent.tasksCompleted : 0
  const cost = typeof agent.totalCost === 'number' && Number.isFinite(agent.totalCost) ? agent.totalCost : 0
  const money = cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

  // ESC closes; lock body scroll while open; move focus into the dialog.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /** Labeled profile row — value falls back to '—' when the field is null. */
  function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div>
        <SectionLabel>{label}</SectionLabel>
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-mc-text break-words">{children}</div>
      </div>
    )
  }

  const Dash = () => <span className="text-mc-faint">—</span>

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — click closes */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />

      {/* Panel — full width on mobile, capped on larger screens */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} — ${roleTitle} profile`}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-mc-card shadow-2xl outline-none sm:max-w-[420px] sm:border-l sm:border-mc-border"
      >
        {/* Header: avatar + identity + status, close button */}
        <div className="flex items-start gap-3 border-b border-mc-border px-5 pb-4 pt-5">
          <AgentAvatar agent={agent} agents={agents} size={1.8} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold leading-tight text-mc-text">{name}</div>
            <div className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${chief ? 'text-mc-primary' : 'text-mc-sub'}`}>
              {roleTitle}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ backgroundColor: statusColor(agent.status) }} />
              <span className="text-[11px] text-mc-sub">{working ? 'working' : 'idle'}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mc-faint transition-colors hover:bg-mc-inner hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        {/* Body — scrolls when long */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {tags.length > 0 && (
            <div>
              <SectionLabel>Personality</SectionLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex h-[20px] items-center rounded-full bg-mc-inner px-2.5 text-[10.5px] font-semibold text-mc-sub"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <Field label="Current Task">
            {agent.currentTask?.trim() ? agent.currentTask : <Dash />}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-mc-border bg-mc-inner px-3 py-2.5">
              <div className="text-[18px] font-semibold leading-none text-mc-text">{completed.toLocaleString()}</div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-mc-faint">Tasks Completed</div>
            </div>
            <div className="rounded-lg border border-mc-border bg-mc-inner px-3 py-2.5">
              <div className="text-[18px] font-semibold leading-none text-mc-text">{money}</div>
              <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-mc-faint">Total Cost</div>
            </div>
          </div>

          <Field label="Recent Activity">
            {agent.recentActivity?.trim() ? agent.recentActivity : <Dash />}
          </Field>
        </div>

        {/* Footer — deep link only when a channel resolves (never a dead link) */}
        {href && (
          <div className="border-t border-mc-border px-5 py-3.5">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${name}'s channel (new tab)`}
              className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-full bg-mc-primary px-4 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
            >
              Open channel
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6.5 2.5 H2.5 V13.5 H13.5 V9.5" />
                <path d="M9.5 1.5 h5 v5" />
                <path d="M14.5 1.5 L7.5 8.5" />
              </svg>
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
