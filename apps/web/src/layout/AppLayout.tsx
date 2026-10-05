import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { useApi } from '../hooks/useApi'
import { OPERATOR_NAME } from '../config'
import { API_URL } from '../lib/apiBase'
import { reportLatency, reportOutcome, reportUnreachable, useApiStatus } from '../lib/apiStatus'

/**
 * Shared Apple window: vibrancy sidebar, traffic lights, account chip.
 * Connection text is one nowrap line in the sidebar (it used to wrap in the
 * top bar at ~768px). Theme follows the system until a manual choice is saved.
 */

const HEARTBEAT_MS = 5000
const HEARTBEAT_TIMEOUT_MS = 4000
const FIRST_BEAT_DELAY_MS = 300

type ThemeChoice = 'system' | 'light' | 'dark'

function readTheme(): ThemeChoice {
  const s = localStorage.getItem('mc-theme')
  if (s === 'light' || s === 'dark' || s === 'system') return s
  return 'system'
}

function applyTheme(choice: ThemeChoice) {
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = choice === 'dark' || (choice === 'system' && systemDark)
  document.documentElement.classList.toggle('light', !dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)
  useEffect(() => {
    applyTheme(choice)
    localStorage.setItem('mc-theme', choice)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(choice)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])
  return { choice, setChoice }
}

const NAV: { label: string; items: { label: string; path: string }[] }[] = [
  {
    label: 'Mission Control',
    items: [
      { label: 'Tasks', path: '/tasks' },
      { label: 'Agents', path: '/agents' },
      { label: 'Approvals', path: '/approvals' },
      { label: 'Projects', path: '/projects' },
      { label: 'Office', path: '/office' },
      { label: 'Pipeline', path: '/pipeline' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { label: 'Calendar', path: '/calendar' },
      { label: 'Memory', path: '/memory' },
      { label: 'Docs', path: '/docs' },
      { label: 'Team', path: '/team' },
      { label: 'System', path: '/system' },
    ],
  },
]

export default function AppLayout() {
  const { choice, setChoice } = useTheme()
  const { connected } = useLiveActivity()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const approvals = useApi<{ approvals: { id: string }[] }>('/approvals', { pollMs: 15000 })
  const needs = approvals.data?.approvals.length ?? 0

  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const navRef = useRef(nav)
  useEffect(() => { navRef.current = nav }, [nav])
  useEffect(() => {
    let cancelled = false
    let first = true
    let ctrl: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    async function beat() {
      ctrl = new AbortController()
      let timedOut = false
      const ceiling = setTimeout(() => {
        timedOut = true
        ctrl?.abort()
      }, HEARTBEAT_TIMEOUT_MS)
      const t0 = performance.now()
      let ok = false
      try {
        const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          reportLatency(performance.now() - t0)
          ok = true
        } else {
          reportOutcome(res.status, `GET /health returned HTTP ${res.status}`)
        }
      } catch {
        if (cancelled) return
        reportUnreachable(timedOut ? `no answer within ${HEARTBEAT_TIMEOUT_MS / 1000} s` : 'API unreachable — is the server running?')
      } finally {
        clearTimeout(ceiling)
      }
      if (first) {
        first = false
        if (!ok) {
          navRef.current('/connect')
          return
        }
      }
      timer = setTimeout(() => void beat(), HEARTBEAT_MS)
    }

    timer = setTimeout(() => void beat(), FIRST_BEAT_DELAY_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ctrl?.abort()
    }
  }, [])

  const api = useApiStatus()
  const ms = api.latencyMs !== null ? ` · ${api.latencyMs}ms` : ''
  const status =
    api.state === 'offline'
      ? { dot: 'var(--mc-red)', label: 'Offline', title: api.lastError ?? 'API unreachable' }
      : api.state === 'unknown'
        ? { dot: 'var(--mc-gray)', label: 'Connecting…', title: `Contacting ${API_URL}` }
        : connected
          ? { dot: 'var(--mc-green)', label: `Connected${ms}`, title: `API ${API_URL} · live feed connected` }
          : { dot: 'var(--mc-green)', label: `API only${ms}`, title: `API ${API_URL} · live feed reconnecting (pages refresh by polling)` }

  const account = OPERATOR_NAME || 'Operator'
  const onTasks = pathname === '/tasks' || pathname === '/tickets' || pathname === '/backlog'

  return (
    <div className="h-full bg-[var(--mc-desk)] p-3 sm:p-4">
      <div className="mc-window flex h-full min-h-0 overflow-hidden">
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-mc-sideborder bg-mc-sidebar">
          <div className="flex items-center gap-2 px-4 pt-4">
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} aria-hidden />
            ))}
          </div>
          <nav className="mc-scroll mt-4 flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Primary">
            {NAV.map((group) => (
              <div key={group.label} className="mb-2">
                <div className="px-2.5 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-mc-sub">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => {
                      const on = isActive || (item.path === '/tasks' && onTasks) || (item.path === '/system' && pathname.startsWith('/system'))
                      return `mb-0.5 flex h-8 items-center rounded-lg px-3 text-[14px] ${
                        on ? 'bg-mc-accent font-medium text-white' : 'text-mc-text hover:bg-black/5'
                      }`
                    }}
                  >
                    {({ isActive }) => {
                      const on = isActive || (item.path === '/tasks' && onTasks) || (item.path === '/system' && pathname.startsWith('/system'))
                      const badge = item.label === 'Approvals' && needs > 0 ? needs : 0
                      return (
                        <>
                          <span className="flex-1">{item.label}</span>
                          {badge > 0 && (
                            <span
                              className={`grid h-[18px] min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold ${
                                on ? 'bg-white text-mc-red' : 'bg-mc-red text-white'
                              }`}
                            >
                              {badge}
                            </span>
                          )}
                        </>
                      )
                    }}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="relative border-t border-mc-sideborder px-3 py-3">
            <button
              type="button"
              aria-label="Account menu"
              title={account}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-black/5"
            >
              <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{account}</span>
                <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-mc-sub" title={status.title}>
                  <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: status.dot }} />
                  {status.label}
                </span>
              </span>
            </button>
            {menuOpen && (
              <div
                className="absolute bottom-16 left-3 z-50 w-[200px] rounded-xl border border-mc-border bg-mc-card p-1.5 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-mc-sub">Appearance</div>
                {(['system', 'light', 'dark'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { setChoice(opt); setMenuOpen(false) }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] ${choice === opt ? 'bg-mc-sel font-semibold' : 'hover:bg-mc-hover'}`}
                  >
                    {opt === 'system' ? 'System' : opt === 'light' ? 'Light' : 'Dark'}
                    {choice === opt && <span className="text-mc-accent">✓</span>}
                  </button>
                ))}
                <button type="button" onClick={() => { setMenuOpen(false); nav('/system/settings') }} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-mc-hover">
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    localStorage.removeItem('mc-connected')
                    nav('/connect')
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-mc-red hover:bg-mc-hover"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {api.state === 'offline' && (
            <div role="alert" className="mx-6 mt-4 shrink-0 rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
              Can't reach the API at {API_URL} ({api.lastError ?? 'no response'}). Data on this page may be out of date
              {api.lastOkAt ? ` (last update ${new Date(api.lastOkAt).toLocaleTimeString()})` : ''}; retrying automatically.
            </div>
          )}
          <main className="mc-scroll min-h-0 flex-1 overflow-y-auto px-7 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
