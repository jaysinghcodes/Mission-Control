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
all fed by the operator's real OpenClaw instance over a token-guarded ingest
endpoint.

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
- Their **OpenClaw instance** running (this dashboard is useless without it —
  it is the data source)

### Step 2 — Clone and install
```sh
git clone <repo-url> mission-control && cd mission-control
npm install
```
Confirm `npm install` finished without errors.

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

If they prefer running without Docker (Postgres still required — a local Postgres
or just the compose `db` service):
```sh
# terminal 1 — export the root .env, migrate, then run the api in watch mode
set -a; . ./.env; set +a
cd apps/api && npx prisma migrate deploy && cd ..
npm run start:dev -w apps/api
# terminal 2 — web dev server
npm run dev -w apps/web
```
The api reads `process.env` directly and has no `.env` loader of its own, so the
`set -a; . ./.env` export above is required on the non-Docker path (the `dev`
script name does not exist in `apps/api/package.json` — use `start:dev`).

### Step 5 — Verify the dashboard
Ask the operator to open `http://localhost:5173`. Confirm:
- The Overview loads and the topbar shows a green "Connected" dot (live socket)
- `/health` shows real uptime, client count, and database state
- Empty states show actions, never fake numbers

If the dot stays red on the Docker path, the api is down or the `SOCKET_TOKEN`
baked into the web build does not match the api's — set it in `.env` and rebuild
with `docker compose up -d --build`.

### Step 6 — Connect their OpenClaw (the bridge)
The dashboard is only as live as the data it receives. The operator's OpenClaw
instance must POST typed events to `http://127.0.0.1:3000/events` with header
`x-ingest-token: <the INGEST_TOKEN from Step 3's root .env>`. The standard pattern
is a cron bridge job in the OpenClaw workspace that pushes
agents/sessions/calendar/usage/approvals snapshots + run events (see the repo
README's "Event flow" section). Confirm the bridge is running and the Live
Activity band starts showing real events within a minute. If no events appear,
check the bridge sends the **same** token compose sees — an unset `INGEST_TOKEN`
in `.env` silently falls back to `dev-ingest-token`, and the bridge would get 401.

### Step 7 — Connect from another machine (optional)
If the operator wants remote access, point them at the **/connect** page in the
dashboard: it gives OS-specific SSH tunnel instructions and verifies the
connection live before handing off.

### Step 8 — Smoke test
Walk the operator through the core loops so they trust the data:
1. **Tickets (no OpenClaw required):** create one on `/tickets` → it lands in
   To-Do; click Start → move it Build → QA → Review → Done. Each move is a
   `PATCH /tickets/:id` and the API itself writes a `run.*` row to the activity
   stream, so this loop passes on a fresh clone before the bridge is connected.
   Creating from `/backlog` with status `backlog` should appear on that page,
   not in To-Do.
2. **Calendar:** all their OpenClaw cron jobs are listed (weekly grid, ‹ › week
   navigation works). Needs the Step 6 bridge.
3. **Office:** agents physically move between rooms when a `run.*` event fires.
   Needs the Step 6 bridge (or the ticket moves above, which also emit `run.*`).
4. **Live Activity:** recently run tasks show up there. Ticket moves alone are
   enough to prove the band; OpenClaw enriches it further.

Once the **Tickets** loop in (1) passes, the core dashboard write-path is
verified even without OpenClaw. Items 2–4 complete the full install once the
bridge from Step 6 is connected. Thank the operator and summarize what was set
up, where secrets live, and what is intentionally still optional.
