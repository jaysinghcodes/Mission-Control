import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_URL } from '../lib/apiBase'
import {
  CodeBlock,
  OS_KEYS,
  OS_STEPS,
  STEP_DATA,
  SecretsCallout,
  fmt,
  type OsKey,
} from '../components/ConnectSteps'

/**
 * Setup — the 8 ONBOARDING.md steps as one Apple sheet. Live probes stay
 * live. Guidance steps are confirmed by the operator; confirmed is not verified.
 */

const API = API_URL
const PROGRESS_KEY = 'mc-setup-progress'
const SHORT = ['Prerequisites', 'Clone', 'Root .env', 'Start stack', 'Verify', 'OpenClaw', 'Remote', 'Smoke test']

function clientOS(): OsKey {
  const p = navigator.platform.toLowerCase()
  if (p.includes('win')) return 'windows'
  if (p.includes('mac')) return 'mac'
  if (p.includes('linux')) return 'linux'
  return 'other'
}

function loadProgress(): Record<number, string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return Object.fromEntries(
      Object.entries(parsed).filter(([k]) => STEP_DATA.some((s) => String(s.id) === k)),
    ) as unknown as Record<number, string>
  } catch {
    return {}
  }
}

async function probeApi(): Promise<{ ok: boolean; detail: string }> {
  const bases = [API, API.replace('localhost', '127.0.0.1')]
  let detail = 'Could not reach the API on this port.'
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const h = (await res.json()) as { status?: string; database?: string }
        return { ok: true, detail: `API ${h.status ?? 'ok'} · database ${h.database ?? 'connected'}` }
      }
      detail = `API responded with ${res.status} — the connection is up but the API is unhappy.`
    } catch {
      // try the next base
    }
  }
  return { ok: false, detail }
}

