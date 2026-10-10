# Mission Control onboarding for OpenClaw agents

Paste this whole file into your OpenClaw instance. It is written to you, the agent.

Everything below was checked against the Mission Control source at https://github.com/jaysinghcodes/Mission-Control. If something here disagrees with the code you see, trust the code and tell your operator.

## 1. What Mission Control is

Mission Control is a self hosted dashboard for an OpenClaw setup. Your operator runs it on their own machine. It shows your tickets moving through a build pipeline, your runs, your roster, cron jobs, memory notes, approvals, sessions, and model spend.

It is a turbo monorepo:

| Part | Path | Stack |
| --- | --- | --- |
| Web dashboard | `apps/web` | React 19, Vite, Tailwind v4, Socket.IO client |
| API | `apps/api` | NestJS 11, Socket.IO, Prisma 7, Postgres 16 |
| Bridge | `bridge/mc-bridge-sync.py` | Python 3.8+, stdlib only |

Data reaches Mission Control two ways:

1. **Snapshot and event intake:** `POST /events` with a shared token. This is how OpenClaw state (agents, sessions, cron, usage, approvals, memory) gets in. The bundled bridge does this for you.
2. **Direct REST calls:** tickets, projects, runs and models have their own routes. These are how you file and move work. When `INGEST_TOKEN` is set, those writes use the same `x-ingest-token` header as `POST /events`.

Every event is stored in the `ActivityEvent` table and broadcast live over Socket.IO to open dashboards.

## 2. Install and run

Prerequisites: Node 20.17+ or 22.9+, npm, git, Docker with the compose plugin. Python 3 if you will run the bridge.

```bash
git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control
cd mission-control
npm ci
cp .env.example .env
```

Edit `.env` before starting. Rules for you:

* **Never invent secrets.** Ask your operator for any real key.
* `INGEST_TOKEN`: the template value is `change-me`. Replace it with a random value (`openssl rand -hex 24` is fine) and tell your operator. Every write route checks it when it is set, including `POST /events`. The bridge refuses to run if this is blank. The web UI does not receive the value. Vite and nginx attach it.
* `OPERATOR_NAME`: display only. It becomes the default assignee for new tickets and runs.
* `SOCKET_TOKEN`: optional on the local stack. If set, it must be set before the first build because it is baked into the web bundle.
* `GITHUB_TOKEN`: optional. Lets approving a `pr` approval merge the PR on GitHub.
* `DEEPSEEK_API_KEY` and `ZAI_API_KEY` are in the template. The API does not read them. Spend on System comes from `usage.snapshot`, not a live provider call.
* Host ports can be moved with `MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT`.

Start the stack:

```bash
docker compose up -d --build
docker compose ps
docker compose logs api
```

The api log should end with `mission-control api listening on 0.0.0.0:3000`. Compose sets `HOST=0.0.0.0` inside the container and runs `prisma migrate deploy` on api boot. That log line is the process text in `apps/api/src/main.ts`.

Optional sample data (idempotent, only touches demo rows):

```bash
npm run seed:demo
```

Without Docker (Postgres still required):

```bash
set -a; . ./.env; set +a
(cd apps/api && npx prisma migrate deploy)
npm run dev
```

The api has no `.env` loader, so the `set -a` export is required on this path. Copy the root `.env.example` to the root `.env`. `apps/api/.env` is never loaded.

On npm 11.17.0, `npm ci` skips the Prisma install scripts. Run `(cd apps/api && npx prisma generate)` before `npm test` or `npm run build`, or those commands fail to find `.prisma/client`.

Useful URLs (the web app uses hash routes, so always include `/#/`):

| What | URL |
| --- | --- |
| Web app (redirects to Tasks) | http://localhost:5173/#/ |
| API health | http://localhost:3000/health |

Vite listens on `127.0.0.1:5173`. `http://127.0.0.1:5173` and `http://localhost:5173` both reach it when localhost resolves to that address. Call the API at `http://127.0.0.1:3000` or `http://localhost:3000`.

Other repo commands: `npm run build`, `npm test`, `npm run test:e2e` (needs a migrated Postgres), `npm run lint`.

## 3. What each screen shows

The sidebar order is Tasks, Agents, Approvals, Projects, Office, Pipeline, then Calendar, Memory, Docs, Team, System. Overview is not a route. `/#/` redirects to Tasks.

