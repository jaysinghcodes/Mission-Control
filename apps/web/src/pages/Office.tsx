import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { Card, Chip, SectionLabel } from '../components/ui'
import { AgentAvatar } from '../components/AgentAvatar'

/**
 * Office — LIVE floor with REAL pipeline semantics (review fix #7).
 *
 * The five stations read as office rooms (the board as a floor plan):
 *  Break Room — team lounge & queue (idle agents rest, no active work)
 *  Build Room — compile & assemble: code written, artifacts produced
 *  QA Room    — testing & verification: find bugs before release
 *  Review Room— the gate: human/approvals review before anything ships
 *  Ship Room  — release/deploy to production
 *
 * Agents are placed by role: build/infra/eng → BUILD, qa/test/audit → QA,
 * review → REVIEW, else round-robin. When a real run.* event fires, a bot
 * PHYSICALLY moves along the walkway to its next stage while bobbing.
 */

interface Agent { id: string; name: string; role: string | null; color: string; status: string }
interface AgentsResp { agents: Agent[] }
// `agent` is optional: bridge/seed run.* events carry it, API ticket moves may not.
interface EventApi { type: string; payload: { name?: string; summary?: string; agent?: string } | null; ts: string }
interface ActivityResp { events: EventApi[] }

const STATIONS = [
  { label: 'Break Room', def: 'Team lounge & queue — idle agents rest here' },
  { label: 'Build Room', def: 'Compile & assemble — code → artifacts' },
  { label: 'QA Room', def: 'Test & verify — find bugs pre-release' },
  { label: 'Review Room', def: 'The gate — human/approvals review' },
  { label: 'Ship Room', def: 'Release & deploy — completed runs visit' },
]
const STAGE_X = [2, 27, 45, 63, 81] // % left for each station

// MC-204 office chrome — one accent hue + door-plate monogram per room.
const ROOM_ACCENT: Record<string, string> = {
  'Break Room': 'var(--mc-border)', // neutral — lounge carries no hue
  'Build Room': 'var(--mc-blue)',
  'QA Room': 'var(--mc-green)',
  'Review Room': 'var(--mc-purple)',
  'Ship Room': 'var(--mc-teal)',
}
const ROOM_PLATE: Record<string, { bg: string; fg: string; mono: string }> = {
  'Break Room': { bg: 'var(--mc-inner)', fg: 'var(--mc-faint)', mono: 'BR' },
  'Build Room': { bg: 'var(--mc-bluebg)', fg: 'var(--mc-bluetext)', mono: 'BL' },
  'QA Room': { bg: 'var(--mc-greenbg)', fg: 'var(--mc-greentext)', mono: 'QA' },
  'Review Room': { bg: 'var(--mc-purplebg)', fg: 'var(--mc-purpletext)', mono: 'RV' },
  'Ship Room': { bg: 'var(--mc-tealbg)', fg: 'var(--mc-tealtext)', mono: 'SH' },
}

function stageForAgent(role: string | null, index: number): number {
  const r = (role ?? '').toLowerCase()
  if (r.includes('build') || r.includes('infra') || r.includes('eng') || r.includes('dev')) return 1 // BUILD
  if (r.includes('qa') || r.includes('test') || r.includes('audit') || r.includes('scan')) return 2 // QA
  if (r.includes('review') || r.includes('check')) return 3 // REVIEW
  return 1 + (index % 3) // round-robin across BUILD/QA/REVIEW
}

