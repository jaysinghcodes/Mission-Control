import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import type { Agent, AgentsResp } from '../types'
import { PageHeader, SoftCard, Btn, Face, AgentName, Kicker, EmptyState, FieldError } from '../components/shell'
import { OPERATOR_NAME } from '../config'
import { ROSTER, agentCaption } from '../data/roster'
import { formatChicagoSaved } from '../lib/chicago-day'

/**
 * Team — ticket 13 layout (mission, people, devices), filled from the API.
 * Mission and devices are rows in Postgres. People are the roster robots
 * from GET /agents, captioned Name · Function, each linking to Agents.
 * Invite and pairing stay as sheets; they do not create accounts.
 */

interface MissionResp {
  mission: string
  placeholder: string
}

interface DeviceRow {
  id: string
  name: string
  type: string
  online: boolean
  lastSeenAt: string | null
}

interface DevicesResp {
  devices: DeviceRow[]
}

/** Roster order, at most the 12 cool-name robots. Unmatched agents fill in only when none of the roster is present. */
function peopleRow(agents: Agent[]): Agent[] {
  const used = new Set<string>()
  const picked: Agent[] = []
  for (const entry of ROSTER) {
    const match = agents.find((agent) => {
      if (used.has(agent.id)) return false
      return agentCaption(agent.name, agent.role).name === entry.name
    })
    if (!match) continue
    used.add(match.id)
    picked.push(match)
  }
  if (picked.length > 0) return picked.slice(0, 12)
  return agents.slice(0, 12)
}

function deviceStatus(device: DeviceRow): { on: boolean; status: string } {
  if (device.online) return { on: true, status: 'Online' }
  const when = device.lastSeenAt ? formatChicagoSaved(device.lastSeenAt) : ''
  if (when) return { on: false, status: `Last seen ${when}` }
  return { on: false, status: 'Offline' }
}

