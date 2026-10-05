import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { Card, Chip, PillButton, SectionLabel } from '../components/ui'
import { AgentAvatar } from '../components/AgentAvatar'
import { rosterDisplayName } from '../data/roster'

/**
 * Live Activity — real event stream: persisted history on load + live
 * Socket.IO events appended as they arrive. Agent cards show the real roster.
 */

interface Agent { id: string; name: string; role: string | null; color: string; status: string; parentId?: string | null }
interface AgentsResp { agents: Agent[] }
interface EventApi { type: string; payload: { name?: string; agent?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }

/**
 * Who the row is about. Bridge run events put the agent id on `agent` and
 * the job title on `name`. Prefer the agent so the sticker matches Team.
 */
function eventSubject(payload: { name?: string; agent?: string } | null | undefined): string | null {
  const agent = payload?.agent?.trim()
  if (agent) return agent
  const name = payload?.name?.trim()
  return name || null
}

/** Sticker for a stream row. A roster hit uses the live list (so a numbered
 *  child stays a numbered child). Anything else is a one-off sticker hashed
 *  from the label — not folded into the roster, which would burn a seat. */
function streamFace(label: string | null, roster: readonly Agent[]): {
  agent: Agent | { id: string; name: string; status: string }
  agents?: readonly Agent[]
  text: string
} {
  const fallback = label?.trim() || 'openclaw'
  const key = fallback.toLowerCase()
  const hit = roster.find((a) =>
    a.id.toLowerCase() === key ||
    a.name.toLowerCase() === key ||
    rosterDisplayName(a.name, a.role).toLowerCase() === key,
  )
  if (hit) return { agent: hit, agents: roster, text: rosterDisplayName(hit.name, hit.role) }
  return { agent: { id: fallback, name: fallback, status: 'idle' }, text: fallback }
}

export default function Activity() {
  const agents = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const history = useApi<ActivityResp>('/activity?limit=40', { pollMs: 10000 })
  const { events, connected } = useLiveActivity()

  const roster = agents.data?.agents ?? []
  const stream = [
    ...(history.data?.events ?? []).map((e) => {
      const face = streamFace(eventSubject(e.payload), roster)
      return {
        tm: new Date(e.ts).toLocaleTimeString([], { hour12: false }),
        face,
        zone: e.type.split('.')[0]?.toUpperCase() ?? 'RUN',
        desc: `${e.type}${e.payload?.name ? ' · ' + e.payload.name : ''}`,
        key: `h-${e.ts}`,
      }
    }),
    ...events.map((e, i) => {
      const payload = {
        name: typeof e.name === 'string' ? e.name : undefined,
        agent: typeof e.agent === 'string' ? e.agent : undefined,
      }
      const face = streamFace(eventSubject(payload), roster)
      return {
        tm: new Date(e.ts).toLocaleTimeString([], { hour12: false }),
        face,
        zone: e.type.split('.')[0]?.toUpperCase() ?? 'RUN',
        desc: e.type,
        key: `l-${e.ts}-${i}`,
      }
    }),
  ].slice(0, 40)

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
          <Card className="w-full px-4 py-6 text-[12.5px] text-mc-faint">No agents synced yet — the bridge pushes the roster every few minutes.</Card>
        )}
      </div>

      {/* Event stream */}
      <SectionLabel className="mt-8">Event Stream</SectionLabel>
      <Card className="mt-3 rounded-2xl px-0 py-1 overflow-hidden">
        {stream.length === 0 && (
          <div className="px-[18px] py-8 text-[12.5px] text-mc-faint">
            {connected ? 'Connected — waiting for the first event…' : 'No events yet. The bridge pushes real activity every few minutes.'}
          </div>
        )}
        {stream.map((ev) => (
          <div key={ev.key} className="flex items-center gap-3 px-[18px] min-h-11 py-1.5 border-b border-mc-border2">
            <span className="font-mono text-[11.5px] text-mc-faint w-[70px] shrink-0">{ev.tm}</span>
            {/* Same sticker robots as the agent cards above — not the generic bot. */}
            <AgentAvatar agent={ev.face.agent} agents={ev.face.agents} size={0.75} />
            <span className="text-[12px] font-semibold w-[120px] shrink-0 truncate">{ev.face.text}</span>
            <Chip label={ev.zone} bg="var(--mc-inner)" fg="var(--mc-sub)" h={17} fs="text-[9.5px]" />
            <span className="text-[12px] text-mc-sub truncate">{ev.desc}</span>
          </div>
        ))}
        <div className="px-[18px] py-3 text-[12px] font-semibold text-mc-greentext">
          {connected ? '● Streaming live' : '● offline — API not reachable'}
        </div>
      </Card>
    </div>
  )
}
