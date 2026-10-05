import { useCallback, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useApi } from '../hooks/useApi'
import type { Agent, AgentsResp } from '../types'
import { Card, SectionLabel } from '../components/ui'
import { AgentAvatar } from '../components/AgentAvatar'
import { AgentProfileDrawer } from '../components/AgentProfileDrawer'
import { rosterDisplayName, rosterIdentity } from '../data/roster'

/**
 * Team (MC-201) — the roster as a *team*, not a list of processes.
 *
 * Org-chart header with the root agent (Chief of Staff) on top and the rest of the
 * real OpenClaw roster as member cards below, fed by GET /agents (polled).
 * Nothing here is hardcoded: whoever the API reports is the team — the root
 * agent (no parentId) becomes the org header, everyone else fills the roster
 * grid. Status dots keep the honest working/idle semantics of the old Agents
 * page; movement/stage logic lives in Office and is untouched.
 *
 * Identity display (MC-201): agent names + roles read through the approved
 * roster map (data/roster.ts) — Lead → Chief of Staff, Atlas → Scrum Master,
 * Nova → Development, … — so cards show human names and role titles. Unknown
 * agents render their real API name + role (fallback "agent" when role is
 * null). MC-200 profile fields (emoji, currentTask, …) are all optional on
 * the wire and every render path is null-safe.
 *
 * MC-202: each member card is a <button> wired to open the profile drawer
 * for that agent (AgentProfileDrawer) — name/role/status, personality tags,
 * current task, stats, recent activity, and the chat-channel deep link
 * (only when the bridge supplies one).
 * MC-211: AgentAvatar now renders Pixel's robot sprites (unique per roster
 * agent, live data-state) — see components/AgentAvatar.tsx + avatarAssets.ts.
 */

/** Status dot color — live honest semantics: working = green, otherwise faint. */
const statusColor = (status: string) => (status === 'working' ? 'var(--mc-green)' : 'var(--mc-faint)')

