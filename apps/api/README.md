# Mission Control API (`apps/api`)

NestJS 11 backend for [Mission Control](../../README.md). REST for tickets, runs, agents, projects, calendar, approvals, sessions, usage, memory, docs, logs, search, and health. Socket.IO for the live feed. `POST /events` is the OpenClaw door. See [docs/OPENCLAW_ONBOARDING.md](../../docs/OPENCLAW_ONBOARDING.md), [docs/API.md](../../docs/API.md) (the 401 line is in section 4.1), and [bridge/README.md](../../bridge/README.md).

Postgres through Prisma 7. Models are listed in [`prisma/schema.prisma`](prisma/schema.prisma): Agent, Run, Project, Ticket, Session, CronJob, UsageBucket, ActivityEvent, Approval, MemoryEntry, ModelConfig, Setting, Device, CustomTool.

## Scripts

Run from the repo root with `-w apps/api`, or from this directory.

| Script | What it does |
| --- | --- |
| `npm run dev` | `nest start --watch`. The process loads the root `.env` and runs `prisma migrate deploy` before it listens. Export the root `.env` as well so the Vite dev proxy sees `INGEST_TOKEN`. |
| `npm run build` | `nest build` |
| `npm run start:prod` | `node dist/main` |
| `npm test` | Jest. Global setup writes with `TEST_DATABASE_URL` only. It does not migrate the database named by `DATABASE_URL`. When `TEST_DATABASE_URL` is unset, setup creates `mc_test_<random>` on that server, migrates it, and drops it afterward. If creating a database is not permitted, setup uses a throwaway schema and drops that schema afterward. Before any write, when both URLs are set, setup connects to each one and compares server identity. The same database as `DATABASE_URL`, including another host name or socket that reaches it, makes the run refuse before it writes. If `DATABASE_URL` is unset or cannot be reached, that check is skipped. Postgres must be reachable. Generate the client first (`npx prisma generate`). |
| `npm run test:e2e` | Separate Jest config under `test/`. Also needs a migrated Postgres at `DATABASE_URL`. |
| `npm run seed:demo` | Sample data. Also `npm run seed:demo` from the root. Not part of a fresh setup. Refuses `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. |
| `npm run seed:clear` | Deletes only the rows `seed:demo` created. Registered, snapshot, and API created rows stay. Idempotent. Same production guard. |
| `npm run login:reset` | Clears login lockouts in the API on this machine. It calls `POST /auth/login-reset` on `127.0.0.1`. Under Compose run `docker compose exec api npm run login:reset`. |
| `npm run lint` | ESLint |

Schema: `npx prisma migrate deploy` from this directory, and again on API boot (`apps/api/src/boot.ts`). Schema changes are human reviewed. Boot applies those reviewed migrations. It does not create new ones.

## Environment

Template: [`../../.env.example`](../../.env.example). The API loads the root `.env` on boot and does not replace variables that are already set. For `npm run dev`, `set -a; . ./.env; set +a` in the repo root before turbo starts so Vite sees the file. The dev proxy does not attach a token.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mission_control` | Required when `NODE_ENV=production`. `npm test` does not migrate this database. When `TEST_DATABASE_URL` is also set, setup connects here only to compare server identity before any write |
| `TEST_DATABASE_URL` | unset | Optional database for `npm test`. Unset creates `mc_test_<random>` and drops it afterward. The same database as `DATABASE_URL`, including an alias that reaches it, refuses the run. If `DATABASE_URL` is unset or cannot be reached, that check is skipped |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Compose sets `HOST=0.0.0.0` inside the container and publishes `127.0.0.1` only |
| `WEB_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Comma separated CORS list. Never `*` |
| `INGEST_TOKEN` | empty in code, placeholder in the example file | `x-ingest-token` for agent ingest: `POST /events`, register, heartbeat, and run writes. Unset on loopback when `NODE_ENV` is not `production`: ingest stays open, one warning. Unset in production, including loopback: process starts and ingest returns 401. Unset on any other `HOST`: process refuses to start |
| `DASHBOARD_PASSWORD_HASH` | empty | scrypt hash of the dashboard password. Blank on loopback leaves the dashboard open. Required when `HOST` is not loopback, including Compose |
| `SESSION_SECRET` | empty | Signs the `mc_session` cookie. Required with the hash when `HOST` is not loopback |
| `SESSION_STATE_PATH` | `apps/api/data/session-state.json` | Session version and a changed password hash. Compose uses `/data/auth/session-state.json` on the `mc-auth` volume. A stored hash overrides `DASHBOARD_PASSWORD_HASH` on startup |
| `LOGIN_FAIL_LIMIT` | `5` | Wrong passwords per client IP before a wait. Loopback is exempt. Ingest is exempt |
| `LOGIN_WINDOW_SECONDS` | `60` | Failure window and the first wait, in seconds |
| `LOGIN_BACKOFF_MAX_SECONDS` | `900` | Longest wait, in seconds. Later lockouts double until this cap |
| `TRUSTED_PROXY` | empty | Extra peers allowed to supply `X-Forwarded-For` for the login bucket. Leave empty for Compose. Do not set the Docker bridge. This does not grant loopback |
| `BUNDLED_PROXY` | `web` when `MC_COMPOSE=1`, otherwise empty | Hostname or IP of the bundled nginx. Compose sets the web service name. The API resolves it and trusts forwarded client headers, and `X-MC-Remote`, only from that peer |
| `MC_REMOTE_PORT` | `3011` | Host port for the tunnel listener. Compose publishes it. The API does not read it. SSH uses `MC_WEB_PORT`. Laptop steps are in [docs/REMOTE.md](../../docs/REMOTE.md) |
| `SOCKET_TOKEN` | empty | Retired. The web bundle does not receive a socket token |
| `OPERATOR_NAME` | blank, then `Operator` | Display only. Default assignee for new tickets and runs |
| `GITHUB_TOKEN` | empty | Optional pull request merge from Approvals |
| `OPENCLAW_GATEWAY_HOST` | blank, then `127.0.0.1` | Direct probe host. Under Compose a blank host uses the bridge report instead of a probe from the container |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Port for a direct probe. Under Compose the bridge checks `127.0.0.1` on this port |
| `GATEWAY_STATUS_MAX_AGE_MS` | `600000` | Compose bridge report older than this is Unknown. A future checkedAt is counted from the time the API stored the report. Blank, 0, or invalid uses 600000 |
| `MC_COMPOSE` | unset | `docker-compose.yml` sets `1`. That selects the bridge report when the gateway host is blank |
| `OPENCLAW_LOG_DIR` | `/tmp/openclaw` | Directory of `openclaw-*.log` |
| `GIT_SHA` | git, or `git-sha.txt` in the image | Commit shown by `GET /health` |
| `TZ` | host zone | Server timezone when Settings has not saved one. The name has to be in `config/timezones.json`. A legacy name is converted. `TZ=Europe/Berlin` buckets usage and memory on Berlin days |
| `OFFLINE_AFTER_MS` | `600000` | How long a registered bot can go without a heartbeat before it is offline |
| `HEALTH_TICK_MS` | `30000` | Socket `health.tick` interval. `0` disables it |
| `USAGE_RETENTION_DAYS` | `30` | How many calendar days of usage a snapshot may keep, through today |
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
scripts/seed-clear.ts  npm run seed:clear
```
