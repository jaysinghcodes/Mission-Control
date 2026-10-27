import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { WEB_PORT } from '../lib/ports'
import { Chip, PillButton } from './ui'

/**
 * ConnectSteps: the 8 step onboarding runbook for the /connect page.
 * Step titles follow ONBOARDING.md. Steps 5 and 7 carry a live /health probe.
 * The other steps are guidance the operator confirms. Confirmed is not verified.
 */

export type Phase = 'host' | 'verify' | 'here'
export type OsKey = 'mac' | 'windows' | 'linux' | 'other'
export type RingState = 'done' | 'active' | 'pending'

export interface StepCmd {
  label?: string
  cmd: string
}

export interface StepLink {
  label: string
  to: string
  external?: boolean
}

export interface ConnectStep {
  id: number // 1..8, matches ONBOARDING.md order. Do not renumber.
  title: string // ONBOARDING.md heading text, without a "Step N" prefix
  phase: Phase
  phaseLabel: string
  body: string[] // short lines; `backticks` render as inline code
  commands?: StepCmd[]
  probe?: 'health' // page injects a live probe zone (steps 5 and 7)
  links?: StepLink[]
  confirmable: boolean // static steps get the "Mark done. I did this" chip
}

/** The install internals that step 2 leaves out: env keys, ports, doctor, the bridge schedule, and CI. */
export const INSTALL_GUIDE = 'https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/INSTALL.md'

/** SSH to the configured owner port. The browser stays on that port. */
export function sshTunnel(port: string): string {
  return `ssh -L ${port}:127.0.0.1:${port} ubuntu@your-server-ip`
}

/** Per-OS tunnel commands (existing record shape, labels kept). */
export function osSteps(port: string = WEB_PORT): Record<OsKey, { name: string; cmd: string; note: string }> {
  const cmd = sshTunnel(port)
  return {
    mac: {
      name: 'macOS',
      cmd,
      note: 'Open Terminal and replace `your-server-ip` with your host.',
    },
    windows: {
      name: 'Windows',
      cmd,
      note: 'Open PowerShell, which has OpenSSH built in, and replace `your-server-ip` with your host.',
    },
    linux: {
      name: 'Linux',
      cmd,
      note: 'Open a terminal and replace `your-server-ip` with your host.',
    },
    other: {
      name: 'Other',
      cmd,
      note: 'Open your terminal and replace `your-server-ip` with your host.',
    },
  }
}

export const OS_STEPS: Record<OsKey, { name: string; cmd: string; note: string }> = osSteps()

export const OS_KEYS = Object.keys(OS_STEPS) as OsKey[]

/** One docs section per step. Each step links to its own section with one short link. */
export function stepDoc(slug: string): string {
  return `${INSTALL_GUIDE}#${slug}`
}

/**
 * The eight steps, in ONBOARDING.md order. Each step is a title, one or two
 * short sentences, at most one command, and one link to the docs section that
 * holds the rest. Every command copies as is: no prompt sign, no ending period.
 */
export const STEP_DATA: ConnectStep[] = [
  {
    id: 1,
    title: 'Confirm prerequisites',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: ['You need git, Docker with the Compose plugin, curl, and bash. Each line below prints a version.'],
    commands: [{ cmd: 'git --version\ndocker compose version\ncurl --version' }],
    links: [{ label: 'Prerequisites', to: stepDoc('connect-step-1-prerequisites'), external: true }],
    confirmable: true,
  },
  {
    id: 2,
    title: 'Clone and install',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'The installer sets everything up, starts the stack, and prints the address and the dashboard password. The password is shown once, on the first install.',
    ],
    commands: [
      {
        cmd: 'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control\ncd mission-control\nbash install.sh',
      },
    ],
    links: [
      { label: 'How install works', to: INSTALL_GUIDE, external: true },
    ],
    confirmable: true,
  },
  {
    id: 3,
    title: 'Create the environment file: the root .env',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'The installer already wrote the root `.env`, so leave it when it exists. Copy the template only when it is missing, and ask the owner for every real secret.',
    ],
    commands: [{ cmd: 'cp .env.example .env' }],
    links: [{ label: 'Every variable', to: stepDoc('connect-step-3-the-root-env'), external: true }],
    confirmable: true,
  },
  {
    id: 4,
    title: 'Start the stack',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'The installer already started Postgres, the API, and the web UI. Run this to start them again with Docker Compose.',
    ],
    commands: [{ cmd: 'docker compose up -d --build' }],
    links: [{ label: 'Ports and modes', to: stepDoc('connect-step-4-start-the-stack'), external: true }],
    confirmable: true,
  },
  {
    id: 5,
    title: 'Verify the dashboard',
    phase: 'verify',
    phaseLabel: 'VERIFY',
    body: [
      `Open \`http://localhost:${WEB_PORT}/#/tasks\` and sign in with the password from install. The task board loads and the sidebar shows a green Connected dot.`,
    ],
    links: [{ label: 'If the dot stays red', to: stepDoc('connect-step-5-verify-the-dashboard'), external: true }],
    probe: 'health',
    confirmable: false,
  },
  {
    id: 6,
    title: 'Connect your OpenClaw (the bridge)',
    phase: 'verify',
    phaseLabel: 'VERIFY',
    body: [
      'Optional. With OpenClaw on PATH, the first line previews a sync and the second sends one, and without it you can load demo data instead.',
    ],
    commands: [{ cmd: 'python3 bridge/mc-bridge-sync.py --dry-run\npython3 bridge/mc-bridge-sync.py' }],
    links: [{ label: 'Bridge details', to: stepDoc('connect-step-6-the-openclaw-bridge'), external: true }],
    confirmable: true,
  },
  {
    id: 7,
    title: 'Connect from another machine (optional)',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    // The command forwards the owner port, MC_WEB_PORT. Tailscale Serve and Cloudflare Tunnel are in the guide.
    body: [`On your laptop, forward port ${WEB_PORT} over SSH and keep the session open.`],
    links: [
      { label: 'Remote access guide', to: 'https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/REMOTE.md#from-the-connect-page', external: true },
    ],
    probe: 'health',
    confirmable: false,
  },
  {
    id: 8,
    title: 'Smoke test',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    body: [
      'Create a ticket, move it across the board, and refresh to see it stay. Demo data fills Calendar, Team, and Office, and the bridge replaces it with your real agents.',
    ],
    links: [{ label: 'What to check', to: stepDoc('connect-step-8-smoke-test'), external: true }],
    confirmable: true,
  },
]

