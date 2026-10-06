import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import type { AgentsResp } from '../types'
import { PageHeader, SoftCard, Btn, Face, StatusChip, Kicker, EmptyState } from '../components/shell'
import { OPERATOR_NAME, operatorInitial } from '../config'

/**
 * Team — the mission, the person who owns the dashboard, the agents (a link
 * to the roster), and the machines we can actually see. Invite and pairing
 * open this page's own sheets; they do not create accounts.
 */

const MISSION_KEY = 'mc-mission'
const DEFAULT_MISSION = 'Ship an open-source mission control anyone can clone and run in five minutes.'

interface SystemResp {
  os: { hostname: string; platform: string }
}

export default function Team() {
  const agentsQ = useApi<AgentsResp>('/agents', { pollMs: 30000 })
  const sys = useApi<SystemResp>('/system', { pollMs: 30000 })
  const agents = agentsQ.data?.agents ?? []
  const working = agents.filter((a) => a.status === 'working').length
  const [mission, setMission] = useState(() => localStorage.getItem(MISSION_KEY) || DEFAULT_MISSION)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(mission)
  const [invite, setInvite] = useState(false)
  const [pair, setPair] = useState(false)
  const owner = OPERATOR_NAME || 'Operator'
  const initial = operatorInitial() ?? owner.slice(0, 1).toUpperCase()

  function saveMission() {
    const next = draft.trim() || DEFAULT_MISSION
    setMission(next)
    try { localStorage.setItem(MISSION_KEY, next) } catch { /* ignore */ }
    setEditing(false)
  }

  const devices: { name: string; desc: string; on: boolean; status: string }[] = [
    { name: 'This browser', desc: 'The dashboard you are looking at', on: true, status: 'Online · now' },
  ]
  if (sys.data?.os?.hostname) {
    devices.unshift({
      name: sys.data.os.hostname,
      desc: `API host · ${sys.data.os.platform}`,
      on: true,
      status: 'Online · now',
    })
  }

  return (
    <div>
      <PageHeader
        title="Team"
        summary={`${owner} + ${agents.length} agents · ${devices.filter((d) => d.on).length} online`}
        tools={<Btn kind="primary" onClick={() => setInvite(true)}>Invite</Btn>}
      />

      <SoftCard className="px-7 py-6">
        <div className="flex items-center justify-between">
          <Kicker>Mission</Kicker>
          <button type="button" className="text-[13px] font-semibold text-mc-accent-text" onClick={() => { setDraft(mission); setEditing(true) }}>Edit</button>
        </div>
        {editing ? (
          <div className="mt-3">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Mission" className="h-20 w-full rounded-lg bg-mc-ctl px-3 py-2 text-[16px] outline-none" />
            <div className="mt-2 flex gap-2">
              <Btn kind="primary" onClick={saveMission}>Save</Btn>
              <Btn kind="plain" onClick={() => setEditing(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[20px] font-semibold tracking-tight">{mission}</p>
            <p className="mt-2 text-[13px] text-mc-sub">Agents see this as the line under the work. Saved in this browser.</p>
          </>
        )}
      </SoftCard>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SoftCard className="px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">People</span>
            <span className="text-[12.5px] text-mc-sub">1 person</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#6e6e73] text-[16px] font-semibold text-white">{initial}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{owner}</div>
              <div className="text-[12.5px] text-mc-sub">Owner · approves deploys and merges</div>
            </div>
            <StatusChip label="You" tone="blue" />
          </div>
          <button type="button" onClick={() => setInvite(true)} className="mt-5 text-[13px] font-semibold text-mc-accent-text">
            Invite a teammate <span className="font-medium text-mc-sub">to share approvals</span>
          </button>
        </SoftCard>

        <SoftCard className="px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">Agents</span>
            <span className="text-[12.5px] text-mc-sub">{agents.length} · {working} working</span>
          </div>
          {agents.length === 0 ? (
            <p className="mt-4 text-[13px] text-mc-sub">No agents yet. Seed or connect the bridge.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {agents.slice(0, 12).map((agent) => (
                <Face key={agent.id} agent={agent} agents={agents} px={46} />
              ))}
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
        {devices.length === 0 ? (
          <EmptyState title="No devices" body="The API host shows up here when /system answers." />
        ) : (
          <ul className="mt-2 divide-y divide-mc-sep">
            {devices.map((d) => (
              <li key={d.name} className="flex items-center gap-3 py-3">
                <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-mc-fill text-mc-sub2" aria-hidden>
                  <span className="h-3 w-5 rounded-sm border-2 border-current" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">{d.name}</span>
                  <span className="block text-[12.5px] text-mc-sub">{d.desc}</span>
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap text-[12.5px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: d.on ? 'var(--mc-green)' : 'var(--mc-gray)' }} />
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
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
