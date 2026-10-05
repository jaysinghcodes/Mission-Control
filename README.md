# Mission Control

Command center for agent orchestration — manage work, review & gate, and observe live activity.
Mission Control is the dashboard layer for Jay's OpenClaw setup ("the empire"): scheduled runs,
agents, approvals, and real-time activity, rendered as a dark-first, design-token-driven web app.

**Status:** foundation live — Overview screen with a real WebSocket activity feed fed by OpenClaw itself.

---

## What this is

Mission Control is a **Turborepo monorepo** with two apps:

| App | Path | Stack | What it does |
| --- | --- | --- | --- |
| `web` | `apps/web` | React 19 + Vite 8 + Tailwind CSS v4 | Dashboard UI (Overview + Live Activity band today; Tasks, Agents, Approvals, Health… on the roadmap) |
| `api` | `apps/api` | NestJS 11 + Socket.IO + Prisma 7 (pg adapter) | Backend: health probe, WebSocket event bus, external event intake, Postgres persistence |

The wiring is deliberately simple at this stage: **the web app connects to the API over a
Socket.IO WebSocket and renders whatever typed events the API broadcasts.** OpenClaw pushes
real activity into the API through a small token-protected ingest endpoint, so the dashboard
shows genuinely live events (scheduled runs, agent work, health ticks) — never fake data.

---

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────────────────┐
│         OpenClaw            │         │              Mission Control             │
│  (agent runtime, cron jobs) │         │                                          │
│                             │         │  ┌──────────────┐   Socket.IO (WS)   ┌───┴───────┐
│  Cron bridge job (every 5m) │────────▶│  │   api :3000  │──────────────────▶ │  web:5173 │
│  digests real session/run   │  POST   │  │              │  broadcast events  │  React UI │
│  activity                  │  /events│  │  ingest →     │                    │           │
└─────────────────────────────┘  token  │  │  gateway →    │◀── hello / health  │  Overview │
                                        │  │  socket.io    │    tick (30s)      │  Live Feed│
                                        │  │               │                    └──────────┘
                                        │  │  /health      │  (honest: db state,│
                                        │  │  Prisma 7 +   │   client count,    │
                                        │  │  Postgres     │   uptime)          │
                                        │  └──────────────┘                     │
                                        └────────────────────────────────────────┘
```

### Event flow (the Live Activity feed)

1. **Producers** — OpenClaw (via the cron bridge job) POSTs a typed event to
   `POST http://127.0.0.1:3000/events` with an `x-ingest-token` header.
2. **Ingest** — `IngestController` validates the token and the event type against a
   closed union (`run.started`, `run.completed`, `run.failed`, `health.tick`, `hello`);
   unknown types are rejected (400), unauthenticated requests fail closed (401).
3. **Gateway** — `LiveActivityGateway` broadcasts the event to every connected socket
   client with a server timestamp.
4. **Dashboard** — `useLiveActivity` (a React hook in `apps/web`) subscribes with
   `socket.io-client`, keeps the most recent 50 events, and renders them in the
   Live Activity band with a stable per-type color map. Connection state drives an
   honest green/red status dot in the topbar — no fake "online".
5. **Heartbeat** — `HealthTickerService` broadcasts `health.tick` every 30 s
   (`HEALTH_TICK_MS`, `0` disables) so the feed always has current, real data.

### API surface

| Endpoint | Transport | Purpose |
| --- | --- | --- |
| `GET /health` | HTTP | Liveness + readiness: `status` (`ok`/`degraded`), uptime, connected socket clients, real DB connectivity. Never fakes 100%. |
| `POST /events` | HTTP | Event intake for trusted producers (OpenClaw). Guarded by `INGEST_TOKEN` (fail-closed in production). |
| Socket.IO `/` | WS | Live feed: server-authoritative typed events with `ts` timestamps. Production requires `SOCKET_TOKEN` in the handshake. |

### Data model (Prisma 7, Postgres)