/** Shared ring styles: done = green w/ ✓, active = primary outline, pending = faint. */
export function ringClass(state: RingState): string {
  if (state === 'done') return 'bg-mc-greenbg text-mc-greentext'
  if (state === 'active') return 'border border-mc-primary text-mc-text'
  return 'bg-mc-inner text-mc-faint'
}

/** Render body text. Backticks become inline code. Double stars become emphasis. */
export function fmt(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  // Tokenise into plain / `code` / **bold** segments, then recursively render.
  for (const seg of text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)) {
    if (!seg) continue
    if (seg.startsWith('`') && seg.endsWith('`')) {
      out.push(
        <code key={key++} className="rounded bg-mc-inner px-1 py-px font-mono text-[12px] text-mc-text [overflow-wrap:anywhere]">
          {seg.slice(1, -1)}
        </code>,
      )
    } else if (seg.startsWith('**') && seg.endsWith('**')) {
      out.push(
        <strong key={key++} className="font-semibold text-mc-text">
          {seg.slice(2, -2)}
        </strong>,
      )
    } else {
      out.push(<span key={key++}>{seg}</span>)
    }
  }
  return out
}

/** Mono command block with an optional copy button (clipboard API, aria-labelled). */
export function CodeBlock({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard unavailable. Stay quiet.
    }
  }
  return (
    <div className="mt-3">
      {label && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-mc-faint">{label}</div>}
      <div className="relative">
        <pre className="whitespace-pre-wrap rounded-lg bg-mc-inner p-4 pr-16 font-mono text-[13px] leading-relaxed text-mc-text [overflow-wrap:anywhere]">
          {cmd}
        </pre>
        {canCopy && (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? 'Copied' : 'Copy command'}
            className="absolute top-2.5 right-2.5 h-7 rounded-md border border-mc-border bg-mc-card px-2 text-[11px] font-semibold text-mc-faint transition-colors duration-150 hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  )
}

/** One numbered step card. `children` = the page-injected dynamic zone (probe / OS switcher). */
export function ConnectStepCard({
  step,
  state,
  confirmed,
  onConfirm,
  onUndo,
  children,
}: {
  step: ConnectStep
  state: RingState
  confirmed: boolean
  onConfirm: (id: number) => void
  onUndo: (id: number) => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3.5">
      {/* Number ring. Done shows a check. Active is the current step. */}
      <span
        aria-hidden
        className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors duration-150 ${ringClass(state)}`}
      >
        {state === 'done' ? '✓' : step.id}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 className="text-[15px] font-semibold leading-snug text-mc-text">{step.title}</h3>
          <Chip label={step.phaseLabel} bg="var(--mc-inner)" fg="var(--mc-faint)" h={18} fs="text-[9.5px]" />
        </div>
        <div className="mt-1">
          {step.body.map((line, i) => (
            <p key={i} className="mt-1.5 text-[12.5px] leading-relaxed text-mc-sub">
              {fmt(line)}
            </p>
          ))}
        </div>
        {step.commands?.map((c, i) => <CodeBlock key={i} cmd={c.cmd} label={c.label} />)}
        {step.links && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {step.links.map((l) =>
              l.external ? (
                <a
                  key={l.label}
                  href={l.to}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-full border border-mc-border bg-mc-card px-4 text-[12.5px] font-semibold text-mc-sub transition-colors duration-150 hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  to={l.to}
                  className="inline-flex h-8 items-center rounded-full border border-mc-border bg-mc-card px-4 text-[12.5px] font-semibold text-mc-sub transition-colors duration-150 hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
        )}
        {children}
        {step.confirmable &&
          (confirmed ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-mc-greentext">
              <span>✓ Done. You confirmed this</span>
              <button
                type="button"
                onClick={() => onUndo(step.id)}
                className="rounded text-[11.5px] font-medium text-mc-faint underline underline-offset-2 transition-colors duration-150 hover:text-mc-sub focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
              >
                Undo
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <PillButton label="✓ Mark done. I did this" onClick={() => onConfirm(step.id)} />
            </div>
          ))}
      </div>
    </div>
  )
}
