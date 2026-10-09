import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Chip, PillButton, SectionLabel } from './ui'

/**
 * ConnectSteps — the 8-step onboarding runbook data + card renderers for the
 * /connect page (MC-207). Step titles/order/body copy mirror ONBOARDING.md
 * 1:1 (the doc is the source of truth); steps 5 & 7 carry a live /health probe
 * rendered by the page, everything else is honest guidance the operator
 * confirms themselves — confirmed ≠ verified, never auto-credited.
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
  id: number // 1..8, matches ONBOARDING.md order — do not renumber
  title: string // exact ONBOARDING.md heading text (minus the "Step N —" prefix)
  phase: Phase
  phaseLabel: string
  body: string[] // short lines; `backticks` render as inline code
  commands?: StepCmd[]
  secrets?: boolean // true → render <SecretsCallout/> (step 3 only)
  probe?: 'health' // true → page injects a live probe zone (steps 5 & 7)
  vars?: StepVar[]
  links?: StepLink[]
  confirmable: boolean // static steps get the "Mark done — I did this" chip
}

/** Per-OS tunnel commands (existing record shape, labels kept). */
export const OS_STEPS: Record<OsKey, { name: string; cmd: string; note: string }> = {
  mac: {
    name: 'macOS',
    cmd: 'ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
    note: 'Open Terminal. Replace <your-server-ip> with your OpenClaw host (public IP or tailnet name).',
  },
  windows: {
    name: 'Windows',
    cmd: 'ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
    note: 'Open PowerShell — OpenSSH is built in. Replace <your-server-ip> with your OpenClaw host.',
  },
  linux: {
    name: 'Linux',
    cmd: 'ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
    note: 'Open a terminal. Replace <your-server-ip> with your OpenClaw host.',
  },
  other: {
    name: 'Other',
    cmd: 'ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>',
    note: 'Open your terminal and run the command below.',
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
      'Node.js 20.17+ (or 22.9+) — the root `packageManager` is `npm@11.17.0`, which requires `^20.17 || >=22.9` — and git.',
      'Docker with the compose plugin (used for Postgres, and optionally the api + web containers).',
      // Ticket 3: OpenClaw is the live data source but no longer a hard
      // prerequisite — tickets work out of the box and seed:demo fills the rest.
      'Optional: your OpenClaw instance running — it is the live data source (step 6). Without it, the tickets loop works and `npm run seed:demo` fills sample data.',
    ],
    commands: [
      {
        label: 'Check the tools',
        cmd: 'node -v\ngit --version\ndocker compose version',
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
      'Clone the repo (replace `<repo-url>` with the URL you were given), then install dependencies.',
      // `npm ci` (exact lockfile) mirrors ONBOARDING.md step 2.
      'Confirm `npm ci` finished without errors.',
    ],
    commands: [{ label: 'Clone + install', cmd: 'git clone <repo-url> mission-control && cd mission-control\nnpm ci' }],
    confirmable: true,
  },
  {
    id: 3,
    title: 'Create the environment file: the root .env',
    phase: 'host',
    phaseLabel: 'ON THE HOST',
    body: [
      'Docker Compose reads exactly one env file: the **root** `.env` (next to `docker-compose.yml`). `apps/api/.env.example` is only a template for non-Docker runs — copy the root template:',
      'Then go through every variable with the human who owns the real values — never invent one (see the secrets note below).',
    ],
    commands: [{ label: 'Copy the env template', cmd: 'cp .env.example .env' }],
    secrets: true,
    vars: [
      {
        name: 'DATABASE_URL',
        desc: 'Keep the template default — compose’s Postgres matches it. Change it only if you override `POSTGRES_PASSWORD` in `.env`.',
      },
      {
        name: 'INGEST_TOKEN',
        desc: 'Shared secret for every API write, including POST /events. The dashboard does not put this value in browser code or local storage. The dev server and nginx attach it for you. You MAY generate one with `openssl rand -hex 24`. If it is blank and the API is on loopback, writes stay open and the API logs a warning. If it is blank and the API binds anywhere else, the API refuses to start. Compose fills a blank value with `dev-ingest-token`.',
      },
      {
        name: 'SOCKET_TOKEN',
        desc: 'Optional — guards the dashboard’s live socket when the api runs in production. Blank → `dev-socket-token` (the stack is loopback-only). If you set a real value, set it **before the first `docker compose build`** — it is baked into the web bundle.',
      },
      {
        name: 'WEB_ORIGIN',
        desc: 'Template default covers `localhost` + `127.0.0.1`. Add your tunnel origin later if you access the dashboard remotely.',
      },
      {
        name: 'GITHUB_TOKEN · DEEPSEEK_API_KEY · ZAI_API_KEY (optional)',
        desc: 'Ask the human to paste these only if they want those features — GitHub enables PR approvals → auto-merge; DeepSeek/ZAI keys enable live balances on Health/Usage. Everything else works without them.',
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
      'Wait for all three services to be up: db healthy, api, web. The first `--build` compiles the images, so it takes a while.',
      'Confirm the api is **not** crash-looping: `docker compose logs api` should end with the migrations applied and `mission-control api listening on 0.0.0.0:3000`.',
      'Prefer no Docker? Postgres is still required — the dev path (export the root `.env`, `npx prisma migrate deploy`, `npm run dev`) is in ONBOARDING.md step 4. No OpenClaw? `npm run seed:demo` fills sample data.',
    ],
    commands: [
      { label: 'Build + start', cmd: 'docker compose up -d --build' },
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
      'Open `http://localhost:5173/#/` — the Overview loads and the topbar shows a green “Connected” dot (live socket).',
      '`/health` shows real uptime, client count, and database state; empty states show actions, never fake numbers.',
      'Dot stays red on the Docker path? The api is down, or the `SOCKET_TOKEN` baked into the web build doesn’t match the api’s — set it in `.env` and rebuild with `docker compose up -d --build`.',
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
      'Optional — skip without OpenClaw. The bridge ships in this repo: `bridge/mc-bridge-sync.py` (Python 3, stdlib only) reads OpenClaw via the `openclaw` CLI and POSTs agents/sessions/calendar/usage/approvals snapshots + `run.*` events to `http://127.0.0.1:3000/events`.',
      'It reads `INGEST_TOKEN` from the **root `.env`** (step 3) and sends it as `x-ingest-token` on POST /events. Every other write route checks that same header. Set it explicitly. The bridge refuses a blank token.',
      'Try `--dry-run` first, then a real sync, then schedule it every ~5 min (system cron or an OpenClaw cron job — see `bridge/README.md`). A 401 means the bridge and api disagree on the token (blank `INGEST_TOKEN` → compose uses `dev-ingest-token`).',
      'Merge `bridge/openclaw.starter.json` into `~/.openclaw/openclaw.json` (do not replace the whole file). Mission Control’s starter is `agents.defaults.subagents.maxChildrenPerAgent` = 3 and `maxConcurrent` = 4. The api does not read these — they cap OpenClaw fan-out.',
    ],
    commands: [
      { label: 'Preview, then sync once', cmd: 'python3 bridge/mc-bridge-sync.py --dry-run\npython3 bridge/mc-bridge-sync.py' },
    ],
    links: [{ label: 'bridge/README.md', to: 'https://github.com/jaysinghcodes/mission-control/blob/main/bridge/README.md', external: true }],
    confirmable: true,
  },
  {
    id: 7,
    title: 'Connect from another machine (optional)',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    body: [
      'Run the exact command for the OS you are on, replacing `<your-server-ip>` with your OpenClaw host (public IP or tailnet name).',
      'Port 5173 is the dashboard. Port 3000 is the API. Vite listens on 127.0.0.1:5173, so this tunnel reaches it. Keep the SSH session open while you browse.',
    ],
    probe: 'health',
    confirmable: false,
  },
  {
    id: 8,
    title: 'Smoke test',
    phase: 'here',
    phaseLabel: 'YOU ARE HERE',
    // Ticket 3: mirror ONBOARDING.md step 8 — say plainly what works with no
    // OpenClaw vs what needs the step-6 bridge (no overclaiming).
    body: [
      '**No OpenClaw needed:** Tickets — create one on Backlog → To-Do → Build → QA → Review → Done; every move persists and survives a refresh.',
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

/** Render body/desc text: `backtick` → inline mono code, **double-star** → emphasis. */
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
      // clipboard unavailable (permissions etc.) — degrade silently
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

/** Secrets callout — step 3 only. Verbatim guardrail stance + the root-.env vars. */
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
            Never invent or guess credentials — ask the human who owns them.
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-mc-sub">
            Pause and ask for every real secret; redact secrets in any echoed output; show the command before running it;
            side-effecting actions stay approval-gated.
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-mc-border/60 pt-3">
        <SectionLabel>Required vars — the root .env</SectionLabel>
        <div className="mt-2.5 space-y-2.5">
          {vars.map((v) => (
            <div key={v.name}>
              <div className="font-mono text-[12.5px] font-semibold text-mc-text">{v.name}</div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-mc-sub">{fmt(v.desc)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[12px] text-mc-faint">{fmt('`.env` is git-ignored — never commit it.')}</p>
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
      {/* Number ring — done = ✓, active = current step, pending otherwise */}
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
                  {l.label} ↗
                </a>
              ) : (
                <Link
                  key={l.label}
                  to={l.to}
                  className="inline-flex h-8 items-center rounded-full border border-mc-border bg-mc-card px-4 text-[12.5px] font-semibold text-mc-sub transition-colors duration-150 hover:text-mc-text focus:outline-none focus-visible:ring-2 focus-visible:ring-mc-primary"
                >
                  {l.label} →
                </Link>
              ),
            )}
          </div>
        )}
        {children}
        {step.confirmable &&
          (confirmed ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-mc-greentext">
              <span>✓ Done — you confirmed this</span>
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
              <PillButton label="✓ Mark done — I did this" onClick={() => onConfirm(step.id)} />
            </div>
          ))}
      </div>
    </div>
  )
}
