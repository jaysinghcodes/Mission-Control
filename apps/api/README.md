# Mission Control — API (`apps/api`)

NestJS 11 backend for [Mission Control](../../README.md): REST endpoints for tickets, runs, agents, calendar, approvals, sessions, usage, logs, search and health; a Socket.IO live-activity gateway; and a token-guarded `POST /events` ingest door for the OpenClaw [bridge](../../bridge/README.md). Persistence is Postgres via Prisma 7 (9 models in [`prisma/schema.prisma`](prisma/schema.prisma)).

## Scripts

Run from the repo root with `-w apps/api`, or from this directory.

| Script | What it does |
| --- | --- |
| `npm run dev` | `nest start --watch` (reads `process.env` — export the root `.env` first) |
| `npm run build` | `nest build` → `dist/` |
| `npm run start:prod` | `node dist/main` |
| `npm test` | Jest unit tests (`src/**/*.spec.ts`, no DB needed) |
| `npm run test:e2e` | e2e tests — needs a migrated Postgres at `DATABASE_URL` |
| `npm run seed:demo` | Idempotent sample data (agents, cron jobs, tickets, activity, approval, memories, one experimental custom tool, and markdown docs under `DOCS_ROOT`). Also `npm run seed:demo` from the root. Refuses `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. |
| `npm run lint` | ESLint |

Schema: `npx prisma migrate deploy` (Docker does this on boot). Schema changes are human-reviewed — never auto-applied.

## Environment

The api has **no `.env` loader**: it reads `process.env`. Docker Compose injects values from the **root** `.env`; for `npm run dev`, `set -a; . ./.env; set +a` first. Template: [`../../.env.example`](../../.env.example) (or [`.env.example`](.env.example) for api-only runs).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mission_control` | Required in production (no localhost fallback). |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Loopback by default. Compose sets `HOST=0.0.0.0` inside the container but publishes on `127.0.0.1` only. |
| `WEB_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` (compose: `http://localhost:5173`) | Comma-separated CORS allowlist for HTTP + WebSocket. Never `*`. |
| `INGEST_TOKEN` | — | Shared secret for `POST /events` (`x-ingest-token`). Fail-closed in production. |
| `SOCKET_TOKEN` | — | Socket.IO handshake guard (required when `NODE_ENV=production`). Must match the web build's `VITE_SOCKET_TOKEN`. |
| `OPERATOR_NAME` | blank → `Operator` | **Display only, not a secret.** Default assignee for new tickets (`POST /tickets`) and runs (`POST /runs`). See `src/config/operator.ts`. |
| `GITHUB_TOKEN` | — | Optional: PR approvals → auto-merge. |
| `DEEPSEEK_API_KEY` / `ZAI_API_KEY` | — | Optional: live provider balances on Health/Usage. |
| `HEALTH_TICK_MS` | `30000` | `health.tick` broadcast interval; `0` disables. |
| `DOCS_ROOT` | `<repo>/data/docs` | Markdown library for `GET /docs`. Absolute, or relative to the repo root. The browser never receives a filesystem path. Missing or empty → `{ docs: [] }`. Compose sets the container value to `/data/docs` and bind-mounts the host path. |

## Layout

```
src/main.ts            bootstrap: CORS lock, loopback bind
src/config/            operator.ts (OPERATOR_NAME)
src/tickets/ runs/     ticket kanban + run lifecycle
src/ingest/ snapshots/ POST /events + bridge snapshot handling
src/live-activity/     Socket.IO gateway
src/health/            GET /health + HealthTickerService
prisma/                schema + migrations
scripts/seed-demo.ts   npm run seed:demo
```
