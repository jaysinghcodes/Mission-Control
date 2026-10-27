import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApi, apiSend } from '../hooks/useApi'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { deriveLiveWork, type LiveRun, type LiveTicket } from '../lib/live-work'
import { useRosterLive } from '../lib/useRosterLive'
import { useWorkLive } from '../lib/useWorkLive'
import type { AgentsResp } from '../types'
import { PageHeader, SoftCard, Btn, AgentName, Kicker, EmptyState, FieldError } from '../components/shell'
import { RosterRobot, SampleTag } from '../components/rosterMarks'
import { OPERATOR_NAME } from '../config'
import { formatZoneSaved } from '../lib/zone-day'
import { deviceStatus } from '../lib/device-status'
import { useNaming } from '../lib/naming'
import { pluralize } from '../lib/pluralize'
import { OFFLINE_LABEL, isRegisteredOffline, showSampleTag } from '../lib/sample-roster'
import { useRosterView } from '../lib/useSampleRoster'
import { DEVICE_COPY, DEVICE_NAME_MAX, DEVICE_TYPES, DEVICE_TYPE_LABEL, deviceDraftError, type DeviceType } from '../lib/device-form'
import { useDevicesLive } from '../lib/useDevicesLive'

/**
 * Team. Mission, people, and devices, filled from the API.
 * Mission and devices are rows in Postgres. People are the roster robots
 * from GET /agents, captioned Name · Function, each linking to Agents.
 * Invite is a sheet that does not create accounts. Pair a device is a
 * short form that posts a manual device. Each device row can be removed.
 * Create and delete broadcast devices.snapshot, so open tabs refetch.
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
  pairedAt?: string | null
  requestedAt?: string | null
  source?: string | null
}

interface DevicesResp {
  devices: DeviceRow[]
}

export default function Team() {
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const ticketsQ = useApi<{ tickets: LiveTicket[] }>('/tickets', { pollMs: 20000 })
  const runsQ = useApi<{ runs: LiveRun[] }>('/runs', { pollMs: 20000 })
  const missionQ = useApi<MissionResp>('/mission')
  const devicesQ = useApi<DevicesResp>('/devices', { pollMs: 30000 })
  const { events, connected } = useLiveActivity()
  useRosterLive(events, agentsQ.refetch, connected)
  useWorkLive(events, ticketsQ.refetch, runsQ.refetch)
  useDevicesLive(events, devicesQ.refetch)
  const agents = agentsQ.data?.agents ?? []
  const { visible: roster, now } = useRosterView(agents)
  const naming = useNaming()
  const tickets = ticketsQ.data?.tickets ?? []
  const runs = runsQ.data?.runs ?? []
  const people = naming.order(roster)
  const liveFor = (agent: (typeof roster)[number]) => deriveLiveWork(agent, tickets, runs)
  const working = roster.filter((a) => liveFor(a).working && !isRegisteredOffline(a, now)).length
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
  const [deviceName, setDeviceName] = useState('')
  const [deviceType, setDeviceType] = useState<DeviceType>('laptop')
  const [pairing, setPairing] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
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

  function openPair() {
    setDeviceName('')
    setDeviceType('laptop')
    setPairError(null)
    setPair(true)
  }

  async function saveDevice() {
    const problem = deviceDraftError(deviceName, deviceType)
    if (problem) {
      setPairError(problem)
      return
    }
    setPairing(true)
    setPairError(null)
    const r = await apiSend<{ device: DeviceRow }>('POST', '/devices', { name: deviceName.trim(), type: deviceType })
    setPairing(false)
    if (!r.ok || !r.data) {
      setPairError(r.error ?? 'Could not save the device')
      return
    }
    const added = r.data.device
    devicesQ.mutate((prev) => (prev ? { ...prev, devices: sortDevices([...prev.devices.filter((d) => d.id !== added.id), added]) } : { devices: [added] }))
    setPair(false)
    void devicesQ.refetch()
  }

  async function removeDevice(id: string) {
    setRemoving(id)
    setRemoveError(null)
    const r = await apiSend<null>('DELETE', `/devices/${encodeURIComponent(id)}`)
    setRemoving(null)
    if (!r.ok && r.status !== 404) {
      setRemoveError(r.error ?? 'Could not remove the device')
      return
    }
    devicesQ.mutate((prev) => (prev ? { ...prev, devices: prev.devices.filter((d) => d.id !== id) } : prev))
    void devicesQ.refetch()
  }

  return (
    <div>
      <PageHeader
        title="Team"
        summary={`${owner} + ${pluralize(roster.length, 'agent')} · ${pluralize(online, 'online', 'online')}`}
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
            <span className="text-[12.5px] text-mc-sub">{pluralize(people.length, 'person', 'people')}</span>
          </div>
          {!agentsQ.data && agentsQ.loading ? (
            <p className="mt-4 text-[13px] text-mc-sub">Loading people…</p>
          ) : people.length === 0 ? (
            <p className="mt-4 text-[13px] text-mc-sub">No agents yet. Connect the OpenClaw bridge, or run npm run seed:demo.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
              {people.map((agent) => {
                const cap = naming.present(agent)
                const offline = isRegisteredOffline(agent, now)
                const live = liveFor(agent)
                const line = offline ? OFFLINE_LABEL : live.subtitle
                return (
                  <li key={agent.id} data-agent-id={agent.id} data-crew-name={cap.name} data-offline={offline ? 'true' : 'false'} data-live-room={live.room} data-live-subtitle={line} data-live-source={live.source}>
                    <Link to="/agents" className="flex shrink-0 items-center gap-2" aria-label={`${cap.name} · ${cap.role}, ${line}`}>
                      <RosterRobot agent={agent} agents={agents} px={36} now={now} status={live.working ? 'working' : 'idle'} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1">
                          <AgentName agent={agent} size="md" />
                          {showSampleTag(agent) && <SampleTag />}
                        </span>
                        {cap.desk ? <span className="block text-[11px] text-mc-sub">{cap.desk}</span> : null}
                        {offline ? (
                          <span className="block text-[11px] text-mc-sub">{OFFLINE_LABEL}</span>
                        ) : line !== 'Idle' ? (
                          <span className="block text-[11px] text-mc-sub">{line}</span>
                        ) : null}
                      </span>
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
            <span className="text-[12.5px] text-mc-sub">{pluralize(roster.length, 'agent')} · {pluralize(working, 'working', 'working')}</span>
          </div>
          {!agentsQ.data && agentsQ.loading ? (
            <p className="mt-4 text-[13px] text-mc-sub">Loading agents…</p>
          ) : roster.length === 0 ? (
            <p className="mt-4 text-[13px] text-mc-sub">No agents yet. Connect the OpenClaw bridge, or run npm run seed:demo.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {people.map((agent) => {
                const cap = naming.present(agent)
                const offline = isRegisteredOffline(agent, now)
                const live = liveFor(agent)
                const line = offline ? OFFLINE_LABEL : live.subtitle
                return (
                  <Link key={agent.id} to="/agents" data-agent-id={agent.id} data-live-room={live.room} data-live-subtitle={line} aria-label={`${cap.name} · ${cap.role}, ${line}`} className="flex flex-col items-center rounded-lg">
                    <RosterRobot agent={agent} agents={agents} px={46} now={now} status={live.working ? 'working' : 'idle'} />
                    {showSampleTag(agent) && <SampleTag />}
                    {(offline || line !== 'Idle') && <span className="text-[11px] text-mc-sub">{offline ? OFFLINE_LABEL : line}</span>}
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
          <button type="button" className="text-[13px] font-semibold text-mc-accent-text" onClick={openPair}>Pair a device</button>
        </div>
        {devicesQ.errorMessage && !devicesQ.data && (
          <p className="mt-3 text-[13px] text-mc-orangetext">Couldn't load devices ({devicesQ.errorMessage}).</p>
        )}
        {devicesQ.data && devices.length === 0 ? (
          <EmptyState title={DEVICE_COPY.emptyTitle} body={DEVICE_COPY.emptyBody} />
        ) : devicesQ.data ? (
          <ul className="mt-2 divide-y divide-mc-sep">
            {devices.map((d) => {
              const status = deviceStatus(d, formatZoneSaved)
              return (
                <li key={d.id} data-device-id={d.id} data-device-source={d.source ?? ''} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-mc-fill text-mc-sub2" aria-hidden>
                    <span className="h-3 w-5 rounded-sm border-2 border-current" />
                  </span>
                  <span className="min-w-[8rem] flex-1">
                    <span className="block wrap-anywhere text-[14.5px] font-semibold">{d.name}</span>
                    <span className="block wrap-anywhere text-[12.5px] text-mc-sub">{d.type}</span>
                  </span>
                  <span className="flex w-full items-center gap-3 pl-[52px] sm:w-auto sm:pl-0">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] leading-snug sm:max-w-[16rem] sm:flex-none sm:text-right">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.on ? 'var(--mc-green)' : 'var(--mc-gray)' }} />
                    <span className="wrap-anywhere">{status.status}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[12.5px] font-semibold text-mc-sub disabled:opacity-50"
                    onClick={() => void removeDevice(d.id)}
                    disabled={removing === d.id}
                    aria-label={`Remove ${d.name}`}
                  >
                    {DEVICE_COPY.remove}
                  </button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : !devicesQ.errorMessage ? (
          <p className="mt-3 text-[13px] text-mc-sub">Loading devices…</p>
        ) : null}
        {removeError && <FieldError>{removeError}</FieldError>}
      </SoftCard>

      {invite && (
        <Sheet title="Invite a teammate" onClose={() => setInvite(false)}>
          <p className="text-[14px] text-mc-sub2">This build does not send invites. Share the remote access guide. SSH, Tailscale, and Cloudflare Tunnel are in that guide.</p>
          <a href="https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/REMOTE.md" className="mt-4 inline-flex h-8 items-center rounded-lg bg-mc-accent-fill px-3.5 text-[13px] font-semibold text-white" target="_blank" rel="noreferrer">Remote access guide</a>
        </Sheet>
      )}
      {pair && (
        <Sheet title="Pair a device" onClose={() => setPair(false)} closeButton={false}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void saveDevice()
            }}
          >
            <p className="text-[14px] text-mc-sub2">{DEVICE_COPY.formLead}</p>
            <label className="mt-4 block text-[13px] font-semibold" htmlFor="pair-device-name">{DEVICE_COPY.nameLabel}</label>
            <input
              id="pair-device-name"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              maxLength={DEVICE_NAME_MAX}
              autoFocus
              autoComplete="off"
              placeholder="Kitchen laptop"
              className="mt-1 h-9 w-full rounded-lg bg-mc-ctl px-3 text-[16px] outline-none"
            />
            <label className="mt-3 block text-[13px] font-semibold" htmlFor="pair-device-type">{DEVICE_COPY.typeLabel}</label>
            <select
              id="pair-device-type"
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value as DeviceType)}
              className="mt-1 h-9 w-full rounded-lg bg-mc-ctl px-3 text-[16px] text-mc-text outline-none"
            >
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>{DEVICE_TYPE_LABEL[t]}</option>
              ))}
            </select>
            {pairError && <FieldError>{pairError}</FieldError>}
            <div className="mt-4 flex gap-2">
              <Btn kind="primary" type="submit" disabled={pairing}>{pairing ? DEVICE_COPY.saving : DEVICE_COPY.save}</Btn>
              <Btn kind="plain" onClick={() => setPair(false)}>{DEVICE_COPY.cancel}</Btn>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  )
}

function sortDevices(rows: DeviceRow[]): DeviceRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

function Sheet({ title, children, onClose, closeButton = true }: { title: string; children: ReactNode; onClose: () => void; closeButton?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="mc-card w-full max-w-md px-6 py-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="text-[17px] font-semibold">{title}</div>
        <div className="mt-3">{children}</div>
        {closeButton && <button type="button" onClick={onClose} className="mt-4 text-[13px] font-semibold text-mc-sub">Close</button>}
      </div>
    </div>
  )
}
