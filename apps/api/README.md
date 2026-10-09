# Mission Control API (`apps/api`)

NestJS 11 backend for [Mission Control](../../README.md). REST for tickets, runs, agents, projects, calendar, approvals, sessions, usage, memory, docs, logs, search, and health. Socket.IO for the live feed. `POST /events` is the OpenClaw door. See [docs/OPENCLAW_ONBOARDING.md](../../docs/OPENCLAW_ONBOARDING.md) and [bridge/README.md](../../bridge/README.md).

Postgres through Prisma 7. Models are listed in [`prisma/schema.prisma`](prisma/schema.prisma): Agent, Run, Project, Ticket, Session, CronJob, UsageSnapshot, ActivityEvent, Approval, MemoryEntry, ModelConfig, Setting, Device, CustomTool.

## Scripts

Run from the repo root with `-w apps/api`, or from this directory.

| Script | What it does |
| --- | --- |
| `npm run dev` | `nest start --watch`. Export the root `.env` first. This process does not load `.env` itself. |
| `npm run build` | `nest build` |
| `npm run start:prod` | `node dist/main` |
| `npm test` | Jest. Most suites mock Prisma and need no database. `src/ingest/ingest.controller.spec.ts` boots the real app: the ingest door tests and the agent snapshot tests need a migrated Postgres at `DATABASE_URL`. Export the root `.env` (`set -a; . ./.env; set +a`), generate the client, and run `npx prisma migrate deploy` in this directory before `npm test` when that database is not already up. |
| `npm run test:e2e` | Separate Jest config under `test/`. Also needs a migrated Postgres at `DATABASE_URL`. |
| `npm run seed:demo` | Sample data. Also `npm run seed:demo` from the root. Refuses `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. |
| `npm run lint` | ESLint |

Schema: `npx prisma migrate deploy` from this directory. Schema changes are human reviewed. `npm run dev` does not migrate. The Docker image does, on container boot.

## Environment

Template: [`../../.env.example`](../../.env.example). For `npm run dev`, `set -a; . ./.env; set +a` in the repo root before turbo starts.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mission_control` | Required when `NODE_ENV=production` |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Compose sets `HOST=0.0.0.0` inside the container and publishes `127.0.0.1` only |
| `WEB_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Comma separated CORS list. Never `*` |
| `INGEST_TOKEN` | empty in code, placeholder in the example file | `x-ingest-token` for `POST /events`. Production fails closed |
| `SOCKET_TOKEN` | empty | Required for the socket handshake when `NODE_ENV=production` |
| `OPERATOR_NAME` | blank, then `Operator` | Display only. Default assignee for new tickets and runs |
| `GITHUB_TOKEN` | empty | Optional pull request merge from Approvals |
| `DEEPSEEK_API_KEY` / `ZAI_API_KEY` | empty | Unused by the API. Spend comes from `usage.snapshot` |
| `HEALTH_TICK_MS` | `30000` | Socket `health.tick` interval. `0` disables it |
| `DOCS_ROOT` | `<repo>/data/docs` | Markdown for `GET /docs`. The browser never receives a filesystem path |

## Layout

```
src/main.ts            CORS and bind
src/ingest/            POST /events
src/snapshots/         snapshot table sync
src/live-activity/     Socket.IO gateway
src/health/            GET /health and the ticker
prisma/                schema and migrations
scripts/seed-demo.ts   npm run seed:demo
```