- **`Run`** — scheduled runs / jobs the dashboard observes (`Morning Brief`, `Trend Radar`, …):
  `name`, `status` (`queued | running | done | failed`), `startedAt`, `finishedAt`.
- **`Agent`** — the agent roster with color-coding used across the UI: `name` (unique), `color`
  (design-token values: `purple | amber | green | teal`).

Migrations are a security red line in this project: schema changes are human-reviewed and
never auto-applied by the app. In dev, `npx prisma db push` syncs the schema.

### Security posture (hard requirement)

- **Loopback only** — the API binds `127.0.0.1` by default (`HOST` env overrides); it is never
  exposed publicly without explicit intent. The Vite dev server is loopback too.
- **Fail-closed auth** — production refuses to boot without `DATABASE_URL`; the socket rejects
  handshakes without a valid `SOCKET_TOKEN`; ingest rejects requests without a valid `INGEST_TOKEN`.
- **Locked CORS** — both the HTTP layer and the WebSocket handshake are locked to `WEB_ORIGIN`
  (default `http://localhost:5173`); never a wildcard.
- **No secrets in code** — all env values come from `.env` (git-ignored) / deploy env. See
  `apps/api/.env.example` for the shape.

---

## Layout

```
apps/web/                  React dashboard
  src/App.tsx              Overview shell: sidebar, KPIs, Live Activity band
  src/hooks/useLiveActivity.ts   Socket.IO subscription hook
  src/index.css            Design tokens (Tailwind v4 @theme) — dark-first
apps/api/                  NestJS backend
  src/main.ts              Bootstrap: CORS lock, loopback bind
  src/app.module.ts        Root module wiring
  src/health/              GET /health + HealthTickerService (30s health.tick)
  src/live-activity/       Socket.IO gateway (typed broadcast bus)
  src/ingest/              POST /events intake (OpenClaw feed door)
  src/prisma/              PrismaService (pg adapter, honest dbReady)
  prisma/schema.prisma     Postgres schema (Run, Agent)
  prisma.config.ts         Prisma 7 config (DATABASE_URL resolution)
design/                    IA flow, wireframes, design tokens (source of truth)
logos/                     Brand explorations
```

---

## Running locally

### Quickest: Docker (clone-and-run)

Prereqs: Docker + Docker Compose.

```bash
cp .env.example .env      # fill in INGEST_TOKEN at minimum
cp apps/api/.env.example apps/api/.env 2>/dev/null || true
docker compose up --build
```

- Postgres 16 on `127.0.0.1:5432` (volume `mc-db`)
- API on `http://localhost:3000` (runs `prisma migrate deploy` on boot)
- Web on `http://localhost:5173`

### Manual (no Docker)

Prereqs: Node 20+ (tested on 26), npm, Postgres 16.

```bash
# 1. Install (exact lockfile) + generate Prisma client
#    The lockfile records native bindings for every platform (linux x64/arm64,
#    macOS, Windows), so `npm ci` works on a fresh clone on any of them.
npm ci
(cd apps/api && npx prisma generate)

# 2. Postgres: create the dev database
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres psql -c "CREATE DATABASE mission_control;"

# 3. Apply schema — use MIGRATIONS in shared/dev; db push is dev-only
(cd apps/api && npx prisma migrate deploy)   # or: npx prisma db push (dev only)

# 4. Env (see .env.example; never commit real values)
#    The api has NO .env loader — it reads process.env — so export the root
#    .env into your shell first (DATABASE_URL, PORT, HOST, WEB_ORIGIN,
#    INGEST_TOKEN, SOCKET_TOKEN, GITHUB_TOKEN, …). Unset values fall back to
#    dev defaults (e.g. postgres://postgres:postgres@localhost:5432/mission_control).
#    apps/web/.env  ← optional VITE_API_URL (default http://localhost:3000)
cp .env.example .env
set -a; . ./.env; set +a

# 5. Run both apps from the repo root (one terminal)
npm run dev        # turbo: api `dev` (nest start --watch) + web `dev` (vite) in parallel
#  (turbo.json passes the api env vars through to the dev tasks)
#  Individually: npm run dev -w apps/api   /   npm run dev -w apps/web
```

