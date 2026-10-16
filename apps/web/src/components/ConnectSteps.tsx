import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Chip, PillButton, SectionLabel } from './ui'

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

export interface StepVar {
  name: string
  desc: string
}

export interface ConnectStep {
  id: number // 1..8, matches ONBOARDING.md order. Do not renumber.
  title: string // ONBOARDING.md heading text, without a "Step N" prefix
  phase: Phase
  phaseLabel: string
  body: string[] // short lines; `backticks` render as inline code
  commands?: StepCmd[]
  secrets?: boolean // true renders SecretsCallout (step 3 only)
  probe?: 'health' // page injects a live probe zone (steps 5 and 7)
  vars?: StepVar[]
  links?: StepLink[]
  confirmable: boolean // static steps get the "Mark done. I did this" chip
}

/** Per-OS tunnel commands (existing record shape, labels kept). */
export const OS_STEPS: Record<OsKey, { name: string; cmd: string; note: string }> = {
  mac: {
    name: 'macOS',
    cmd: 'ssh -L 5173:127.0.0.1:5173 ubuntu@<your-server-ip>',
    note: 'Open Terminal. Replace <your-server-ip> with your host. If the installer printed another web port, use that port.',
  },
  windows: {
    name: 'Windows',
    cmd: 'ssh -L 5173:127.0.0.1:5173 ubuntu@<your-server-ip>',
    note: 'Open PowerShell. OpenSSH is built in. Replace <your-server-ip> with your host. If the installer printed another web port, use that port.',
  },
  linux: {
    name: 'Linux',
    cmd: 'ssh -L 5173:127.0.0.1:5173 ubuntu@<your-server-ip>',
    note: 'Open a terminal. Replace <your-server-ip> with your host. If the installer printed another web port, use that port.',
  },
  other: {
    name: 'Other',
    cmd: 'ssh -L 5173:127.0.0.1:5173 ubuntu@<your-server-ip>',
    note: 'Open your terminal and run the command below. If the installer printed another web port, use that port.',
  },
}

export const OS_KEYS = Object.keys(OS_STEPS) as OsKey[]

/**
 * The eight steps, in ONBOARDING.md order. Titles are the doc's headings
 * verbatim; bodies stay doc-faithful in spirit. Step 3 mirrors the *merged*
 * doc (MC-215): root `.env` + `cp .env.example .env` + the full var list.
 */
