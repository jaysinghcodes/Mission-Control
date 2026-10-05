import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { Card, PillButton, SectionLabel } from '../components/ui'

/**
 * Settings — account & app controls (review fix: avatar menu → Settings).
 * Real, live content only: connection state from /health, theme from the
 * shared topbar toggle, and a Log out that clears the onboarding gate.
 */

interface HealthResp { status: string; uptimeSeconds: number; connectedClients: number; database: string }

export default function Settings() {
  const nav = useNavigate()
  const health = useApi<HealthResp>('/health', { pollMs: 15000 })
  const h = health.data

  const logout = () => {
    localStorage.removeItem('mc-connected')
    nav('/connect')
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="text-[22px] font-semibold">Settings</div>
      <div className="mt-1 text-[13px] text-mc-sub">Connection state, session and app controls.</div>

      <Card className="mt-6 px-5 py-4">
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
              {h ? `uptime ${Math.floor(h.uptimeSeconds / 60)}m · database ${h.database} · ${h.connectedClients} client(s)` : 'check your SSH tunnel'}
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-4 px-5 py-4">
        <SectionLabel>Session</SectionLabel>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-medium">Log out</div>
            <div className="text-[11.5px] text-mc-sub">Disconnect this browser and return to the setup gate.</div>
          </div>
          <PillButton label="Log out" onClick={logout} />
        </div>
      </Card>

      <p className="mt-6 text-[12px] text-mc-faint">
        Mission Control binds to loopback only — the SSH tunnel is the sanctioned way in. Setup guide lives on the Connect page.
      </p>
    </div>
  )
}
