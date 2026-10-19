import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiSend, useApi } from '../hooks/useApi'
import { Card, PillButton, SectionLabel } from '../components/ui'
import { NamingChoice } from '../components/NamingChoice'
import { ProviderStatus, type DetectedModel } from '../components/ProviderStatus'
import { TimezoneSelect } from '../components/TimezoneSelect'
import { Btn } from '../components/shell'
import { useNaming } from '../lib/naming'
import { useSession } from '../lib/session'
import { pluralize } from '../lib/pluralize'
import type { Agent, AgentsResp } from '../types'

/**
 * Settings. Timezone, agent names, and the detected provider.
 * Connection state comes from /health. Log out revokes every session.
 */

interface HealthResp { status: string; uptimeSeconds: number; connectedClients: number; database: string }
interface ModelsResp { models?: DetectedModel[] }

function sourceLabel(source: string | undefined): string {
  if (source === 'snapshot') return 'Snapshot'
  if (source === 'registered') return 'Registered'
  return 'Sample'
}

export default function Settings() {
  const nav = useNavigate()
  const health = useApi<HealthResp>('/health', { pollMs: 15000 })
  const agentsQ = useApi<AgentsResp>('/agents')
  const modelsQ = useApi<ModelsResp>('/models', { pollMs: 15000 })
  const naming = useNaming()
  const h = health.data
  const [zone, setZone] = useState(naming.timezone)
  const [zoneBusy, setZoneBusy] = useState(false)
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [zoneSaved, setZoneSaved] = useState(false)
  const [pending, setPending] = useState<Agent | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const agents = agentsQ.data?.agents ?? []

  async function removeAgent(agent: Agent) {
    setRemoving(true)
    setRemoveError(null)
    const result = await apiSend('DELETE', `/agents/${encodeURIComponent(agent.id)}`)
    setRemoving(false)
    if (!result.ok) {
      setRemoveError('Could not remove the agent. Try again.')
      return
    }
    setPending(null)
    agentsQ.mutate((prev) => (
      prev ? { ...prev, agents: prev.agents.filter((row) => row.id !== agent.id) } : prev
    ))
    agentsQ.refetch()
  }

  async function saveZone() {
    setZoneBusy(true)
    setZoneError(null)
    setZoneSaved(false)
    const message = await naming.save({ timezone: zone })
    setZoneBusy(false)
    if (message) setZoneError(message)
    else setZoneSaved(true)
  }

  async function applyServerZone() {
    setZoneBusy(true)
    setZoneError(null)
    setZoneSaved(false)
    setZone(naming.serverTimeZone)
    const message = await naming.save({ timezone: null })
    setZoneBusy(false)
    if (message) setZoneError(message)
    else setZoneSaved(true)
  }

  const session = useSession()
  const logout = () => {
    const required = session.info.loginRequired
    void session.end().then(() => {
      if (!required) nav('/connect')
    })
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="text-[22px] font-semibold">Settings</div>
      <div className="mt-1 text-[13px] text-mc-sub">Connection state, session and app controls.</div>

      <Card className="mt-6 px-5 py-4" data-settings-agents="true">
        <SectionLabel>Agents</SectionLabel>
        <p className="mt-2 text-[13px] text-mc-sub">
          Any agent can be removed here, including one reported by the bridge. A removed snapshot agent comes back only when a later snapshot includes it.
        </p>
        {removeError && !pending && <p className="mt-3 text-[13px] text-mc-orangetext">{removeError}</p>}
        {agents.length === 0 ? (
          <p className="mt-4 text-[13px] text-mc-sub">No agents yet.</p>
        ) : (
          <ul className="mt-2">
            {agents.map((agent) => (
              <li
                key={agent.id}
                data-agent-id={agent.id}
                data-agent-source={agent.source ?? 'default'}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-mc-border py-3"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">{agent.name}</div>
                  <div className="text-[12px] text-mc-sub">{sourceLabel(agent.source)}</div>
                </div>
                <Btn kind="plain" onClick={() => { setPending(agent); setRemoveError(null) }}>Remove</Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4 px-5 py-4" data-settings-timezone="true">
        <SectionLabel>Timezone</SectionLabel>
        <p className="mt-2 text-[13px] text-mc-sub">
          Usage and memory count each day in this timezone. The server timezone is {naming.serverTimeZone}.
        </p>
        <div className="mt-4">
          <TimezoneSelect id="settings-timezone" value={zone} onChange={(next) => { setZone(next); setZoneSaved(false) }} />
        </div>
        {zoneError && <p className="mt-3 text-[13px] text-mc-orangetext">{zoneError}</p>}
        {zoneSaved && <p className="mt-3 text-[13px] text-mc-greentext">Timezone saved</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn kind="primary" onClick={() => void saveZone()} disabled={zoneBusy}>{zoneBusy ? 'Saving' : 'Save timezone'}</Btn>
          <Btn kind="ghost" onClick={() => void applyServerZone()} disabled={zoneBusy}>Use the server timezone</Btn>
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4">
        <SectionLabel>Connection</SectionLabel>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="w-[12px] h-[12px] rounded-full"
            style={{ backgroundColor: h ? (h.status === 'ok' ? 'var(--mc-green)' : 'var(--mc-red)') : 'var(--mc-faint)' }}
          />
          <div>
            <div className="text-[14px] font-semibold">
              {h ? `API ${h.status === 'ok' ? 'Connected' : 'Degraded'}` : 'Contacting API…'}
            </div>
            <div className="text-[12px] text-mc-sub">
              {h ? `uptime ${Math.floor(h.uptimeSeconds / 60)}m · database ${h.database} · ${pluralize(h.connectedClients, 'client')}` : 'waiting for the API'}
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4">
        <SectionLabel>Agent names</SectionLabel>
        <p className="mt-2 text-[13px] text-mc-sub">
          Each agent gets a crew name and desk. Seats are saved by agent id, and you can change any seat here.
        </p>
        <div className="mt-4">
          <NamingChoice
            key={`${naming.mode ?? 'unset'}:${JSON.stringify(naming.map)}`}
            agents={agentsQ.data?.agents ?? []}
            agentsReady={Boolean(agentsQ.data)}
            initialMode={naming.mode}
            initialMap={naming.map}
            intro={false}
            submitLabel="Save names"
          />
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4" data-settings-provider="true">
        <SectionLabel>Provider</SectionLabel>
        <p className="mt-2 text-[13px] text-mc-sub">
          The bridge reports the provider and model for each agent. This list updates when that snapshot arrives.
        </p>
        <div className="mt-4">
          {!modelsQ.data && modelsQ.loading ? (
            <p className="text-[13px] text-mc-sub">Checking for a provider</p>
          ) : (
            <ProviderStatus models={modelsQ.data?.models ?? []} />
          )}
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4">
        <div data-settings-logout="true" data-logout="settings">
        <SectionLabel>Session</SectionLabel>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-medium">Log out</div>
            <div className="text-[11.5px] text-mc-sub">End this browser and every other session. A remote browser returns to the sign in form.</div>
          </div>
          <PillButton label="Log out" onClick={logout} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-mc-border pt-4" data-settings-revoke="true">
          <div>
            <div className="text-[13.5px] font-medium">Revoke sessions</div>
            <div className="text-[11.5px] text-mc-sub">End every signed in browser. A copied cookie stops working, including after a restart.</div>
          </div>
          <PillButton label="Revoke sessions" onClick={logout} />
        </div>
        </div>
      </Card>

      <p className="mt-6 text-[12px] text-mc-faint">
        A browser on this machine stays open when the API sees a loopback address. Docker Compose asks for the password the installer printed, because the API sees the Docker network, not loopback. From another machine, use the{' '}
        <a
          href="https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/REMOTE.md"
          className="font-semibold text-mc-accent-text"
          target="_blank"
          rel="noreferrer"
        >
          remote access guide
        </a>
        .
      </p>

      {pending && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onClick={() => { if (!removing) setPending(null) }}>
          <div
            className="mc-card w-full max-w-md px-6 py-5"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Remove this agent"
            data-remove-agent={pending.id}
            data-remove-source={pending.source ?? 'default'}
          >
            <div className="text-[17px] font-semibold">Remove this agent?</div>
            <p className="mt-3 text-[14px] text-mc-sub2">
              {pending.name} leaves the roster. A snapshot agent comes back only when the bridge reports it again.
            </p>
            {removeError && <p className="mt-3 text-[13px] text-mc-orangetext">{removeError}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn kind="primary" disabled={removing} onClick={() => void removeAgent(pending)}>
                {removing ? 'Removing' : 'Remove'}
              </Btn>
              <Btn kind="plain" disabled={removing} onClick={() => setPending(null)}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