export default function Team() {
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const missionQ = useApi<MissionResp>('/mission')
  const devicesQ = useApi<DevicesResp>('/devices', { pollMs: 30000 })
  const agents = agentsQ.data?.agents ?? []
  const people = peopleRow(agents)
  const working = agents.filter((a) => a.status === 'working').length
  const devices = devicesQ.data?.devices ?? []
  const mission = missionQ.data?.mission ?? ''
  const placeholder = missionQ.data?.placeholder ?? ''
  const filled = mission.trim().length > 0
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [invite, setInvite] = useState(false)
  const [pair, setPair] = useState(false)
  const owner = OPERATOR_NAME || 'Operator'
  const online = devices.filter((d) => d.online).length

  function startEdit() {
    setDraft(mission)
    setSaveError(null)
    setEditing(true)
  }

  async function saveMission() {
    setSaving(true)
    setSaveError(null)
    const r = await apiSend<MissionResp>('PUT', '/mission', { mission: draft })
    setSaving(false)
    if (!r.ok || !r.data) {
      setSaveError(r.error ?? 'Could not save the mission')
      return
    }
    missionQ.mutate(() => r.data)
    setEditing(false)
  }

  return (
    <div>
      <PageHeader
        title="Team"
        summary={`${owner} + ${agents.length} agents · ${online} online`}
        tools={<Btn kind="primary" onClick={() => setInvite(true)}>Invite</Btn>}
      />

      <SoftCard className="px-7 py-6">
        <div className="flex items-center justify-between">
          <Kicker>Mission</Kicker>
          <button
            type="button"
            className="text-[13px] font-semibold text-mc-accent-text"
            onClick={startEdit}
            disabled={!missionQ.data}
          >
            Edit
          </button>
        </div>
        {missionQ.errorMessage && !missionQ.data && (
          <p className="mt-3 text-[13px] text-mc-orangetext">Couldn't load the mission ({missionQ.errorMessage}).</p>
        )}
        {missionQ.data && editing ? (
          <div className="mt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Mission"
              className="h-20 w-full whitespace-pre-wrap wrap-anywhere rounded-lg bg-mc-ctl px-3 py-2 text-[16px] outline-none"
            />
            <div className="mt-2 flex gap-2">
              <Btn kind="primary" onClick={() => void saveMission()} disabled={saving}>Save</Btn>
              <Btn kind="plain" onClick={() => { setEditing(false); setSaveError(null) }}>Cancel</Btn>
            </div>
            {saveError && <FieldError>{saveError}</FieldError>}
          </div>
        ) : missionQ.data ? (
          <>
            <p className={`mt-3 whitespace-pre-wrap wrap-anywhere text-[20px] tracking-tight ${filled ? 'font-semibold' : 'font-medium text-mc-sub'}`}>
              {filled ? mission : placeholder}
            </p>
            <p className="mt-2 text-[13px] text-mc-sub">Agents see this as the line under the work.</p>
          </>
        ) : !missionQ.errorMessage ? (
          <p className="mt-3 text-[13px] text-mc-sub">Loading mission…</p>
        ) : null}
      </SoftCard>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SoftCard className="px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">People</span>
            <span className="text-[12.5px] text-mc-sub">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
          </div>
          {!agentsQ.data && agentsQ.loading ? (
            <p className="mt-4 text-[13px] text-mc-sub">Loading people…</p>
          ) : people.length === 0 ? (
            <p className="mt-4 text-[13px] text-mc-sub">No agents yet. Seed or connect the bridge.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
              {people.map((agent) => {
                const cap = agentCaption(agent.name, agent.role)
                return (
                  <li key={agent.id}>
                    <Link to="/agents" className="flex shrink-0 items-center gap-2" aria-label={`${cap.name} · ${cap.role}`}>
                      <Face agent={agent} agents={agents} px={36} />
                      <AgentName name={agent.name} role={agent.role} size="md" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" onClick={() => setInvite(true)} className="mt-5 text-[13px] font-semibold text-mc-accent-text">
            Invite a teammate <span className="font-medium text-mc-sub">to share approvals</span>
          </button>
        </SoftCard>

        <SoftCard className="px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">Agents</span>
            <span className="text-[12.5px] text-mc-sub">{agents.length} · {working} working</span>
          </div>
          {!agentsQ.data && agentsQ.loading ? (
            <p className="mt-4 text-[13px] text-mc-sub">Loading agents…</p>
          ) : agents.length === 0 ? (
            <p className="mt-4 text-[13px] text-mc-sub">No agents yet. Seed or connect the bridge.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {people.map((agent) => {
                const cap = agentCaption(agent.name, agent.role)
                return (
                  <Link key={agent.id} to="/agents" aria-label={`${cap.name} · ${cap.role}`} className="rounded-lg">
                    <Face agent={agent} agents={agents} px={46} />
                  </Link>
                )
              })}
            </div>
          )}
          <Link to="/agents" className="mt-4 inline-block text-[13px] font-semibold text-mc-accent-text">See who's doing what</Link>
        </SoftCard>
      </div>

      <SoftCard className="mt-5 px-6 py-5">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">Devices</span>
          <button type="button" className="text-[13px] font-semibold text-mc-accent-text" onClick={() => setPair(true)}>Pair a device</button>
        </div>
        {devicesQ.errorMessage && !devicesQ.data && (
          <p className="mt-3 text-[13px] text-mc-orangetext">Couldn't load devices ({devicesQ.errorMessage}).</p>
        )}
        {devicesQ.data && devices.length === 0 ? (
          <EmptyState title="No devices" body="No machines yet. npm run seed:demo adds three sample devices." />
        ) : devicesQ.data ? (
          <ul className="mt-2 divide-y divide-mc-sep">
            {devices.map((d) => {
              const status = deviceStatus(d)
              return (
                <li key={d.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-mc-fill text-mc-sub2" aria-hidden>
                    <span className="h-3 w-5 rounded-sm border-2 border-current" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block wrap-anywhere text-[14.5px] font-semibold">{d.name}</span>
                    <span className="block wrap-anywhere text-[12.5px] text-mc-sub">{d.type}</span>
                  </span>
                  <span className="flex max-w-[16rem] items-center gap-2 text-right text-[12.5px] leading-snug">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.on ? 'var(--mc-green)' : 'var(--mc-gray)' }} />
                    <span className="wrap-anywhere">{status.status}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : !devicesQ.errorMessage ? (
          <p className="mt-3 text-[13px] text-mc-sub">Loading devices…</p>
        ) : null}
      </SoftCard>

      {invite && (
        <Sheet title="Invite a teammate" onClose={() => setInvite(false)}>
          <p className="text-[14px] text-mc-sub2">This build does not send invites. Share the setup guide — they connect with the SSH tunnel in ONBOARDING.md.</p>
          <Link to="/connect" className="mt-4 inline-flex h-8 items-center rounded-lg bg-mc-accent-fill px-3.5 text-[13px] font-semibold text-white" onClick={() => setInvite(false)}>Open setup</Link>
        </Sheet>
      )}
      {pair && (
        <Sheet title="Pair a device" onClose={() => setPair(false)}>
          <p className="text-[14px] text-mc-sub2">Pairing is the SSH tunnel from another machine. Step 7 of setup has the command for your OS and a live API check.</p>
          <Link to="/connect" className="mt-4 inline-flex h-8 items-center rounded-lg bg-mc-accent-fill px-3.5 text-[13px] font-semibold text-white" onClick={() => setPair(false)}>Open setup</Link>
        </Sheet>
      )}
    </div>
  )
}

function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="mc-card w-full max-w-md px-6 py-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="text-[17px] font-semibold">{title}</div>
        <div className="mt-3">{children}</div>
        <button type="button" onClick={onClose} className="mt-4 text-[13px] font-semibold text-mc-sub">Close</button>
      </div>
    </div>
  )
}
