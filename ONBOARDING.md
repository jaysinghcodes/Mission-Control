# ONBOARDING.md — Mission Control guided install

> **How to use this:** paste this file (or its full contents) to your OpenClaw agent
> from the directory where you cloned this repo. The agent walks you through the
> install step by step, pausing to ask you for every real secret. It will not
> invent credentials, and it keeps side-effecting actions approval-gated.

---

You are helping your operator install **Mission Control**, a self-hostable
command-center dashboard for their OpenClaw setup (web: React 19 + Vite + Tailwind v4;
api: NestJS + Socket.IO + Prisma 7 + Postgres). It shows live agent activity,
tickets, calendar (cron jobs), approvals, health, usage, and the Office floor —
fed by the operator's real OpenClaw instance through the vendored `bridge/`
over a token-guarded ingest endpoint. Without OpenClaw it still runs: the
tickets loop works out of the box and `npm run seed:demo` fills sample data.

The web app uses **hash routes**: every page URL looks like
`http://localhost:5173/#/tickets` (a plain `/tickets` shows Overview). All URLs
below use the `/#/` form.

Guide the operator through the numbered steps below, one at a time. Follow these
rules throughout:

- **Never fabricate or guess secrets.** Whenever a step needs a real value (a
  database URL, an ingest token, an API key), STOP and ask the operator to paste
  it. Wait for their answer before continuing. If they do not have one yet, tell
  them exactly where to get it and pause.
- **Confirm before acting.** Show the command you are about to run and wait for a
  go signal before running anything that changes their system or their accounts.
- **Keep side-effecting actions approval-gated.** Do not disable, bypass, or work
  around the approval flow. Anything that writes to external services stays gated.
- **Explain results.** After each step, briefly confirm what happened and what
  comes next. If something errors, help debug before moving on.
- **Redact secrets** in anything you echo back. Never print full keys or tokens.

Work through the steps in order:

### Step 1 — Confirm prerequisites
Verify the operator has each of these; ask them to confirm or help them install:
- **Node.js 20.17+ (or 22.9+)** (`node -v`) — the root `packageManager` is
  `npm@11.17.0`, which requires `^20.17 || >=22.9` — and **git** (`git --version`)
- **Docker** with the compose plugin (`docker compose version`) — used for
  Postgres (and optionally the api + web containers)
- Optional: their **OpenClaw instance** running — it is the live data source
  (Step 6). Without it, the tickets loop works and `npm run seed:demo` provides
  sample agents, cron jobs and activity

### Step 2 — Clone and install
```sh
git clone <repo-url> mission-control && cd mission-control
npm ci
```
Confirm `npm ci` finished without errors. (The lockfile records native
bindings for every platform — Linux x64/arm64, macOS, Windows — so this works
on a fresh clone on any of them; use `npm install` only to change deps.)