export const STEP_DATA: ConnectStep[] = [
  {
    id: 1,
    title: 'Confirm prerequisites',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'Docker with the Compose plugin, git, curl, and bash. One command installs Mission Control. The browser uses one port.',
      'No Docker? The installer says so and uses Node.js 22 (22.9 or newer) and Postgres 16. The advanced path still accepts Node.js 20.17 or newer.',
      // OpenClaw is optional. Tickets work without it, and seed:demo fills sample data.
      'Optional: your OpenClaw instance running. It is the live data source (step 6). Without it, the tickets loop works and `npm run seed:demo` fills sample data.',
    ],
    commands: [
      {
        label: 'Check the tools',
        cmd: 'git --version\ndocker compose version\ncurl --version',
      },
    ],
    confirmable: true,
  },
  {
    id: 2,
    title: 'Clone and install',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'One command writes a random ingest token and a dashboard password, starts the stack, runs doctor, and prints the URL. The password is shown once.',
      'CI runs this installer with Docker Compose on Ubuntu, and on the native path on Ubuntu and macOS. The macOS runner does not use Docker.',
      'Before Compose starts, the installer creates `data/docs` as the user running the script. That user can delete the checkout. `npm run seed:demo` on the host writes sample docs as that same user.',
      'A second run keeps the existing `.env`. It fills a missing dashboard password or session secret and does not replace other values.',
      'When the openclaw command is on PATH, the same command installs the bridge schedule. Linux uses a systemd user timer, or cron when that timer is not available. macOS uses launchd. Remove it with `bash install.sh --uninstall-schedule`.',
    ],
    commands: [
      {
        label: 'Clone and install',
        cmd: 'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control && cd mission-control && bash install.sh',
      },
    ],
    confirmable: true,
  },
  {
    id: 3,
    title: 'Create the environment file: the root .env',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'If you ran the installer, the root `.env` already exists. Leave it. The tokens are already in that file.',
      'Docker Compose reads exactly one env file: the **root** `.env` (next to `docker-compose.yml`). Copy the template only when `.env` is missing and you are not using `bash install.sh`. Never invent a secret (see the note below).',
    ],
    commands: [{ label: 'Copy the env template', cmd: 'cp .env.example .env' }],
    secrets: true,
    vars: [
      {
        name: 'DATABASE_URL',
        desc: 'Keep the template default. Compose’s Postgres matches it. Change it only if you override `POSTGRES_PASSWORD` in `.env`.',
      },
      {
        name: 'INGEST_TOKEN',
        desc: 'Shared secret for agent ingest: POST /events, register, heartbeat, and run writes. The dashboard does not send this header. `bash install.sh` writes a random value when `.env` is created and does not replace it later. You MAY generate one with `openssl rand -hex 24`. If it is blank and the API is on loopback, ingest stays open outside production and the API logs a warning. Production with no token returns 401 on ingest. If it is blank and the API binds anywhere else, the API refuses to start. Compose does not invent a token.',
      },
      {
        name: 'DASHBOARD_PASSWORD_HASH',
        desc: 'scrypt hash of the dashboard password. `bash install.sh` writes it and prints the password once. The file stores the hash only. Leave it blank on a loopback `npm run dev` and the dashboard stays open. Compose requires it because the API sees the Docker network, not loopback.',
      },
      {
        name: 'SESSION_SECRET',
        desc: 'Signs the session cookie. `bash install.sh` writes a random value. A second run does not replace it.',
      },
      {
        name: 'SESSION_STATE_PATH',
        desc: 'File that stores the session version and a changed password hash. Log out and a password change bump the version, so an old cookie returns 401 after a restart. Default is apps/api/data/session-state.json. Compose uses /data/auth/session-state.json on the mc-auth volume. When the file has a hash, it overrides DASHBOARD_PASSWORD_HASH on startup.',
      },
      {
        name: 'LOGIN_FAIL_LIMIT',
        desc: 'Wrong dashboard passwords allowed from one IP inside the window. Default 5. Loopback is not counted. Agent ingest is not counted.',
      },
      {
        name: 'LOGIN_WINDOW_SECONDS',
        desc: 'Window for those failures, in seconds. Default 60. The first wait after the limit matches this number.',
      },
      {
        name: 'LOGIN_BACKOFF_MAX_SECONDS',
        desc: 'Longest login wait, in seconds. Default 900, which is 15 minutes. Each later lockout doubles until it reaches this cap.',
      },
      {
        name: 'TRUSTED_PROXY',
        desc: 'Optional. Comma separated addresses of proxies whose X-Forwarded-For header is trusted for the login bucket only. Leave this blank. Do not set it to the Docker bridge. It does not skip login. Cloudflare Tunnel and Tailscale Serve do not need it. They use the tunnel port.',
      },
      {
        name: 'WEB_ORIGIN',
        desc: 'Template default covers `localhost` + `127.0.0.1`. Add your tunnel origin later if you access the dashboard remotely.',
      },
      {
        name: 'GITHUB_TOKEN (optional)',
        desc: 'Ask the human to paste this only if they want pull request merge from Approvals. Everything else works without it.',
      },
    ],
    confirmable: true,
  },
  {
    id: 4,
    title: 'Start the stack',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      '`bash install.sh` already starts Postgres, the API, and the web UI. The browser uses port 5173 only. Leave `VITE_API_URL` unset. nginx proxies `/api` and `/socket.io` to the API.',
      'The API loads the root `.env` and runs `prisma migrate deploy` before it listens. `docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`.',
      'No Docker? The installer says so and uses Node.js 22 and Postgres 16. The advanced path is also in the README. No OpenClaw? `npm run seed:demo` fills sample data.',
    ],
    commands: [
      { label: 'Build and start', cmd: 'docker compose up -d --build' },
      { label: 'Service status', cmd: 'docker compose ps' },
    ],
    confirmable: true,
  },
  {
    id: 5,
    title: 'Verify the dashboard',
    phase: 'verify',
    phaseLabel: 'VERIFY',
    body: [
      'Open `http://localhost:5173/#/tasks`. The task board loads and the sidebar shows a green Connected dot when the live socket is up.',
      'The first open asks for a timezone, then whether to use the Mission Control crew or keep each agent\'s own name, then confirms the detected provider. Skip finishes that open. Change each one later under System, then Settings. Open Tasks for the board and System for health.',
      'Health on this same origin shows uptime, client count, and database state. Empty states show actions.',
      'Dot stays red? The API is down, or this browser has no session. On Compose, sign in with the password the installer printed.',
    ],
    probe: 'health',
    confirmable: false,
  },
  {
    id: 6,
    title: 'Connect your OpenClaw (the bridge)',
    phase: 'verify',
    phaseLabel: 'VERIFY',
    // Ticket 3: copy now points at the vendored `bridge/` (mc-bridge-sync.py)
    // instead of a private per-machine cron script. Text-only change.
    body: [
      'Optional. Skip this step when OpenClaw is not installed. `bash install.sh` skips the bridge schedule in that case and that step still exits 0. `npm run seed:demo` does not need OpenClaw.',
      'Paste `docs/PASTE_IN.md` into OpenClaw and say yes. That file runs `bash install.sh`, reports the URL the installer prints, then registers and sends a heartbeat. It also shows the POST /tickets and POST /runs calls. It does not start the OpenClaw gateway. The 401 line is in `docs/API.md`.',
      'When the openclaw command is on PATH, `bash install.sh` installs the schedule: a systemd user timer on Linux, cron if that timer is not available, or launchd on macOS. The interval is `MC_BRIDGE_INTERVAL_SECONDS` (default 300). The job runs `bridge/mc-bridge-sync.py` with `MC_BRIDGE_REGISTER` (default 1). Remove it with `bash install.sh --uninstall-schedule`.',
      'The bridge is `bridge/mc-bridge-sync.py` (Python 3, stdlib only). It reads OpenClaw through the openclaw command and POSTs agents, sessions, calendar, usage, approvals, models, and devices snapshots plus `run.*` events. Devices come from `openclaw devices list` and nodes from `openclaw nodes list`. Approvals stay empty until `MC_BRIDGE_APPROVALS_CMD` prints them. Models come from `~/.openclaw/openclaw.json`. When that file has no model, the bridge runs `openclaw models list`. Usage prices tokens from `config/prices.json`. A reported costUsd wins. The API URL comes from `MC_API_URL`, then the API port.',
      'Under Compose the bridge checks the gateway at 127.0.0.1 on the configured port and posts gateway.snapshot with x-ingest-token. System shows Unknown when that report is missing or older than GATEWAY_STATUS_MAX_AGE_MS (default 600000). A native install, or an explicit OPENCLAW_GATEWAY_HOST, probes that host directly on OPENCLAW_GATEWAY_PORT (default 18789). Gateway logs are read from `OPENCLAW_LOG_DIR`. The default is `/tmp/openclaw`.',
      'It reads `INGEST_TOKEN` from the **root `.env`** (step 3) and sends it as `x-ingest-token` on POST /events, register, heartbeat, and run writes. Dashboard routes use the session cookie instead. Set the token explicitly. The bridge refuses a blank token. `npm run doctor` fails when a schedule is installed and the last successful sync is older than `MC_BRIDGE_STALE_SECONDS` (default 600). With no schedule, that age is an info line.',
      'Try `--dry-run` first, then a real sync. A 401 means the bridge and the API disagree on the token. Read `INGEST_TOKEN` from the root `.env`. The installer stores it there and does not print it.',
      'Merge `bridge/openclaw.starter.json` into `~/.openclaw/openclaw.json` (do not replace the whole file). The Mission Control starter is `agents.defaults.subagents.maxChildrenPerAgent` = 3 and `maxConcurrent` = 4. The api does not read these. They cap OpenClaw fan-out. The installer offers this merge and does not edit the file.',
    ],
    commands: [
      { label: 'Preview, then sync once', cmd: 'python3 bridge/mc-bridge-sync.py --dry-run\npython3 bridge/mc-bridge-sync.py' },
    ],
    links: [
      { label: 'docs/PASTE_IN.md', to: 'https://github.com/jaysinghcodes/mission-control/blob/main/docs/PASTE_IN.md', external: true },
      { label: 'docs/API.md', to: 'https://github.com/jaysinghcodes/mission-control/blob/main/docs/API.md#41-auth', external: true },
      { label: 'bridge/README.md', to: 'https://github.com/jaysinghcodes/mission-control/blob/main/bridge/README.md', external: true },
    ],
    confirmable: true,
  },
  {
    id: 7,
    title: 'Connect from another machine (optional)',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    body: [
      'Three free ways from a laptop are in the remote access guide: SSH to the owner port, Tailscale Serve, and Cloudflare Tunnel. Login is required on a Compose install.',
      'Run the SSH command for the OS you are on, replacing `<your-server-ip>` with your host. The default owner port is 5173. If the installer printed another web port, use that port. Keep the SSH session open. The page calls the API on that same origin.',
      'Tailscale Serve and Cloudflare Tunnel point at `127.0.0.1` on the tunnel port. `MC_REMOTE_PORT` defaults to 3011. Leave `TRUSTED_PROXY` unset.',
    ],
    links: [
      { label: 'Remote access guide', to: 'https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/REMOTE.md', external: true },
    ],
    probe: 'health',
    confirmable: false,
  },
  {
    id: 8,
    title: 'Smoke test',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    // Say what works with no OpenClaw, and what needs the step 6 bridge.
    body: [
      '**No OpenClaw needed:** Tickets. There is no ticket delete route. Create one, then move it from Backlog to To Do, Build, QA, Review, and Done. Every move persists and survives a refresh.',
      '**No OpenClaw needed:** after `npm run seed:demo`, Calendar / Team / Office / Live Activity show labelled sample data.',
      '**Needs the step-6 bridge:** your real cron jobs on Calendar, the real roster on Team, Office bots moving on real `run.*` events, and live agent activity.',
    ],
    links: [
      { label: 'Tickets', to: '/tickets' },
      { label: 'Calendar', to: '/calendar' },
      { label: 'Office', to: '/office' },
      { label: 'Live Activity', to: '/activity' },
    ],
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
        <code key={key++} className="rounded bg-mc-inner px-1 py-px font-mono text-[12px] text-mc-text">
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
        <pre className="whitespace-pre-wrap overflow-x-auto rounded-lg bg-mc-inner p-4 pr-16 font-mono text-[13px] leading-relaxed text-mc-text">
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

/** Secrets callout for step 3. The root .env variables. */
export function SecretsCallout({ vars }: { vars: StepVar[] }) {
  return (
    <div className="mt-4 rounded-r-lg border-l-2 border-mc-orange bg-mc-inner py-3 pl-4 pr-3">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full border border-mc-orange text-[10px] font-bold leading-none text-mc-orangetext"
        >
          !
        </span>
        <div>
          <p className="text-[13px] font-semibold leading-snug text-mc-text">
            Never invent or guess credentials. Ask the human who owns them.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-mc-sub">
            Pause and ask for every real secret; redact secrets in any echoed output; show the command before running it;
            side-effecting actions stay approval-gated.
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-mc-border/60 pt-3">
        <SectionLabel>Required vars, the root .env</SectionLabel>
        <div className="mt-2.5 space-y-2.5">
          {vars.map((v) => (
            <div key={v.name}>
              <div className="font-mono text-[12.5px] font-semibold text-mc-text">{v.name}</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-mc-sub">{fmt(v.desc)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-mc-faint">{fmt('`.env` is git-ignored. Never commit it.')}</p>
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
        {step.secrets && step.vars && <SecretsCallout vars={step.vars} />}
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