| Page | Route | What it shows | Fed by |
| --- | --- | --- | --- |
| Tasks | `/#/tasks` | Ticket kanban: To-Do, Build, QA, Review, Done. Backlog is `/#/tasks?view=backlog`. `/#/tickets` redirects to Tasks. `/#/backlog` redirects to the backlog view | `/tickets` |
| Agents | `/#/agents` | Agent roster and profiles | `agents.snapshot` |
| Approvals | `/#/approvals` | Pending and decided approvals | `approvals.snapshot`, `/approvals` |
| Projects | `/#/projects`, `/#/projects/:id` | Projects with ticket and done counts | `/projects` |
| Office | `/#/office` | Floor seats from role text and status (Build, QA, Ship, Deploy, Commons). `run.*` events show in the activity list. They do not move agents between rooms. `/#/activity` and `/#/factory` redirect here | events, `/agents` |
| Pipeline | `/#/pipeline` | Tickets as Build, QA, Ship, Deploy (statuses build, qa, review, done) | `/tickets`, `/approvals`, `/runs` |
| Calendar | `/#/calendar` | Weekly grid of cron jobs | `calendar.snapshot` |
| Memory | `/#/memory` | Memory notes grouped by day (America/Chicago) | `memory.snapshot` |
| Docs | `/#/docs` | Markdown files from `DOCS_ROOT` (default `data/docs`), read only in the browser | files on disk |
| Team | `/#/team` | Mission, people, and devices. Not an org chart | `agents.snapshot`, `/mission`, `/devices` |
| System | `/#/system` | Health, uptime, usage and cost (24h, 7d, month), sessions, activity. Panels: `/#/system/logs`, `/#/system/sessions`, `/#/system/settings`, `/#/system/tools`, `/#/system/connection`. `/#/health` and `/#/usage` redirect here | `/health`, `/system`, `/usage`, `/sessions` |
| Connect | `/#/connect` | Setup and remote tunnel guide | |

## 4. How you report into Mission Control

API base URL: `http://127.0.0.1:3000` unless your operator moved it. All bodies are JSON.

### 4.1 Auth

Every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) uses one check. When `INGEST_TOKEN` is set, send header `x-ingest-token: <INGEST_TOKEN>`. That includes `POST /events` and the REST writes (tickets, projects, runs, models, mission, approvals, custom tools). `GET` and the other reads do not require the header.

A missing or wrong token is HTTP 401 and this JSON body:

```json
{"statusCode":401,"message":"unauthorized"}
```

A checked call without the header, and a checked call with a wrong token, both returned that body. A call with the matching token was not 401.

When `INGEST_TOKEN` is unset and the API is bound to a loopback address (`127.0.0.1`, `localhost`, or `::1`), writes are allowed and the process logs one warning that writes are unauthenticated, for any `NODE_ENV` other than `production`. The bundled web UI keeps working. With `NODE_ENV=production` and no `INGEST_TOKEN`, the process still starts on loopback, logs one line that shows how to set `INGEST_TOKEN`, and every write returns 401, including `POST /events`.

When `INGEST_TOKEN` is unset and the API binds to any other address, the process refuses to start. The message tells you to set `INGEST_TOKEN`. Example from that message: `INGEST_TOKEN=$(openssl rand -hex 24)`.

Compose sets `HOST=0.0.0.0` inside the api container, so a token is required there. If `INGEST_TOKEN` is blank in `.env`, compose gives the api and the web proxy `dev-ingest-token`. Nginx attaches that value on `/api` writes. The browser bundle does not contain the token.

`npm run dev` does the same through the Vite proxy: the page calls same origin `/api/...`, and Vite adds `x-ingest-token` from the environment. Do not put the token in client code, a `VITE_` variable, or local storage.

OpenClaw stays optional. The bridge still posts `POST /events` with `x-ingest-token`. `npm run seed:demo` writes through Prisma, not HTTP, so it does not send the header.

### 4.2 Events: `POST /events`

Body: `{ "type": "<event type>", "payload": { ... } }`. Reply: `202 {"accepted": true, "type": ..., "ts": ...}`. Unknown type or non object payload: 400.

Accepted types (exactly these):

`run.started`, `run.queued`, `run.running`, `run.progress`, `run.completed`, `run.done`, `run.failed`, `health.tick`, `hello`, `message.sent`, `message.received`, `session.patch`, `command.new`, `approval.new`, `approval.decided`, `agents.snapshot`, `sessions.snapshot`, `calendar.snapshot`, `usage.snapshot`, `approvals.snapshot`, `memory.snapshot`.