export default function Office() {
  const agents = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const history = useApi<ActivityResp>('/activity?limit=30', { pollMs: 15000 })
  const { events } = useLiveActivity()

  // agentId → station index. Recompute when the roster changes.
  const [stations, setStations] = useState<Record<string, number>>({})
  const [transit, setTransit] = useState<{ id: string; from: number; to: number } | null>(null)
  const prevRoster = useRef('')

  const roster = agents.data?.agents ?? []
  const rosterKey = roster.map((a) => `${a.id}:${a.status}`).join('|')

  useEffect(() => {
    if (rosterKey !== prevRoster.current) {
      prevRoster.current = rosterKey
      const next: Record<string, number> = {}
      roster.forEach((a, i) => {
        // Review fix: idle agents hang out in the BREAK ROOM (station 0);
        // only working agents stand at their role's station on the line.
        next[a.id] = a.status === 'working' ? stageForAgent(a.role, i) : 0
      })
      setStations(next)
    }
  }, [rosterKey, roster])

  // On run.* events: move a bot to the stage matching the event.
  useEffect(() => {
    const runEvents = events.filter((e) => e.type.startsWith('run.'))
    if (runEvents.length === 0 || Object.keys(stations).length === 0) return
    const ev = runEvents[0]
    const target = ev.type === 'run.completed' ? 4 : ev.type === 'run.failed' ? 2 : ev.type === 'run.queued' ? 1 : 1 + (ev.type === 'run.progress' ? 1 : 0)
    const candidates = roster.filter((a) => a.status === 'working' || a.status !== 'idle')
    const mover = candidates[0] ?? roster[0]
    if (!mover) return
    const from = stations[mover.id] ?? 1
    const to = Math.min(Math.max(target, 1), 4)
    if (from === to) return
    setStations((s) => ({ ...s, [mover.id]: to }))
    setTransit({ id: mover.id, from, to })
    const t = setTimeout(() => setTransit(null), 3000)
    return () => clearTimeout(t)
  }, [events, roster, stations])

  const working = roster.filter((a) => a.status === 'working')
  const idle = roster.filter((a) => a.status !== 'working')

  const buildLog = useMemo(() => {
    const runEvents = (history.data?.events ?? []).filter((e) => e.type.startsWith('run.'))
    return runEvents.slice(0, 6).map((e) => ({
      tm: new Date(e.ts).toLocaleTimeString([], { hour12: false }),
      // Real agent from the event payload; 'system' when the producer didn't
      // name one (was a hardcoded personal agent name — ticket 3).
      agent: e.payload?.agent || 'system',
      msg: `${e.type}${e.payload?.name ? ' · ' + e.payload.name : ''}`,
      color: e.type.includes('fail') ? 'var(--mc-redtext)' : e.type.includes('complete') ? 'var(--mc-greentext)' : 'var(--mc-bluetext)',
    }))
  }, [history.data])

  const stats = [
    { label: 'Working', value: String(working.length) },
    { label: 'Idle', value: String(idle.length) },
    { label: 'Agents', value: String(roster.length) },
    { label: 'Live Events', value: String(events.length) },
  ]

  return (
    <div className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[22px] font-semibold">Office</div>
          <div className="mt-1 text-[13px] text-mc-sub">Break Room → Build → QA → Review → Ship — the board as a floor plan. Agents move when runs fire.</div>
        </div>
        <div className="flex items-center gap-2" />
      </div>

      <div className="relative mt-6 h-[400px] rounded-2xl border border-mc-border bg-mc-inner overflow-hidden">
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(var(--mc-border) 1px, transparent 1px), linear-gradient(90deg, var(--mc-border) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="absolute top-3 left-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mc-faint">
          OFFICE · LIVE <span className="ml-2 inline-block w-2 h-2 rounded-full bg-mc-green align-middle" />
        </div>
        <div className="absolute top-3 right-4 h-[22px] px-3 rounded-md bg-mc-primary text-white text-[10.5px] font-semibold flex items-center">
          INCIDENTS · {events.filter((e) => e.type.includes('fail')).length}
        </div>

        <div className="absolute left-5 right-5 top-14 h-0.5 bg-mc-faint/40" />

        {/* Rooms — five office room cards, one per board column. Each room is centered on
            its stage lane (Break Room hugs the left wall) so the desks below work in front
            of their own room. Occupancy pills count agents standing at each station (live). */}
        <div className="absolute inset-x-4 top-[88px]">
          {STATIONS.map((st, i) => {
            const occupants = roster.filter((a) => (stations[a.id] ?? 1) === i).length
            const plate = ROOM_PLATE[st.label]
            return (
              <div
                key={st.label}
                title={st.def}
                className={i === 0 ? 'absolute left-0 top-0' : 'absolute top-0 -translate-x-1/2'}
                style={{ width: 'min(170px, 16.5%)', left: i === 0 ? undefined : `${STAGE_X[i]}%` }}
              >
                <div className="flex h-[80px] w-full flex-col overflow-hidden rounded-xl border border-mc-border bg-mc-card">
                  {/* accent strip — the room's only color field (Break Room stays neutral) */}
                  <div className="h-[3px] w-full" style={{ backgroundColor: ROOM_ACCENT[st.label] }} />
                  <div className="flex items-center gap-1.5 px-2.5 pt-1.5">
                    {/* door plate — accent-bg/-text pair + 2-letter monogram */}
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold"
                      style={{ backgroundColor: plate.bg, color: plate.fg }}
                    >
                      {plate.mono}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-mc-text">{st.label}</span>
                    <Chip label={String(occupants)} bg="var(--mc-inner)" fg="var(--mc-sub)" h={16} fs="text-[9.5px]" className="shrink-0" />
                  </div>
                  <div className="line-clamp-2 px-2.5 pt-[3px] text-[10px] leading-[1.35] text-mc-faint">{st.def}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Walkway — dashed office path threading under the room cards */}
        <div className="absolute left-8 right-8 top-[184px] border-t-2 border-dashed border-mc-border" />

        {/* Agents at their desks — bobbing while working, physically moving on events */}
        <div className="absolute inset-x-4 top-[206px] h-[110px]">
          {roster.map((a) => {
            const st = stations[a.id] ?? 1
            const x = STAGE_X[st]
            const isWorking = a.status === 'working'
            const isTransiting = transit?.id === a.id
            return (
              <div
                key={a.id}
                className="absolute flex flex-col items-center -translate-x-1/2"
                style={{ left: `${x}%`, transition: 'left 2.5s ease-in-out' }}
              >
                {/* MC-211: Pixel's robot avatar (state-driven bob/glow per tokens.css);
                    the outer wrapper only adds the quick transit dash on run.* moves. */}
                <div className={isTransiting ? 'animate-bob' : undefined} style={isTransiting ? { animationDuration: '0.6s' } : undefined}>
                  <AgentAvatar agent={a} size={0.8} />
                </div>
                {/* desk line — static 44px bar under the avatar slot; the desk stays put while the agent works at it */}
                <div className="mt-[3px] h-[3px] w-[44px] rounded-full border border-mc-border2 bg-mc-inner" />
                <div className="mt-1 text-[11px] font-semibold truncate max-w-[110px]">{a.name}</div>
                <div className="text-[9px] text-mc-sub truncate max-w-[110px]">{a.role ?? 'agent'}</div>
                {isTransiting && (
                  <Chip label={`→ ${STATIONS[transit!.to].label}`} bg="var(--mc-greenbg)" fg="var(--mc-greentext)" h={16} fs="text-[8.5px]" className="mt-1" />
                )}
                {!isTransiting && (
                  <Chip
                    label={isWorking ? 'WORKING' : 'IDLE'}
                    bg={isWorking ? 'var(--mc-bluebg)' : 'var(--mc-inner)'}
                    fg={isWorking ? 'var(--mc-bluetext)' : 'var(--mc-faint)'}
                    h={16}
                    fs="text-[8.5px]"
                    className="mt-1"
                  />
                )}
              </div>
            )
          })}
          {roster.length === 0 && (
            <div className="text-[12px] text-mc-faint pt-6 text-center">No agents synced yet — the bridge pushes the roster every few minutes.</div>
          )}
        </div>

        {/* floor stats */}
        <div className="absolute bottom-4 inset-x-4 flex justify-between px-1">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-[16px] font-semibold">{s.value}</div>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-mc-faint">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Run log — real persisted run events */}
      <Card className="mt-6 px-4 py-3">
        <SectionLabel>Run Log</SectionLabel>
        <div className="mt-2">
          {buildLog.length === 0 && <div className="text-[12px] text-mc-faint py-2">No run events yet — they stream in live.</div>}
          {buildLog.map((l, i) => (
            <div key={i} className="flex items-center gap-2 py-[5px] font-mono text-[11px]">
              <span className="text-mc-faint">{l.tm}</span>
              <span className="font-semibold text-mc-text">{l.agent}</span>
              <span style={{ color: l.color }}>{l.msg}</span>
            </div>
          ))}
        </div>
      </Card>

      <style>{`@keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        .animate-bob { animation: bob 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .animate-bob { animation: none; } }`}</style>
    </div>
  )
}
