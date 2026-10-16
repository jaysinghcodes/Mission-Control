import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { API_URL } from './apiBase'

/**
 * Dashboard session. Loopback reports loginRequired false.
 * A remote browser stays on the sign in form until the cookie is set.
 */

export interface SessionInfo {
  authenticated: boolean
  loginRequired: boolean
}

interface SessionValue {
  info: SessionInfo
  end: () => Promise<void>
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) {
    return {
      info: { authenticated: true, loginRequired: false },
      end: async () => {},
      refresh: async () => {},
    }
  }
  return value
}

async function readSession(): Promise<SessionInfo | null> {
  try {
    const res = await fetch(`${API_URL}/auth/session`, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as Partial<SessionInfo>
    return {
      authenticated: body.authenticated === true,
      loginRequired: body.loginRequired === true,
    }
  } catch {
    return null
  }
}

export async function submitPassword(
  password: string,
): Promise<{ status: number; message: string }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  let message = ''
  if (res.status === 429) {
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      message = ''
    }
  }
  return { status: res.status, message }
}

function applyStoredTheme() {
  const choice = localStorage.getItem('mc-theme')
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = choice === 'dark' || (choice !== 'light' && systemDark)
  document.documentElement.classList.toggle('light', !dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function SessionGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const next = await readSession()
    if (!next) {
      setOffline(true)
      return
    }
    setOffline(false)
    setInfo(next)
  }, [])

  useEffect(() => {
    applyStoredTheme()
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [refresh])

  const end = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // The cookie clear is best effort. The form still returns.
    }
    localStorage.removeItem('mc-connected')
    await refresh()
  }, [refresh])

  async function onSubmit(password: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await submitPassword(password)
      if (result.status === 429) {
        setError(
          result.message ||
            'Too many tries. Try again in a minute. npm run login:reset clears the lock.',
        )
        return
      }
      if (result.status !== 204) {
        setError('That password is wrong.')
        return
      }
      await refresh()
    } catch {
      setError('The API did not answer.')
    } finally {
      setBusy(false)
    }
  }

  const value: SessionValue = {
    info: info ?? { authenticated: false, loginRequired: true },
    end,
    refresh,
  }

  if (!info && !offline) {
    return (
      <div className="grid h-dvh place-items-center bg-mc-bg text-[15px] text-mc-sub">Loading</div>
    )
  }

  if (offline) {
    return (
      <div className="grid h-dvh place-items-center bg-mc-bg px-6">
        <div className="mc-card w-full max-w-md px-8 py-8 text-center">
          <h1 className="text-[22px] font-semibold text-mc-text">API unreachable</h1>
          <p className="mt-2 text-[14px] text-mc-sub">The API did not answer. Start it, then try again.</p>
          <button
            type="button"
            className="mt-6 rounded-lg bg-mc-accent-fill px-4 py-2 text-[14px] font-semibold text-white"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (info && info.loginRequired && !info.authenticated) {
    return (
      <SessionContext.Provider value={value}>
        <Login busy={busy} error={error} onSubmit={(password) => void onSubmit(password)} />
      </SessionContext.Provider>
    )
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

function Login({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState('')
  return (
    <div className="grid h-dvh place-items-center bg-mc-bg px-6">
      <form
        className="mc-card w-full max-w-md px-8 py-8"
        data-login-form="true"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(password)
        }}
      >
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Mission Control</p>
        <h1 className="mt-2 text-[28px] font-bold tracking-[-0.02em] text-mc-text">Sign in</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-mc-sub">
          This dashboard needs a password when the request is not from this machine. The installer printed it once.
        </p>
        <label className="mt-6 block text-[13px] font-semibold text-mc-text" htmlFor="dashboard-password">
          Password
        </label>
        <input
          id="dashboard-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-mc-border bg-mc-bg px-3 py-2 text-[15px] text-mc-text outline-none focus-visible:ring-2 focus-visible:ring-mc-accent-text"
        />
        {error && (
          <p className="mt-3 text-[13px] text-mc-orangetext" data-login-error="true" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-6 rounded-lg bg-mc-accent-fill px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Checking' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