Non snapshot types are just stored and broadcast. `run.*` payloads are free form; use `{ "name": "...", "agent": "...", "status": "...", "progress": 0, "summary": "..." }`.

Snapshot types write tables. **Warning:** several replace a whole table, so never post a partial roster.

| Type | Payload | Effect |
| --- | --- | --- |
| `agents.snapshot` | `{ agents: [{ name, role?, color?, status?: "working" or "idle", parent?: name, emoji?, personalityTags?, currentTask?, tasksCompleted?, totalCost?, recentActivity?, channel? }] }` | Replaces every Agent row |
| `sessions.snapshot` | `{ sessions: [{ name, agent, model?, ctx?: 0 to 100, lastActivity?, hot? }] }` | Replaces every Session row |
| `calendar.snapshot` | `{ jobs: [{ name, schedule?, day?: 0 Mon to 6 Sun or null, time?: "HH:MM" or null, color?, enabled? }] }` | Replaces every CronJob row |
| `usage.snapshot` | `{ period: "24h" or "7d" or "30d" or "month", totalCost?, tokensIn?, tokensOut?, providers?: [{ name?, model?, cost?, tokensIn?, tokensOut? }] }` | Upserts the row for that period |
| `approvals.snapshot` | `{ approvals: [{ kind, tag, desc, status?, meta? }] }` | Deletes pending approvals, keeps decided ones, inserts these. `kind` is exec, pair, msg, sess or pr. A `pr` approval needs `meta: { repo, number, branch? }` to merge on approve |
| `memory.snapshot` | `{ entries: [{ id, title, body, agent, createdAt, kind: "long-term" or "daily" or "other", source?, ref? }] }` | Upserts by `id`; removes bridge sourced rows for the agents present that are not in the payload. An empty storable list is a no op and does not wipe the table |

### 4.3 The bridge (recommended for snapshots)

You do not need to build snapshots by hand. The bridge reads OpenClaw through the `openclaw` CLI and posts them:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
python3 bridge/mc-bridge-sync.py --dry-run --memory-dir bridge/examples/openclaw-memory
```

With no `openclaw` binary, `--dry-run` exits 0, skips sessions, agents, and cron, and posts nothing. The same command with `--memory-dir bridge/examples/openclaw-memory` prints one `memory.snapshot` and still does not post.

It reads `INGEST_TOKEN` from the env or the repo root `.env`, and `MC_API_URL` (default `http://127.0.0.1:3000`). It skips any source it cannot read instead of posting empty, and emits `run.running`, `run.completed`, `run.failed` only when a cron job changes state. When sessions are readable it posts `usage.snapshot` three times: `24h`, `7d`, and `month`. Schedule it every 5 minutes with an OpenClaw cron job or system cron:

```cron
*/5 * * * * /usr/bin/python3 /path/to/mission-control/bridge/mc-bridge-sync.py >> /tmp/mc-bridge.log 2>&1
```

Also merge `bridge/openclaw.starter.json` into `~/.openclaw/openclaw.json` (merge, do not replace): `agents.defaults.subagents.maxChildrenPerAgent` = 3 and `maxConcurrent` = 4.

### 4.4 Tickets: your units of work

| Call | Body | Notes |
| --- | --- | --- |
| `GET /tickets?status=&projectId=` | | Newest 100. `projectId=none` gives unassigned |
| `POST /tickets` | `{ title, status?, priority?, assignee?, tags?: string[], projectId? }` | 201. `title` required. `status` only `backlog` (default) or `todo`. `priority` defaults `med` (high, med, low). Key auto assigned as `MC-150`, `MC-151`... |
| `PATCH /tickets/:id` | `{ status?, assignee?, priority?, projectId? }` | `:id` is the ticket id, not the key. Status must be one of `backlog`, `todo`, `build`, `qa`, `review`, `done` (`inprogress` is a legacy alias of `build`). `projectId: null` unassigns |

Creating emits `run.queued`; each PATCH emits `run.progress`, so ticket moves show up live. Send `x-ingest-token` on both calls when `INGEST_TOKEN` is set (see section 4.1 and the checklist). A checked create with `{"title":"Onboarding check","status":"todo"}` and that header returned 201, and PATCH `{"status":"done"}` with the same header returned 200 with status `done`.

### 4.5 Projects

