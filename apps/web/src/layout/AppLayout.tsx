import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_GROUPS } from '../data/mock'
import { Glyph, type GlyphKind } from '../components/glyphs'
import { Dot } from '../components/ui'
import SearchBox from '../components/SearchBox'
import { useLiveActivity } from '../hooks/useLiveActivity'
import { OPERATOR_NAME, operatorInitial } from '../config'
import { API_URL, socketLabel } from '../lib/apiBase'
import { reportLatency, reportOutcome, reportUnreachable, useApiStatus } from '../lib/apiStatus'

/**
 * AppLayout — the shell every screen shares (wireframe sidebar() + topbar()).
 * Sidebar: WORKSPACE / TEAM / OBSERVE groups, Settings footer w/ connection state.
 * Topbar: page title · search · Connected · theme toggle (sun/moon) · avatar.
 * Connection indicator (QA-1 polish item 7 / QA-3) — REAL status, no more
 * hardcoded "Connected · 74ms" / "ws://…:3000":
 *  - reachability comes from the shared apiStatus store (every request
 *    reports into it) plus a /health heartbeat that also measures latency;
 *  - the live-feed socket state says whether updates are pushed ("Connected")
 *    or only polled ("API only");
 *  - the endpoint label is derived from the configured API_URL.
 * When the API drops mid-session an inline notice says the page's data may
 * be stale, instead of silently showing old numbers.
 */

/** Heartbeat cadence and per-beat ceiling (a hung API counts as down). */
const HEARTBEAT_MS = 5000
const HEARTBEAT_TIMEOUT_MS = 4000
/** First beat waits a moment: lets StrictMode's throw-away mount be cleaned
 *  up BEFORE any request starts (so nothing is aborted — QA-3 ERR_ABORTED). */
const FIRST_BEAT_DELAY_MS = 300

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
  '/projects': 'Projects',
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
  // /projects/:id is not a static key. The page itself prints the project name.
  const title = pathname.startsWith('/projects/')
    ? 'Project'
    : (TITLES[pathname] ?? 'Mission Control')
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

  // Heartbeat + onboarding gate (QA-1 polish item 7 / QA-3).
  //
  // Old version: a one-shot /health fetch in an effect that depended on
  // `nav`. react-router hands out a NEW navigate function on every location
  // change, so the effect re-ran (aborting the in-flight request → the
  // ERR_ABORTED QA saw on every page load) and never measured anything.
  // Now: mount-once effect (navigate read through a ref), a repeating
  // GET /health against the configured API_URL that
  //   - reports latency / reachability to the shared apiStatus store,
  //   - on the FIRST beat only, keeps the old gate: API unreachable → send
  //     the user to /connect (explains the SSH tunnel) instead of an empty
  //     shell. Later drops show the stale-data notice instead — yanking a
  //     user to the setup guide mid-session would be worse.
  // Our own aborts (unmount, StrictMode) are never reported as failures.
  const navRef = useRef(nav)
  useEffect(() => {
    navRef.current = nav
  }, [nav])
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
          // Answered but unhappy (e.g. 500) = reachable; 502-504 = down.
          reportOutcome(res.status, `GET /health returned HTTP ${res.status}`)
        }
      } catch {
        // Unmount/StrictMode abort: our doing, not an outage — report nothing.
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

  // ── Status shown in the sidebar footer and the top bar (item 7) ────────
  // Only existing tokens: green/red dot as before, faint while unknown.
  const api = useApiStatus()
  const ms = api.latencyMs !== null ? ` · ${api.latencyMs}ms` : ''
  const status =
    api.state === 'offline'
      ? { dot: 'var(--mc-red)', label: 'Offline', title: api.lastError ?? 'API unreachable' }
      : api.state === 'unknown'
        ? { dot: 'var(--mc-faint)', label: 'Connecting…', title: `Contacting ${API_URL}` }
        : connected
          ? { dot: 'var(--mc-green)', label: `Connected${ms}`, title: `API ${API_URL} · live feed connected` }
          : // API answers but the websocket is down: data still refreshes by
            // polling, just not instantly — say so rather than "Connected".
            { dot: 'var(--mc-green)', label: `API only${ms}`, title: `API ${API_URL} · live feed reconnecting (pages refresh by polling)` }

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
              <span className="flex items-center gap-1.5 text-[11.5px] text-mc-sub" title={status.title}>
                <Dot color={status.dot} size={5} />
                {status.label}
              </span>
              {/* Derived from the configured API_URL — was hardcoded :3000. */}
              <span className="text-[11px] text-mc-faint">{socketLabel()}</span>
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
            <span className="flex items-center gap-2 text-[12px] text-mc-sub" title={status.title}>
              <Dot color={status.dot} size={5} />
              {status.label}
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

        {/* API dropped mid-session (item 7): pages keep their last data, so
            SAY it may be stale. Same notice look as the Tickets/Backlog
            notices (orange bg/text) — no new design. Clears on next contact. */}
        {api.state === 'offline' && (
          <div role="alert" className="mx-6 mt-4 shrink-0 rounded-[10px] bg-mc-orangebg px-4 py-2 text-[12.5px] text-mc-orangetext">
            {/* Reason in parentheses: messages may end in "?" or "." already. */}
            Can't reach the API at {API_URL} ({api.lastError ?? 'no response'}). Data on this page may be out of date
            {api.lastOkAt ? ` (last update ${new Date(api.lastOkAt).toLocaleTimeString()})` : ''}; retrying automatically.
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
