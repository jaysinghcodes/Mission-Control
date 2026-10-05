import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_GROUPS } from '../data/mock'
import { Glyph, type GlyphKind } from '../components/glyphs'
import { Dot } from '../components/ui'
import SearchBox from '../components/SearchBox'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { OPERATOR_NAME, operatorInitial } from '../config'

/**
 * AppLayout — the shell every screen shares (wireframe sidebar() + topbar()).
 * Sidebar: WORKSPACE / TEAM / OBSERVE groups, Settings footer w/ connection state.
 * Topbar: page title · search · Connected · theme toggle (sun/moon) · avatar.
 * The Live Activity socket drives the honest connection indicator.
 */

function useTheme() {
  const [light, setLight] = useState(() => localStorage.getItem('mc-theme') === 'light')
  useEffect(() => {
    document.documentElement.classList.toggle('light', light)
    localStorage.setItem('mc-theme', light ? 'light' : 'dark')
  }, [light])
  return { light, toggle: () => setLight((v) => !v) }
}

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/tasks': 'Tasks',
  '/tickets': 'Tickets',
  '/backlog': 'Backlog',
  '/calendar': 'Calendar',
  '/approvals': 'Approvals',
  '/team': 'Team',
  '/agents': 'Team',
  '/office': 'Office',
  '/activity': 'Live Activity',
  '/health': 'Health',
  '/sessions': 'Sessions',
  '/usage': 'Usage & Cost',
  '/logs': 'Logs',
}

export default function AppLayout() {
  const { light, toggle } = useTheme()
  const { connected } = useLiveActivity()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const title = TITLES[pathname] ?? 'Mission Control'
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the avatar menu on outside click / Escape.
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

  // Onboarding gate: if the API is unreachable, send the user to the
  // Connect page (it explains the SSH tunnel) instead of an empty shell.
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/health`, { signal: ctrl.signal })
        .then((r) => { if (!r.ok) nav('/connect') })
        .catch(() => nav('/connect'))
    }, 1200)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [nav])

  return (
    <div className="flex h-screen bg-mc-bg text-mc-text">
      {/* ── Sidebar (220px, wireframe sidebar()) ─────────────────────────── */}
      <aside className="w-[220px] shrink-0 bg-mc-sidebar border-r border-mc-sideborder flex flex-col">
        <div className="flex items-center gap-2.5 px-5 pt-[22px] pb-4">
          <Link to="/" className="flex items-center gap-2.5" title="Back to Overview">
            <img src="/logo.svg" alt="Mission Control" className="w-[26px] h-[26px] rounded-lg" />
            <div className="text-[15px] font-semibold text-mc-text">Mission Control</div>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="px-1.5 mt-6 mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 h-[34px] px-2.5 rounded-lg text-[13.5px] transition-colors duration-150 ${
                        isActive ? 'bg-mc-primary text-white font-semibold' : 'text-mc-text hover:bg-white/5'
                      }`
                    }
                  >
                    <Glyph kind={item.key as GlyphKind} size={16} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar footer — Settings + connection (wireframe footer) */}
        <div className="px-5 pb-5 pt-4 border-t border-mc-sideborder">
          <div className="rounded-[10px] bg-mc-sidebar2 px-3 py-2.5">
            <div className="text-[13px] font-medium text-mc-text">⚙ Settings</div>
            <Link to="/connect" className="mt-1 block text-[11.5px] text-mc-sub hover:text-mc-text">
              Setup guide · SSH tunnel
            </Link>
            <div className="flex items-center justify-between mt-1.5">
              <span className="flex items-center gap-1.5 text-[11.5px] text-mc-sub">
                <Dot color={connected ? 'var(--mc-green)' : 'var(--mc-red)'} size={5} />
                {connected ? 'Connected · 74ms' : 'Offline'}
              </span>
              <span className="text-[11px] text-mc-faint">ws://…:3000</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 bg-mc-topbar border-b border-mc-border2 flex items-center px-6 justify-between">
          <div className="text-[17px] font-semibold">{title}</div>
          <div className="flex items-center gap-4">
            <SearchBox w={200} />
            <span className="flex items-center gap-2 text-[12px] text-mc-sub">
              <Dot color={connected ? 'var(--mc-green)' : 'var(--mc-red)'} size={5} />
              Connected
            </span>
            <div className="w-px h-6 bg-mc-border2" />
            {/* Theme toggle — sun in dark (click → light), moon in light */}
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="w-10 h-8 rounded-full bg-mc-inner border border-mc-border flex items-center justify-center text-mc-sub hover:text-mc-text"
            >
              {light ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.7" />
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
                    const r = (a * Math.PI) / 180
                    return (
                      <line
                        key={a}
                        x1={8 + 8.5 * Math.cos(r)} y1={8 + 8.5 * Math.sin(r)}
                        x2={8 + 11.5 * Math.cos(r)} y2={8 + 11.5 * Math.sin(r)}
                        stroke="currentColor" strokeWidth="1.7"
                      />
                    )
                  })}
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="9.5" cy="10.5" r="4.4" fill="var(--mc-inner)" stroke="none" />
                </svg>
              )}
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="Account menu"
                title={OPERATOR_NAME || 'Account'}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
                className="w-8 h-8 rounded-full bg-mc-primary text-white flex items-center justify-center text-[13px] font-semibold ring-1 ring-mc-border hover:opacity-90 cursor-pointer"
              >
                {/* Operator initial from VITE_OPERATOR_NAME; generic person
                    glyph when unset (was a hardcoded "J" — ticket 3). */}
                {operatorInitial() ?? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M2.5 14c.8-2.8 3-4.2 5.5-4.2s4.7 1.4 5.5 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-mc-border bg-mc-card shadow-lg py-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); nav('/settings') }}
                    className="w-full text-left px-4 py-2 text-[13px] text-mc-text hover:bg-white/5 flex items-center gap-2"
                  >
                    ⚙ Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      localStorage.removeItem('mc-connected')
                      nav('/connect')
                    }}
                    className="w-full text-left px-4 py-2 text-[13px] text-mc-redtext hover:bg-white/5 flex items-center gap-2"
                  >
                    ⏻ Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