| Call | Body | Notes |
| --- | --- | --- |
| `GET /projects?archived=` | | Each has `ticketCount` and `doneCount` |
| `GET /projects/:id` | | Project plus its tickets |
| `POST /projects` | `{ name }` | 201; 409 if the name exists (case insensitive), max 80 chars |
| `PATCH /projects/:id` | `{ name?, archived?: boolean }` | Archived projects cannot receive new tickets |

### 4.6 Runs

| Call | Body | Notes |
| --- | --- | --- |
| `GET /runs?status=&ticketId=` | | Newest 50. `ticketId` keeps only runs linked to that ticket |
| `POST /runs` | `{ name, agent?, ticketId? }` | 201 `{ run, ts }` for a queued run. No `error` key. Missing or blank name is 400 `name is required`. A non string name is 400 `name must be a string`. Name is at most 200 characters and agent at most 100. Longer is 400 and the message names the field. Unknown fields are 400 (`unknown field <name>`), including `status`, which create does not accept. Nothing extra is stored. `ticketId`, when set, must be an existing ticket id or the call is 404 `ticketId not found` and nothing is inserted. Null or blank stores no link |
| `PATCH /runs/:id` | `{ status?, progress?, agent?, ticketId? }` | 200 `{ run, ts }` with no `error` key. Unknown run id is 404 `run not found`. Unknown `ticketId` is 404 `ticketId not found` and the row is left unchanged. Unknown fields are 400. A bad `status`, `progress`, or `agent` is 400 and the message names that field. Agent is at most 100 characters. Status `queued`, `running`, `done`, `failed`, `needs_approval`. A body that changes no stored field returns 200 with the unchanged run and writes no activity event. A real change emits `run.started`, `run.completed`, `run.failed` or `run.queued`. `ticketId: null` clears the link |

### 4.7 Models and spend

* `GET /models`, `POST /models` with `{ provider, model, label? }`, `DELETE /models/:id`. This is a list of models to track. **Nothing reads it yet:** the bridge does not call `GET /models`. The API does not call DeepSeek or Z.ai, so those keys do not produce a live balance.
* Spend shown on System comes only from `usage.snapshot`. `GET /usage?period=24h|7d|month` reads it back. `period=30d` is accepted and returns `usage: null` because nothing posts that period. The bridge, when it can read sessions, posts `24h`, `7d`, and `month`. `npm run seed:demo` also writes those three rows, so a seeded System page is not empty on 7d or month. If the bridge cannot read sessions, it posts no usage snapshot, and all three cards stay empty together.
* Per agent cost on profiles comes from `totalCost` in `agents.snapshot`.

### 4.8 Memory

Read only routes: `GET /memory?day=YYYY-MM-DD&kind=&q=&limit=&offset=` and `GET /memory/:id`. Days use America/Chicago. Writes happen only through `memory.snapshot`. Keep OpenClaw's layout so the bridge finds your notes: `MEMORY.md` for long term, `memory/YYYY-MM-DD.md` or `memory/YYYY-MM-DD-<slug>.md` for daily notes.

### 4.9 Other read routes