### Step 3 — Create the environment file: the **root** `.env`
Docker Compose reads exactly one env file: the **root `.env`** (next to
`docker-compose.yml`). The api container never loads `apps/api/.env` — in Docker
its environment comes entirely from compose (`environment:` in
`docker-compose.yml`). `apps/api/.env.example` is only a template for non-Docker
runs, so use the root template here:
```sh
cp .env.example .env
```
Go through each variable with the operator. For each one, ask them to paste the
real value, then write it into `.env` — never invent one:
- `DATABASE_URL` — leave the template default (compose's Postgres matches it);
  change it only if the operator overrides `POSTGRES_PASSWORD` in `.env`
- `INGEST_TOKEN` — shared secret for the event bridge. You MAY generate this one
  locally with `openssl rand -hex 24` (it is a random secret, not an account
  credential), then show it to the operator — it also goes into their OpenClaw
  bridge config. If left blank, compose falls back to `dev-ingest-token`
- `SOCKET_TOKEN` — optional; guards the dashboard's live socket when the api runs
  in production mode. Leave blank to use the compose default `dev-socket-token`
  (the stack is loopback-only). If the operator sets a real value, set it
  **before the first `docker compose build`** — it is baked into the web bundle
- `WEB_ORIGIN` — the template default covers `localhost` + `127.0.0.1`; add their
  tunnel origin later if they access the dashboard remotely
- `OPERATOR_NAME` — optional, **display only, not a secret**: the operator's
  name for the Overview greeting and the default assignee of new tickets/runs.
  Compose passes it to the api and bakes it into the web bundle
  (`VITE_OPERATOR_NAME`). Blank → neutral "Good evening" / "Operator". On the
  non-Docker path also set `VITE_OPERATOR_NAME`
- Optional: `GITHUB_TOKEN` (PR approvals → auto-merge from the Approvals page),
  `DEEPSEEK_API_KEY` / `ZAI_API_KEY` (live balances on Health/Usage) — ask the
  operator to paste these only if they want those features; everything else works
  without them.

`.env` is git-ignored — never commit it.

### Step 4 — Start the stack
```sh
docker compose up -d --build
docker compose ps
```
Wait for all three services to be up (db healthy, api, web). The first `--build`
compiles the images, so it takes a while. Confirm the api is **not** crash-looping:
`docker compose logs api` should end with the Prisma migrations applied and
`mission-control api listening on 0.0.0.0:3000`.

No OpenClaw yet (or just want to look around)? Seed sample data — idempotent,
safe to re-run, never touches non-demo rows:
```sh
npm run seed:demo
```

If they prefer running without Docker (Postgres still required — a local Postgres
or just the compose `db` service):
```sh
# export the root .env, migrate, then start api + web together
set -a; . ./.env; set +a
(cd apps/api && npx prisma migrate deploy)
npm run dev   # turbo: api (nest start --watch) + web (vite) in parallel
```
The api reads `process.env` directly and has no `.env` loader of its own, so the
`set -a; . ./.env` export above is required on the non-Docker path (turbo.json
passes those variables through to the dev tasks). To run one app on its own:
`npm run dev -w apps/api` or `npm run dev -w apps/web`.

### Step 5 — Verify the dashboard
Ask the operator to open `http://localhost:5173/#/`. Confirm:
- The Overview loads and the topbar shows a green "Connected" dot (live socket)
- `http://localhost:5173/#/health` shows real uptime, client count, and
  database state
- Empty states show actions, never fake numbers

If the dot stays red on the Docker path, the api is down or the `SOCKET_TOKEN`
baked into the web build does not match the api's — set it in `.env` and rebuild
with `docker compose up -d --build`.

### Step 6 — Connect their OpenClaw (the bridge)
Optional — skip if the operator has no OpenClaw instance yet. The bridge ships
in this repo at `bridge/` (see `bridge/README.md` for the full event contract).
`bridge/mc-bridge-sync.py` is Python 3 stdlib-only: it reads OpenClaw state via
the `openclaw` CLI and POSTs agents/sessions/calendar/usage/approvals snapshots
plus `run.*` events to `http://127.0.0.1:3000/events` with header
`x-ingest-token`. It reads `INGEST_TOKEN` from the **root `.env`** (Step 3) —
set it explicitly there; the bridge refuses to guess and exits if it is blank.
```sh
python3 bridge/mc-bridge-sync.py --dry-run   # show what would be sent (token never printed)
python3 bridge/mc-bridge-sync.py             # one real sync
```
Then schedule it every ~5 minutes (system cron with absolute paths, or an
OpenClaw cron job — examples in `bridge/README.md`). Confirm the Live Activity
band shows real events after a sync. A 401 means the bridge and the api disagree
on the token — an unset `INGEST_TOKEN` in `.env` makes compose fall back to
`dev-ingest-token` for the api.

### Step 7 — Connect from another machine (optional)
If the operator wants remote access, point them at the
`http://localhost:5173/#/connect` page in the dashboard: it gives OS-specific
SSH tunnel instructions and verifies the connection live before handing off.

### Step 8 — Smoke test
Walk the operator through the core loops so they trust the data. Be explicit
about which checks need OpenClaw — do not claim more than they verify.

**Works with no OpenClaw (fresh clone, bridge not connected):**
1. **Tickets loop:** create a ticket on `http://localhost:5173/#/backlog` → it
   appears in the Backlog list; click **→ To-Do** on its row → it moves to the
   To-Do column on `http://localhost:5173/#/tickets`; then use the card buttons
   to move it Build → QA → Review → Done. Every move is a button
   (`PATCH /tickets/:id`), and the api writes a `run.*` row to the persisted
   activity stream. Refresh at any point — the ticket stays where you left it.
2. **Seeded demo** (after `npm run seed:demo`): `/#/calendar` shows the 6 sample
   cron jobs on the weekly grid (‹ › navigation works), `/#/team` shows the
   8 sample agents in the org chart, `/#/office` places them in rooms by role,
   and `/#/activity` lists the sample history. Demo agents and tickets are
   labelled "Demo …" / `DEMO-n`.

**Needs the Step 6 bridge + a running OpenClaw:**
3. **Calendar** lists the operator's *real* OpenClaw cron jobs (the
   `calendar.snapshot` replaces the demo jobs).
4. **Team / Office** show the *real* roster; bots move between rooms when real
   cron runs fire `run.*` events. (Ticket moves also emit `run.*`, so a bot may
   nudge locally — that is not proof the bridge works.)
5. **Live Activity** fills with real agent work between syncs.

Once the tickets loop (1) passes, the core write path is verified without
OpenClaw. Items 3–5 complete the full install once the bridge is connected.
Thank the operator and summarize what was set up, where secrets live, and what
is intentionally still optional.
