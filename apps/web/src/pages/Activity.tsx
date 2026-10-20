import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { Card, Chip, PillButton, SectionLabel } from '../components/ui'
import { AgentAvatar } from '../components/AgentAvatar'
import { activityRailLine } from '../lib/activity-rail'
import { presentAgent, resolveSticker, type NamingState } from '../lib/crew'
import { useNaming } from '../lib/naming'

/**
 * Live Activity — real event stream: persisted history on load + live
 * Socket.IO events appended as they arrive. Agent cards show the real roster.
 */

interface Agent { id: string; name: string; role: string | null; color: string; status: string; parentId?: string | null }
interface AgentsResp { agents: Agent[] }
interface EventApi { type: string; payload: { name?: string; agent?: string; title?: string; summary?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }

/**
 * Sticker for a stream row. The id must be an agent id. A roster hit uses
 * the live list (so a numbered child stays a numbered child) and that
 * agent's status. Anything else is a one-off sticker hashed from the
 * label, not folded into the roster, which would burn a seat.
 */
function streamFace(
  id: string | null,
  roster: readonly Agent[],
  state: NamingState,
  registeredName = '',
): {
  agent: Agent | { id: string; name: string; role: null; status: 'idle'; color: string }
  agents?: readonly Agent[]
  text: string
} {
  const sticker = resolveSticker(roster, id || 'openclaw')
  const agent = sticker.matched
    ? sticker.agent
    : { ...sticker.agent, name: registeredName || sticker.agent.name }
  return { agent, agents: sticker.agents, text: presentAgent(agent, state).name }
}

export default function Activity() {
  const agents = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const history = useApi<ActivityResp>('/activity?limit=40', { pollMs: 10000 })
  const { events, connected } = useLiveActivity()

  const naming = useNaming()
  const roster = agents.data?.agents ?? []
  const stream = [
    ...(history.data?.events ?? []).map((e) => {
      const line = activityRailLine(e, roster, [], [], naming)
      if (!line) return null
      const face = streamFace(line.actor?.id ?? e.payload?.agent ?? null, roster, naming, line.actor?.name ?? '')
      return {
        tm: new Date(e.ts).toLocaleTimeString([], { hour12: false }),
        face,
        zone: e.type.split('.')[0]?.toUpperCase() ?? 'RUN',
        desc: line.text,
        key: `h-${e.ts}`,
      }
    }),
    ...events.map((e, i) => {
      const line = activityRailLine(e, roster, [], [], naming)
      if (!line) return null
      const face = streamFace(line.actor?.id ?? null, roster, naming, line.actor?.name ?? '')
      return {
        tm: new Date(e.ts).toLocaleTimeString([], { hour12: false }),
        face,
        zone: e.type.split('.')[0]?.toUpperCase() ?? 'RUN',
        desc: line.text,
        key: `l-${e.ts}-${i}`,
      }
    }),
  ].filter((row): row is NonNullable<typeof row> => row != null).slice(0, 40)

  return (
    <div className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[22px] font-semibold">Live Activity</div>
          <div className="mt-1 text-[13px] text-mc-sub">Real events from this OpenClaw instance, zone by zone.</div>
        </div>
        <PillButton label="❚❚  Pause" />
      </div>

      {/* Agent cards — real roster */}
      <div className="flex gap-3 mt-6 overflow-x-auto pb-1">
        {roster.map((a) => (
          <Card key={a.id} className="w-[186px] shrink-0 px-3 py-3">
            <SectionLabel>{a.status === 'working' ? 'Working' : 'Idle'}</SectionLabel>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <AgentAvatar agent={a} agents={roster} size={0.8} />
                  <span className="text-[12px] font-semibold truncate">{a.name}</span>
                </div>
                <div className="text-[10.5px] text-mc-sub truncate mt-1">{a.role ?? 'agent'}</div>
              </div>
              <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: a.status === 'working' ? 'var(--mc-green)' : 'var(--mc-faint)' }} />
            </div>
          </Card>
        ))}
        {roster.length === 0 && (
          <Card className="w-full px-4 py-6 text-[12.5px] text-mc-faint">No agents synced yet. The bridge pushes the roster every few minutes.</Card>
        )}
      </div>

      {/* Event stream */}
      <SectionLabel className="mt-8">Event Stream</SectionLabel>
      <Card className="mt-3 rounded-2xl px-0 py-1 overflow-hidden">
        {stream.length === 0 && (
          <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">
            {connected ? 'Connected. Waiting for the first event…' : 'No events yet. The bridge pushes real activity every few minutes.'}
          </div>
        )}
        {stream.map((ev) => (
          <div key={ev.key} className="flex items-center gap-3 px-[18px] min-h-11 py-1.5 border-b border-mc-border2">
            <span className="font-mono text-[11.5px] text-mc-faint w-[70px] shrink-0">{ev.tm}</span>
            {/* Same sticker robots as the agent cards above — not the generic bot. */}
            <AgentAvatar agent={ev.face.agent} agents={ev.face.agents} size={0.75} />
            <span className="w-[120px] shrink-0 break-words text-[12px] font-semibold">{ev.face.text}</span>
            <Chip label={ev.zone} bg="var(--mc-inner)" fg="var(--mc-sub)" h={17} fs="text-[9.5px]" />
            <span className="text-[12px] text-mc-sub truncate">{ev.desc}</span>
          </div>
        ))}
        <div className="px-[18px] py-3 text-[12px] font-semibold text-mc-greentext">
          {connected ? '● Streaming live' : '● offline. API not reachable'}
        </div>
      </Card>
    </div>
  )
}