`GET /health`, `/system`, `/agents`, `/agents/:id` (id or name), `/sessions`, `/calendar`, `/activity?limit=`, `/logs`, `/search?q=`, `/approvals?status=pending|decided|all`, `/mission`, `/devices`, `/docs`, `/custom-tools`. Writes: `PUT /mission` with `{ mission }`, `POST /approvals/:id/decide` with `{ action: "approve" or "reject" }` (only on your operator's say so; a `pr` approve merges on GitHub). Custom tools also have their own create and update routes under `/custom-tools`. Devices have no write route.

These reads returned 200 on a running API: `/health`, `/system`, `/agents`, `/sessions`, `/calendar`, `/logs`, `/search?q=a`, `/approvals?status=pending`, `/mission`, `/devices`, `/docs`, `/projects`, `/tickets`, `/runs`, `/models`, `/memory`, `/custom-tools`.

## 5. Adapting your workflow

* **Every piece of work is a ticket.** Create it in `backlog` or `todo`, attach it to a project with `projectId`, and move it with PATCH as you go: `todo` when ready, `build` when you start, `qa` when it is under test, `review` when it is waiting to ship, `done` when merged. Pipeline shows these as Build, QA, Ship, Deploy. Those names match `apps/web/src/lib/board.ts`. To-Do and Backlog are not pipeline stages.
* **Group work by project.** Create one project per product or repo and reuse it.
* **Make runs visible.** For a longer job, `POST /runs` then `PATCH` with `running`, progress, and `done` or `failed`, or post `run.*` events. Pass `ticketId` when the run belongs to a ticket so Pipeline can show that run's start time.
* **Ask, do not act, on gated work.** Put anything that needs your operator in an approval (via `approvals.snapshot`) and wait for the decision.
* **Write daily memory** to `memory/YYYY-MM-DD.md` so Memory shows your day.
* **Keep the bridge scheduled** so roster, cron, sessions, usage and memory stay current. `agents.snapshot` replaces the whole roster. There is no endpoint that registers one agent.

## 6. Not implemented yet (do not rely on these)

* No write route for agents, sessions, cron jobs, usage or memory except `POST /events` snapshots. There is no per agent register call: registering yourself means appearing in `agents.snapshot`, which replaces the whole roster.
* `/models` is stored but not used by the bridge. Nothing in this repo fetches a live provider balance.
* Approvals from OpenClaw are opt in: set `MC_BRIDGE_APPROVALS_CMD` to a command that prints a JSON array of `{kind, tag, desc, meta?}`. OpenClaw has no stable pending approvals command.
* A run with no `ticketId` is not linked to a ticket. Pipeline then uses the ticket `createdAt` for Started. Seeded demo runs can carry a `ticketId`. `POST /runs` and `PATCH /runs/:id` store one only when you send it. An unknown `ticketId` is 404. The bridge retries that 404 once without `ticketId`, logs a warning, and still records the run. The ticket detail and the open Pipeline row list runs whose `ticketId` matches.
* Devices have no write route; only `seed:demo` fills them.
* Do not publish port 3000 on a non loopback address without `INGEST_TOKEN`. The API refuses that start. With the token set, a write that omits `x-ingest-token` is 401.

## 7. First read checklist

Run these in order and report the results to your operator. The file stops at step 7.

1. **Verify install.**
   ```bash
   curl -s http://127.0.0.1:3000/health
   ```
   Expect JSON with `"status":"ok"`. A checked call returned 200. If it fails, check `docker compose ps` and `docker compose logs api`, or on the non Docker path confirm Postgres is up and `.env` was exported.
2. **Confirm your token.** Read `INGEST_TOKEN` from the repo root `.env`; do not print it. Export it as `MC_TOKEN` for the next steps.
3. **Register yourself.** Preferred: run the bridge once, which posts the full roster from `openclaw agents list --json`.
   ```bash
   python3 bridge/mc-bridge-sync.py --dry-run
   python3 bridge/mc-bridge-sync.py
   curl -s http://127.0.0.1:3000/agents
   ```
   Your name should be in the list. Do not post a hand made `agents.snapshot` with only yourself; it would wipe every other agent. With no `openclaw` binary, `--dry-run` exits 0 and posts nothing, and the seeded roster stays (12 agents after `seed:demo`).
4. **Post a test event.**
   ```bash
   curl -s -X POST http://127.0.0.1:3000/events \
     -H 'content-type: application/json' \
     -H "x-ingest-token: $MC_TOKEN" \
     -d '{"type":"run.completed","payload":{"name":"onboarding check","agent":"YOUR_NAME","summary":"Mission Control connected"}}'
   ```
   Expect `{"accepted":true,...}` and HTTP 202. A 401 means the token does not match the api.
5. **Confirm it shows up.**
   ```bash
   curl -s 'http://127.0.0.1:3000/activity?limit=5'
   ```
   Your event should be first. A checked call returned 200, and the first row was `run.completed` with name `onboarding check`. Ask your operator to open http://localhost:5173/#/office and look for that name in the activity list. The floor seats will not move because of this event.
6. **File a test ticket and move it.** The same header as `POST /events` is required when `INGEST_TOKEN` is set. Without it the create is 401 `unauthorized`.
   ```bash
   curl -sS -X POST http://127.0.0.1:3000/tickets \
     -H 'content-type: application/json' \
     -H "x-ingest-token: $MC_TOKEN" \
     -d '{"title":"Onboarding check","status":"todo","assignee":"YOUR_NAME"}'
   curl -sS -X PATCH http://127.0.0.1:3000/tickets/<id from above> \
     -H 'content-type: application/json' \
     -H "x-ingest-token: $MC_TOKEN" \
     -d '{"status":"done"}'
   ```
   Confirm it lands in Done on http://localhost:5173/#/tasks. A checked create returned 201 and the following PATCH returned status `done`. A create with no `x-ingest-token` returned 401 `{"statusCode":401,"message":"unauthorized"}`.
7. **Schedule the bridge** every 5 minutes, then tell your operator what you set up.
