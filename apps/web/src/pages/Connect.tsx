import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, PillButton, Progress, SectionLabel } from '../components/ui'
import { API_URL } from '../lib/apiBase'
import {
  CodeBlock,
  ConnectStepCard,
  OS_KEYS,
  OS_STEPS,
  STEP_DATA,
  fmt,
  ringClass,
  type OsKey,
  type RingState,
} from '../components/ConnectSteps'

/**
 * Connect — the onboarding gate (MC-207). The page mirrors ONBOARDING.md's
 * 8 steps 1:1 (titles verbatim, doc-faithful copy) as a guided runbook:
 *  1–4  ON THE HOST   — static guidance, confirmed by the operator ("I did this")
 *  5–6  VERIFY        — step 5 probes the real API; step 6 is bridge guidance
 *  7–8  YOU ARE HERE  — step 7 is the OS-aware SSH tunnel + live probe + handoff
 * Live checks stay live (probe /health); everything unverifiable from a
 * browser is explicit guidance — confirmed ≠ verified, never auto-credited.
 *
 * Why this flow (design thinking):
 *  - Mission Control binds to loopback only (security red line) → the only
 *    way in from another machine is an SSH tunnel. Instructions > mystery.
 *  - We detect your OS (browser) and show the exact command — no guessing.
 *  - "I'm connected" verifies against the real API before unlocking the app.
 *  - API unreachable? This page still guides (steps 1–4 work offline); probes
 *    fail with a next action, never a dead-end spinner.
 */

// Configured API location, shared app-wide (lib/apiBase, QA-1 polish item 7).
const API = API_URL
const PROGRESS_KEY = 'mc-setup-progress'

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