Verify: `curl http://127.0.0.1:3000/health` → `{"status":"ok",...,"database":"connected"}`,
then open **http://localhost:5173** — the topbar dot should be green and the Live Activity
band fills with `hello`, periodic `health.tick`, and OpenClaw-run events.

> **Shipping note:** the event bridge now ships in the repo at [`bridge/`](bridge/README.md)
> (it previously lived only at `~/.openclaw/.mc-bridge-sync.py`). It reads OpenClaw's own
> state via the `openclaw` CLI and is optional for a standalone clone. Everything else runs
> on env vars + Postgres alone.

### No OpenClaw? Demo data

On a machine without OpenClaw, seed sample agents, cron jobs, tickets and activity so the
Board, Calendar, Team and Office are clickable:

```bash
npm install
docker compose up -d --build   # or the manual Postgres setup above
npm run seed:demo              # idempotent — safe to re-run; data persists in the mc-db volume
```

Logs and search show a clean "no gateway log source" empty state when `/tmp/openclaw` is
missing (always true inside the api container) — never an error.

### Build / test / lint

```bash
npm run build      # turbo build (tsc + vite + nest)
npm test           # turbo run test → api jest unit tests (no DB needed)
npm run test:e2e   # turbo run test:e2e → api e2e; needs a migrated Postgres at DATABASE_URL
npm run lint
```

---

## OpenClaw integration

Mission Control is fed by the OpenClaw instance on the same box through the vendored
bridge in [`bridge/`](bridge/README.md). Run it every ~5 minutes (system cron or an
OpenClaw cron job):

```bash
python3 bridge/mc-bridge-sync.py            # one sync; reads INGEST_TOKEN from the root .env
python3 bridge/mc-bridge-sync.py --dry-run  # print the events instead of posting
```

Each run posts `agents.snapshot`, `sessions.snapshot`, `calendar.snapshot`,
`usage.snapshot`, `approvals.snapshot` and `run.*` events to `POST /events` with the
`x-ingest-token` header. The full event contract (payload shapes, sources, safety rules)
is documented in [`bridge/README.md`](bridge/README.md). A single event looks like:

```bash
curl -s -X POST http://127.0.0.1:3000/events \
  -H "content-type: application/json" -H "x-ingest-token: $INGEST_TOKEN" \
  -d '{"type":"run.completed","payload":{"name":"Trend Radar","status":"done"}}'
```

The feed is transport-agnostic: any trusted producer can push the same typed events.

---

## Dev workflow (mandatory)

- **No direct merges to `main`** — everything lands via PR, reviewed by Jay. (Exception:
  hotfixes + docs explicitly requested by Jay, e.g. the Aug 10 bring-up commit.)
- **Merge → delete branch** — immediately after a PR merges, delete the source branch
  (local AND remote). No lingering branches; `main` is the only long-lived branch.
- PRs are kept small (2–3 logical PRs per feature batch) for readability.
- Heavy inline comments on all new code.
- Run the development skills before committing: `vibe-dev-workflow` (PLAN/ACT, Design Doc,
  LOG.md, acceptance checklist) and `task-development-workflow` (TDD, task tracking, PR review).
- Security red lines: auth, DB schema, secrets are human-reviewed line by line.

## Roadmap

1. ✅ `feat/1-web-scaffold` — monorepo + shell + tokens + Overview
2. ✅ `feat/2-api-foundation` — NestJS, Socket.IO gateway, Prisma schema, health
3. ✅ `feat/3-live-feed` — web ↔ socket wiring, real activity feed
4. ✅ OpenClaw feed — ingest endpoint + health ticker + cron bridge (Aug 10)
5. 🔜 Tasks / Agents screens, run persistence, approvals, Trend Radar