export default function Connect() {
  const nav = useNavigate()
  const [os, setOs] = useState<OsKey>('other')
  const [progress, setProgress] = useState<Record<number, string>>(loadProgress)
  const [index, setIndex] = useState(() => {
    const saved = loadProgress()
    const first = STEP_DATA.findIndex((s) => !saved[s.id])
    return first === -1 ? STEP_DATA.length - 1 : first
  })
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [bridgeChoice, setBridgeChoice] = useState<'bridge' | 'skip'>('bridge')

  const persist = (next: Record<number, string>) => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next))
    } catch {
      // localStorage unavailable — the page still works
    }
  }

  const markDone = useCallback((id: number) => {
    setProgress((p) => {
      const next = { ...p, [id]: new Date().toISOString() }
      persist(next)
      return next
    })
  }, [])

  const runProbe = useCallback(async () => {
    if (checking) return null
    setChecking(true)
    const r = await probeApi()
    if (r.ok) {
      try {
        localStorage.setItem('mc-connected', 'true')
      } catch {
        // ignore
      }
    }
    setProbe(r)
    setChecking(false)
    return r
  }, [checking])

  useEffect(() => {
    setOs(clientOS())
    const t = setTimeout(() => void runProbe(), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = STEP_DATA[index]
  const osStep = OS_STEPS[os]

  async function continueStep() {
    if (step.probe === 'health') {
      const r = probe?.ok ? probe : await runProbe()
      if (!r?.ok) return
      markDone(step.id)
    }
    if (step.confirmable) markDone(step.id)
    if (index >= STEP_DATA.length - 1) {
      nav('/')
      return
    }
    setIndex(index + 1)
  }

  return (
    <div className="flex min-h-full justify-center bg-mc-bg px-4 py-8">
      <div className="mc-card flex w-full max-w-[760px] flex-col px-5 py-8 sm:px-10">
        <img src="/logo.svg" alt="" className="mx-auto h-14 w-14" />
        <p className="mt-3 text-center text-[13px] font-semibold text-mc-sub">Set up Mission Control</p>

        <ol className="relative mx-auto mt-6 flex w-full max-w-[640px] justify-between" aria-label="Setup steps">
          <span className="absolute left-4 right-4 top-[10px] h-0.5 bg-mc-track" aria-hidden />
          <span
            className="absolute left-4 top-[10px] h-0.5 bg-mc-green"
            style={{ width: `calc(${(index / (STEP_DATA.length - 1)) * 100}% - 2rem)` }}
            aria-hidden
          />
          {STEP_DATA.map((s, i) => {
            const done = !!progress[s.id]
            const current = i === index
            return (
              <li key={s.id} className="relative z-10 flex w-16 flex-col items-center">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Step ${s.id}: ${s.title}`}
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                    current ? 'bg-mc-accent-fill text-white ring-4 ring-mc-accent/20' : done ? 'bg-mc-green text-white' : 'border border-mc-sub bg-mc-card text-mc-sub'
                  }`}
                >
                  {done && !current ? '✓' : s.id}
                </button>
                <span className={`mt-2 text-center text-[11px] leading-tight ${current ? 'font-semibold text-mc-text' : 'text-mc-sub'}`}>{SHORT[i]}</span>
              </li>
            )
          })}
        </ol>

        <div className="mt-8">
          <p className="text-center text-[10.5px] font-bold tracking-[0.06em] text-mc-accent-text">
            STEP {step.id} OF 8 · {step.phaseLabel}
          </p>
          <h1 className="mt-2 text-center text-[28px] font-bold tracking-[-0.02em]">{step.title}</h1>
          <div className="mx-auto mt-3 max-w-xl space-y-2 text-center text-[14.5px] leading-relaxed text-mc-sub">
            {step.body.map((line) => <p key={line}>{fmt(line)}</p>)}
          </div>
        </div>

        <div className="mt-6">
          {step.id === 6 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setBridgeChoice('bridge')}
                className={`w-full rounded-[14px] px-5 py-4 text-left ${bridgeChoice === 'bridge' ? 'bg-mc-accent/10 ring-2 ring-mc-accent' : 'bg-mc-card ring-1 ring-mc-border'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15.5px] font-semibold">Connect the bridge</span>
                  <span className="rounded-full bg-mc-bluebg px-2 py-0.5 text-[11px] font-semibold text-mc-bluetext">Recommended</span>
                </div>
                <p className="mt-1 text-[12.5px] text-mc-sub2">Runs bridge/mc-bridge-sync.py about every 5 minutes with the INGEST_TOKEN in your root .env.</p>
                {bridgeChoice === 'bridge' && step.commands?.map((c) => <CodeBlock key={c.cmd} cmd={c.cmd} label={c.label} />)}
              </button>
              <button
                type="button"
                onClick={() => setBridgeChoice('skip')}
                className={`w-full rounded-[14px] px-5 py-4 text-left ${bridgeChoice === 'skip' ? 'bg-mc-accent/10 ring-2 ring-mc-accent' : 'bg-mc-card ring-1 ring-mc-border'}`}
              >
                <span className="text-[15.5px] font-semibold">Skip for now and use demo data</span>
                <p className="mt-1 text-[12.5px] text-mc-sub2">Run <code className="font-mono text-mc-text">npm run seed:demo</code> for labeled sample agents, jobs and tickets. Tickets work with no OpenClaw.</p>
              </button>
            </div>
          )}

          {step.id !== 6 && step.commands?.map((c) => <CodeBlock key={c.cmd} cmd={c.cmd} label={c.label} />)}
          {step.secrets && step.vars && <SecretsCallout vars={step.vars} />}

          {step.id === 7 && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mc-sub">Your OS</span>
                <div role="group" aria-label="Choose your operating system" className="flex flex-wrap gap-1.5">
                  {OS_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={os === k}
                      onClick={() => setOs(k)}
                      className={`h-7 rounded-full px-3 text-[11.5px] font-semibold ${os === k ? 'bg-mc-accent-fill text-white' : 'bg-mc-ctl text-mc-sub'}`}
                    >
                      {OS_STEPS[k].name}
                    </button>
                  ))}
                </div>
              </div>
              <CodeBlock cmd={osStep.cmd} />
              <p className="text-[12.5px] text-mc-sub">{osStep.note}</p>
            </div>
          )}

          {step.probe === 'health' && (
            <div className="mt-4">
              <button type="button" onClick={() => void runProbe()} className="h-8 rounded-lg bg-mc-ctl px-3 text-[13px] font-semibold">
                {checking ? 'Checking…' : probe && !probe.ok ? 'Retry' : 'Check the API'}
              </button>
              {probe && (
                <p className={`mt-2 text-[13px] font-semibold ${probe.ok ? 'text-mc-greentext' : 'text-mc-redtext'}`}>
                  {probe.ok ? `✓ ${probe.detail}` : `✗ ${probe.detail}`}
                </p>
              )}
              {probe && !probe.ok && (
                <p className="mt-1 text-[12.5px] text-mc-sub">
                  {step.id === 7
                    ? 'Keep the SSH session open, re-run the tunnel, then retry. If the stack is not up, finish the earlier steps on the host.'
                    : 'Start the stack on the host (steps 1–4), then retry.'}
                </p>
              )}
            </div>
          )}

          {step.links && step.links.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {step.links.map((link) =>
                link.external ? (
                  <a key={link.label} href={link.to} className="text-[13px] font-semibold text-mc-accent-text" target="_blank" rel="noreferrer">{link.label}</a>
                ) : (
                  <button key={link.label} type="button" onClick={() => nav(link.to)} className="text-[13px] font-semibold text-mc-accent-text">{link.label}</button>
                ),
              )}
            </div>
          )}
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-mc-sep pt-4">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="h-9 rounded-[10px] bg-mc-ctl px-4 text-[14px] font-semibold disabled:opacity-40"
          >
            Back
          </button>
          <span className="text-[12px] text-mc-sub">Steps match ONBOARDING.md</span>
          <button type="button" onClick={() => void continueStep()} className="h-9 rounded-[10px] bg-mc-accent-fill px-5 text-[14px] font-semibold text-white">
            {index === STEP_DATA.length - 1 ? 'Enter the dashboard' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