/**
 * Probe the real API — extracted unchanged from the previous single check
 * (dual `localhost`/`127.0.0.1` spelling + 5s ceiling; browsers can resolve
 * `localhost` to ::1 while the SSH tunnel only binds IPv4, and a single-spelling
 * CORS lockout broke the gate even when the tunnel was fine).
 */
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
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const liRefs = useRef<Record<number, HTMLLIElement | null>>({})

  const persist = (next: Record<number, string>) => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next))
    } catch {
      // localStorage unavailable — degrade silently, page still works
    }
  }

  const markDone = useCallback((id: number) => {
    setProgress((p) => {
      const next = { ...p, [id]: new Date().toISOString() }
      persist(next)
      return next
    })
  }, [])

  const undo = (id: number) => {
    setProgress((p) => {
      const next = { ...p }
      delete next[id]
      persist(next)
      return next
    })
  }

  const runProbe = useCallback(async () => {
    if (checking) return
    setChecking(true)
    const r = await probeApi()
    if (r.ok) {
      // Live-derived, never guessed: a real API answer verifies steps 5 & 7.
      markDone(5)
      markDone(7)
      try {
        localStorage.setItem('mc-connected', 'true')
      } catch {
        // ignore
      }
    }
    setProbe(r)
    setChecking(false)
  }, [checking, markDone])

  // Detect the OS and establish the honest baseline once on mount: if the API
  // answers right now, steps 5 & 7 are genuinely verified; if not, show the
  // failure with a next action (never a dead-end spinner).
  useEffect(() => {
    setOs(clientOS())
    const t = setTimeout(() => void runProbe(), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doneCount = STEP_DATA.filter((s) => progress[s.id]).length
  const total = STEP_DATA.length
  const activeId = STEP_DATA.find((s) => !progress[s.id])?.id ?? null

  function scrollToStep(id: number) {
    const el = liRefs.current[id]
    if (!el) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }

  function stepState(id: number): RingState {
    if (progress[id]) return 'done'
    if (id === activeId) return 'active'
    return 'pending'
  }

  /** Step 5 & 7 share one honest probe: the API either answers from this browser or it doesn't. */
  function ProbeZone({ stepId }: { stepId: number }) {
    const isStep7 = stepId === 7
    const label = isStep7 ? 'I ran the tunnel — check connection' : 'Check the dashboard API'
    const nextAction = isStep7
      ? 'Is the SSH session still open? Re-run the command above, then retry. If the stack isn’t started yet, complete steps 1–4 on your host first.'
      : 'Is the stack started on your host? Complete steps 1–4 first, then Retry.'
    const idleLabel = probe && !probe.ok ? 'Retry' : label
    return (
      <div className="mt-4">
        <PillButton
          label={checking ? 'Checking…' : idleLabel}
          className={checking ? 'pointer-events-none opacity-60' : ''}
          onClick={() => void runProbe()}
        />
        {!checking && probe && (
          <div className="mt-3">
            {probe.ok ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] font-semibold text-mc-greentext">
                  {isStep7 ? '✓ Connected — ' : '✓ '}
                  {probe.detail}
                </span>
                {isStep7 && <PillButton label="Enter the dashboard →" on onClick={() => nav('/')} />}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-mc-redtext">✗ {probe.detail}</p>
                <p className="max-w-xl text-[12.5px] leading-relaxed text-mc-sub">{nextAction}</p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const s = OS_STEPS[os]

  return (
    <div className="min-h-full p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <div className="text-[22px] font-semibold">Connect to your OpenClaw instance</div>
            <div className="mt-0.5 text-[13px] text-mc-sub">
              Eight steps, mirroring ONBOARDING.md — from clone to smoke test. Nothing unlocks until the real API answers.
            </div>
          </div>
        </div>

        {/* Progress rail — honest count: confirmed (you) + verified (probe), never auto-credited */}
        <div className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="text-[13px] font-semibold text-mc-text">
                Setup {doneCount}/{total}
              </span>
              {doneCount === 0 && <span className="text-[12px] text-mc-faint">follow the steps below</span>}
              {doneCount === total && (
                <span className="text-[12px] font-semibold text-mc-greentext">✓ Setup complete — the dashboard is ready</span>
              )}
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Step progress">
              {STEP_DATA.map((step) => {
                const st = stepState(step.id)
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => scrollToStep(step.id)}
                    aria-label={`Go to step ${step.id}: ${step.title}`}
                    title={`Step ${step.id} — ${step.title}`}
                    className={`grid h-[22px] w-[22px] place-items-center rounded-full text-[10.5px] font-bold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary ${ringClass(st)}`}
                  >
                    {st === 'done' ? '✓' : step.id}
                  </button>
                )
              })}
            </div>
          </div>
          <Progress pct={(doneCount / total) * 100} color={doneCount === total ? 'var(--mc-green)' : 'var(--mc-primary)'} className="mt-2.5" />
        </div>

        {/* The eight-step runbook */}
        <ol className="mt-6 list-none space-y-4">
          {STEP_DATA.map((step) => (
            <li
              key={step.id}
              ref={(el) => {
                liRefs.current[step.id] = el
              }}
              aria-current={step.id === activeId ? 'step' : undefined}
              className="scroll-mt-6"
            >
              <Card className="px-5 py-5 sm:px-6">
                <ConnectStepCard
                  step={step}
                  state={stepState(step.id)}
                  confirmed={!!progress[step.id]}
                  onConfirm={markDone}
                  onUndo={undo}
                >
                  {step.id === 7 ? (
                    <>
                      <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint">Your OS</span>
                          <div role="group" aria-label="Choose your operating system" className="flex flex-wrap items-center gap-1.5">
                            {OS_KEYS.map((k) => (
                              <button
                                key={k}
                                type="button"
                                aria-pressed={os === k}
                                onClick={() => setOs(k)}
                                className={`h-7 rounded-full px-3 text-[11.5px] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary ${
                                  os === k
                                    ? 'bg-mc-primary text-white'
                                    : 'border border-mc-border bg-mc-card text-mc-sub hover:text-mc-text'
                                }`}
                              >
                                {OS_STEPS[k].name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <CodeBlock cmd={s.cmd} />
                        <p className="text-[12px] leading-relaxed text-mc-sub">{s.note}</p>
                      </div>
                      <ProbeZone stepId={7} />
                    </>
                  ) : (
                    step.probe === 'health' && <ProbeZone stepId={step.id} />
                  )}
                </ConnectStepCard>
              </Card>
            </li>
          ))}
        </ol>

        {/* Why this flow */}
        <Card className="mt-6 px-6 py-5">
          <SectionLabel>Why this flow</SectionLabel>
          <ul className="mt-3 list-disc space-y-2 pl-4 text-[12.5px] leading-relaxed text-mc-sub">
            <li>Security first: loopback-only API → the SSH tunnel is the sanctioned way in, on purpose.</li>
            <li>One runbook everywhere: this page and ONBOARDING.md are the same 8 steps — no contradictions.</li>
            <li>No mystery: the exact command per OS, detected for you.</li>
            <li>Honest gate: nothing unlocks until the real API answers.</li>
            <li>Already connected? This page never blocks you — the dashboard loads straight away.</li>
          </ul>
          {probe?.ok && (
            <p className="mt-4 text-[12.5px] text-mc-faint">
              {fmt('API reachable right now — the live checks above are verified. Next: `Enter the dashboard →` from step 7, or `Mark done` the guidance steps you completed on the host.')}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
