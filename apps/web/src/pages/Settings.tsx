import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { Card, PillButton, SectionLabel } from '../components/ui'
import { NamingChoice } from '../components/NamingChoice'
import { ProviderStatus, type DetectedModel } from '../components/ProviderStatus'
import { TimezoneSelect } from '../components/TimezoneSelect'
import { Btn } from '../components/shell'
import { useNaming } from '../lib/naming'
import { useSession } from '../lib/session'
import { pluralize } from '../lib/pluralize'
import type { AgentsResp } from '../types'

/**
 * Settings. Timezone, agent names, and the detected provider.
 * Connection state comes from /health. Log out revokes every session.
 */

interface HealthResp { status: string; uptimeSeconds: number; connectedClients: number; database: string }
interface ModelsResp { models?: DetectedModel[] }

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

      <Card className="mt-6 px-5 py-4" data-settings-timezone="true">
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
              {h ? `uptime ${Math.floor(h.uptimeSeconds / 60)}m · database ${h.database} · ${pluralize(h.connectedClients, 'client')}` : 'check your SSH tunnel'}
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4">
        <SectionLabel>Agent names</SectionLabel>
        <p className="mt-2 text-[13px] text-mc-sub">
          Crew seats come from the saved crew file and apply by agent id. Own names shows each agent as registered.
        </p>
        <div className="mt-4">
          <NamingChoice
            key={`${naming.mode ?? 'unset'}:${JSON.stringify(naming.map)}`}
            agents={agentsQ.data?.agents ?? []}
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
        A browser on this machine stays open when the API sees a loopback address. Docker Compose asks for the password the installer printed, because the API sees the Docker network, not loopback. Setup lives on the Connect page.
      </p>
    </div>
  )
}