/** Roster member card. Root (chief) variant gets the distinct org-header styling. */
function MemberCard({
  agent,
  chief = false,
  parentName = null,
  onOpen,
}: {
  agent: Agent
  chief?: boolean
  parentName?: string | null
  onOpen?: (agent: Agent, e: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  // MC-202: onClick opens the agent profile drawer. Focus return is handled
  // by Team (trigger ref) so the card keeps keyboard focus after ESC/backdrop.
  const identity = rosterIdentity(agent.name, agent.role)
  const name = rosterDisplayName(agent.name, agent.role)
  const roleTitle = identity?.role ?? agent.role ?? 'agent'
  const working = agent.status === 'working'

  if (chief) {
    return (
      <button
        type="button"
        aria-label={`${name} — ${roleTitle}`}
        aria-haspopup="dialog"
        onClick={(e) => onOpen?.(agent, e)}
        className="cursor-pointer rounded-xl bg-mc-card px-6 py-4 flex flex-col items-center gap-2 min-w-[220px] text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary transition-colors"
        style={{ border: '1px solid color-mix(in srgb, var(--mc-primary) 55%, transparent)' }}
      >
        <AgentAvatar agent={agent} size={1.9} />
        <div>
          <div className="text-[15px] font-semibold leading-tight">{name}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-mc-primary">{roleTitle}</div>
        </div>
        <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: statusColor(agent.status) }} />
        <span className="text-[10px] text-mc-faint">{working ? 'working' : 'idle'}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={`${name} — ${roleTitle}${parentName ? `, reports to ${parentName}` : ''}`}
      aria-haspopup="dialog"
      onClick={(e) => onOpen?.(agent, e)}
      className="cursor-pointer rounded-xl border border-mc-border bg-mc-card px-3 py-2.5 min-w-[160px] w-[170px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary transition-colors hover:border-mc-primary/60"
    >
      <div className="flex items-center gap-2">
        <AgentAvatar agent={agent} size={1} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold leading-tight truncate">{name}</div>
          <div className="text-[11px] text-mc-sub truncate">{roleTitle}</div>
        </div>
        <span
          className="w-[4.5px] h-[4.5px] rounded-full shrink-0"
          title={working ? 'working' : 'idle'}
          style={{ backgroundColor: statusColor(agent.status) }}
        />
      </div>
      {parentName && <div className="mt-1 text-[10px] text-mc-faint truncate">↑ {parentName}</div>}
    </button>
  )
}

export default function Team() {
  const { data, error } = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const agents = data?.agents ?? []
  // Org root: the agent with no parent. Shape-tolerant: if the API
  // ever reports a roster without a root, the first agent leads instead.
  const chief = agents.find((a) => !a.parentId) ?? agents[0]
  const team = chief ? agents.filter((a) => a.id !== chief.id) : []
  const displayNameById = new Map(agents.map((a) => [a.id, rosterDisplayName(a.name, a.role)]))

  const workingCount = agents.filter((a) => a.status === 'working').length

  // MC-202: selected agent feeds the profile drawer; the trigger button is
  // remembered so focus returns to the card when the drawer closes (a11y).
  const [selected, setSelected] = useState<Agent | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const openProfile = (agent: Agent, e: ReactMouseEvent<HTMLButtonElement>) => {
    triggerRef.current = e.currentTarget
    setSelected(agent)
  }
  const closeProfile = useCallback(() => {
    setSelected(null)
    // Focus return after the drawer unmounts (card stays mounted in the grid).
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  return (
    <div className="p-6">
      <div className="text-[22px] font-semibold">Team</div>
      <div className="mt-1 text-[13px] text-mc-sub">Meet the team — the real roster on this OpenClaw instance, who's working right now.</div>

      {error && (
        <Card className="mt-10 px-4 py-8 text-[12.5px] text-mc-faint">API unreachable — can't load the team roster.</Card>
      )}

      {!error && agents.length === 0 && (
        <Card className="mt-10 px-4 py-8 text-[12.5px] text-mc-faint">
          No roster synced yet. The bridge pushes the live agent tree every few minutes.
        </Card>
      )}

      {!error && chief && (
        <div className="mt-10 flex flex-col items-center">
          {/* Org-chart header — root agent (Chief of Staff) on top */}
          <MemberCard agent={chief} chief onOpen={openProfile} />
          {team.length === 0 ? (
            <div className="mt-8 text-[12px] text-mc-faint text-center max-w-sm">
              No sub-agents running right now. Spawn one (sessions_spawn or a task) and it appears here live.
            </div>
          ) : (
            <>
              {/* Connectors down to the team */}
              <div className="w-px h-7 bg-mc-faint/60" />
              <div className="h-px w-[min(900px,92%)] bg-mc-faint/60" />
              {/* Roster cards — one per live agent, any count */}
              <div className="mt-5 flex flex-wrap justify-center gap-3 max-w-[1060px]">
                {team.map((a) => {
                  const parent = a.parentId ? agents.find((p) => p.id === a.parentId) : null
                  const parentName = parent && parent.id !== chief.id ? displayNameById.get(parent.id) ?? null : null
                  return <MemberCard key={a.id} agent={a} parentName={parentName} onOpen={openProfile} />
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!error && agents.length > 0 && (
        <Card className="mt-10 px-4 py-5 max-w-[520px]">
          <SectionLabel>Team Status</SectionLabel>
          <div className="flex gap-10 mt-4">
            <div className="flex items-center gap-2">
              <span className="w-[5px] h-[5px] rounded-full bg-mc-green" />
              <span className="text-[12px] text-mc-sub">Working</span>
              <span className="text-[12px] font-semibold">{workingCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[5px] h-[5px] rounded-full bg-mc-faint" />
              <span className="text-[12px] text-mc-sub">Idle</span>
              <span className="text-[12px] font-semibold">{agents.length - workingCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[5px] h-[5px] rounded-full bg-mc-text" />
              <span className="text-[12px] text-mc-sub">Total agents</span>
              <span className="text-[12px] font-semibold">{agents.length}</span>
            </div>
          </div>
        </Card>
      )}

      {/* MC-202: profile drawer — rendered for the clicked agent only */}
      {selected && <AgentProfileDrawer agent={selected} onClose={closeProfile} />}
    </div>
  )
}
