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

Docker Compose is the default. One command writes random tokens, starts the stack, runs doctor, and prints the URL. The browser uses one port. OpenClaw is optional. The dashboard runs with no bridge and no OpenClaw CLI.

Prerequisites: git, bash, curl, and Docker with the Docker Compose plugin. Python 3 only if you will run the bridge. When Docker is missing, the installer says so and uses Node.js 22 and Postgres 16.

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

From a checkout you already have, run `bash install.sh` in the repo root. That is the same installer.

Then open the URL it prints. The default is http://localhost:5173/#/tasks

`bash install.sh` creates `.env` only when that file is missing. It writes `INGEST_TOKEN` and `SOCKET_TOKEN` as two different random values. It never writes `change-me`. A second run keeps every value already in `.env`. The script does not print the token values. It prints that they live in `.env`.

The API loads the root `.env` when that file is on disk, and it runs `prisma migrate deploy` before it listens. Compose injects `DATABASE_URL` for the `db` service. nginx proxies `/api` and `/socket.io`, so the page stays on port 5173. Leave `VITE_API_URL` unset.

`docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`. That log line is the process text in `apps/api/src/main.ts`. Compose sets `HOST=0.0.0.0` inside the container.

The installer runs doctor from the repo root. `npm run doctor` is that same check. On the Docker path the installer waits for the API health check on `MC_API_PORT` (default 3000), and doctor checks that host port. Database and migration lines are info, because Compose runs Postgres and applies migrations. A Docker install does not need `npm ci` for those checks. It prints one line per check. It checks the API port and does not check the web port 5173. OpenClaw is optional in that report. A missing command is an info line. A missing sync timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` (default 600) fails the command.

When `openclaw` is on PATH, `bash install.sh` installs the bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The interval is `MC_BRIDGE_INTERVAL_SECONDS` from the shell, then `.env`, then 300. The job sets `MC_BRIDGE_REGISTER` from the shell, then `.env`, then 1. Remove it with `bash install.sh --uninstall-schedule`. That does not stop the stack and does not change other cron lines or other units. If `openclaw` is not on PATH, the installer prints a skip line and still exits 0 for that step. `npm run seed:demo` does not need the schedule.

`npm run seed:demo` fills sample agents, tickets, projects, and usage. It is idempotent and only touches demo rows. It does not need OpenClaw. `npm run seed:clear` deletes only those sample rows. Registered bots and rows you created through the API stay. A fresh setup does not load sample data.

Edit `.env` before you expose the machine. Rules for you:

* **Never invent secrets.** Ask your operator for any real key.
* `INGEST_TOKEN`: `bash install.sh` writes a random value when `.env` is missing. The template value is `change-me` on the advanced path. Replace that placeholder if you copied the template by hand (`openssl rand -hex 24` is fine) and tell your operator. Every write route checks it when it is set, including `POST /events`. The bridge refuses to run if this is blank. The web UI does not receive the value. Vite and nginx attach it.
* `OPERATOR_NAME`: display only. It becomes the default assignee for new tickets and runs.
* `SOCKET_TOKEN`: `bash install.sh` writes a random value when `.env` is missing. If you set one yourself, set it before the first build because it is baked into the web bundle.
* `GITHUB_TOKEN`: optional. Lets approving a `pr` approval merge the PR on GitHub.
* `DEEPSEEK_API_KEY` and `ZAI_API_KEY` are in the template. The API does not read them. Spend on System comes from `usage.snapshot`, not a live provider call.
* Host ports can be moved with `MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT` in the shell or in `.env`. The shell wins. A new `.env` keeps the shell values. An existing `.env` is not rewritten. The browser ignores `MC_API_PORT` unless `VITE_API_URL` is set.

### Advanced: Node and Postgres

CI has no Docker, so the fresh clone job runs this path. It needs Node.js 20.17+ or 22.9+, npm 11.17.0, and Postgres 16 on `127.0.0.1:5432`. Database `mission_control`, user `postgres`, password `postgres`. That password is the local default in `.env.example`, not a production secret.

```bash
git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control
cd mission-control
npm ci
cp .env.example .env
set -a; . ./.env; set +a
(cd apps/api && npx prisma generate)
(cd apps/api && npx prisma migrate deploy)
npm run dev
```

The `set -a` export is still required on this path so Vite and Turbo see `INGEST_TOKEN`. The API also loads the root `.env` itself. `apps/api/.env` wins over the root file when both set a key. A variable that is already set wins over either file.

On npm 11.17.0, `npm ci` skips the Prisma install scripts. Run `(cd apps/api && npx prisma generate)` before `npm test` or `npm run build` if you have not, or those commands fail to find `.prisma/client`. The API also runs `prisma migrate deploy` on boot.

Useful URLs (the web app uses hash routes, so always include `/#/`):

| What | URL |
| --- | --- |
| Web app (redirects to Tasks) | http://localhost:5173/#/ |
| API health, direct | http://localhost:3000/health |
| API health, same origin | http://localhost:5173/api/health |

Vite listens on `127.0.0.1:5173`. `http://127.0.0.1:5173` and `http://localhost:5173` both reach it when localhost resolves to that address. Direct API calls use `http://127.0.0.1:3000` or `http://localhost:3000`. The browser uses the web port.

Other repo commands: `npm run build`, `npm test`, `npm run test:e2e` (needs a migrated Postgres), `npm run lint`.

## 3. What each screen shows

The sidebar order is Tasks, Agents, Approvals, Projects, Office, Pipeline, then Calendar, Memory, Docs, Team, System. Overview is not a route. `/#/` redirects to Tasks.

| Page | Route | What it shows | Fed by |
| --- | --- | --- | --- |
| Tasks | `/#/tasks` | Ticket kanban: To-Do, Build, QA, Review, Done. Backlog is `/#/tasks?view=backlog`. `/#/tickets` redirects to Tasks. `/#/backlog` redirects to the backlog view | `/tickets` |
| Agents | `/#/agents` | Agent roster and profiles. The Now line uses the same live placement as Office | `agents.snapshot`, `/tickets`, `/runs` |
| Approvals | `/#/approvals` | Pending and decided approvals | `approvals.snapshot`, `/approvals` |
| Projects | `/#/projects`, `/#/projects/:id` | Projects with ticket and done counts | `/projects` |
| Office | `/#/office` | Floor seats from live work (Build, QA, Ship, Deploy, Commons). Agents, Team, and Office share one placement. `/#/activity` and `/#/factory` redirect here | `/agents`, `/tickets`, `/runs`, events |
| Pipeline | `/#/pipeline` | Tickets as Build, QA, Ship, Deploy (statuses build, qa, review, done) | `/tickets`, `/approvals`, `/runs` |
| Calendar | `/#/calendar` | Weekly grid of cron jobs | `calendar.snapshot` |
| Memory | `/#/memory` | Memory notes grouped by day (America/Chicago) | `memory.snapshot` |
| Docs | `/#/docs` | Markdown files from `DOCS_ROOT` (default `data/docs`), read only in the browser | files on disk |
| Team | `/#/team` | Mission, people, and devices. Not an org chart. People use the same live placement as Office | `agents.snapshot`, `/mission`, `/devices`, `/tickets`, `/runs` |
| System | `/#/system` | Health, uptime, usage and cost (Today, 7d, month), sessions, activity. Panels: `/#/system/logs`, `/#/system/sessions`, `/#/system/settings`, `/#/system/tools`, `/#/system/connection`. `/#/health` and `/#/usage` redirect here | `/health`, `/system`, `/usage`, `/sessions` |
| Connect | `/#/connect` | Setup and remote tunnel guide | |

Office, Agents, and Team read one derived placement. Precedence, first match wins:

1. Active ticket. The bot is the assignee (id or name) of a ticket in `build`, `qa`, or `review` (`inprogress` counts as build). The room is that stage: Build, QA, or Ship. The subtitle is the ticket title. Several tickets: the newest `createdAt` wins, then the later stage. A ticket in `done` does not seat its bot. The bot returns to Commons.
2. Active run, when no active ticket applies. `status` is `running` or `needs_approval`, the run names this bot, and `ticketId` points at a ticket in `build`, `qa`, `review`, or `done`. The room is that ticket's stage. Deploy seats a bot only when this run points at a ticket in `done` and no higher precedence ticket applies. A run that points at a ticket in `review` seats Ship. The subtitle is the ticket title, or the run name when the title is blank. A queued, done, or failed run does not take a desk. A run with no ticket in a stage does not take a desk.
3. Heartbeat. The room is Commons. The subtitle is `currentTask` when it is non blank, otherwise Working or Idle from `status`.

Role text is not a seat. A stored status does not pick a room. To Do and Backlog are not stages, so those tickets send the bot back to Commons when no active run applies. Pipeline still counts a done ticket in the Deploy column. `run.*` and `agent.status` socket events refetch tickets, runs, and activity. `agents.snapshot` refetches the roster. A register or a delete also refetches activity, so the Office rail updates without waiting for the next poll. The page does not reload.

Activity names the real agent. Ticket events include `agent` (the assignee). Run events include `agent` (the run agent). A row with no agent falls back to the ticket assignee, then the run agent. The word system is not a name.

## 4. How you report into Mission Control

API base URL: `http://127.0.0.1:3000` unless your operator moved it. All bodies are JSON.

### 4.1 Auth

Every mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) uses one check. When `INGEST_TOKEN` is set, send header `x-ingest-token: <INGEST_TOKEN>`. That includes `POST /events` and the REST writes (tickets, projects, runs, models, mission, approvals, custom tools, and `POST /agents/register`, `POST /agents/:id/heartbeat`, `DELETE /agents/:id`). `GET` and the other reads do not require the header.

A missing or wrong token is HTTP 401 and this JSON body:

```json
{"statusCode":401,"message":"unauthorized"}
```

A checked call without the header, and a checked call with a wrong token, both returned that body. A call with the matching token was not 401.

When `INGEST_TOKEN` is unset and the API is bound to a loopback address (`127.0.0.1`, `localhost`, or `::1`), writes are allowed and the process logs one warning that writes are unauthenticated, for any `NODE_ENV` other than `production`. The bundled web UI keeps working. With `NODE_ENV=production` and no `INGEST_TOKEN`, the process still starts on loopback, logs one line that shows how to set `INGEST_TOKEN`, and every write returns 401, including `POST /events`.

When `INGEST_TOKEN` is unset and the API binds to any other address, the process refuses to start. The message tells you to set `INGEST_TOKEN`. Example from that message: `INGEST_TOKEN=$(openssl rand -hex 24)`.

Compose sets `HOST=0.0.0.0` inside the api container, so a token is required there. `bash install.sh` writes a random `INGEST_TOKEN` before Compose starts, so a fresh install does not use the blank token fallback. If `INGEST_TOKEN` is blank in `.env`, compose gives the api and the web proxy `dev-ingest-token`. Nginx attaches that value on `/api` writes. The browser bundle does not contain the token.

`npm run dev` does the same through the Vite proxy: the page calls same origin `/api/...`, and Vite adds `x-ingest-token` from the environment. Do not put the token in client code, a `VITE_` variable, or local storage.

OpenClaw stays optional. The bridge still posts `POST /events` with `x-ingest-token`. `npm run seed:demo` writes through Prisma, not HTTP, so it does not send the header.

### 4.2 Events: `POST /events`

Body: `{ "type": "<event type>", "payload": { ... } }`. Reply: `202 {"accepted": true, "type": ..., "ts": ...}`. Unknown type or non object payload: 400.

Accepted types (exactly these):

`run.started`, `run.queued`, `run.running`, `run.progress`, `run.completed`, `run.done`, `run.failed`, `health.tick`, `hello`, `message.sent`, `message.received`, `session.patch`, `command.new`, `approval.new`, `approval.decided`, `agents.snapshot`, `sessions.snapshot`, `calendar.snapshot`, `usage.snapshot`, `approvals.snapshot`, `memory.snapshot`.

Non snapshot types are just stored and broadcast. `run.*` payloads are free form; use `{ "name": "...", "agent": "...", "status": "...", "progress": 0, "summary": "..." }`.

Snapshot types write tables. **Warning:** sessions and calendar replace a whole table. `agents.snapshot` does not. It leaves default and registered bots in place, and it removes only snapshot rows that the payload omits.

| Type | Payload | Effect |
| --- | --- | --- |
| `agents.snapshot` | `{ agents: [{ id?, name, role?, color?, status?: "working" or "idle", parent?: name, emoji?, personalityTags?, currentTask?, tasksCompleted?, totalCost?, recentActivity?, channel? }] }` | Creates, updates, or removes `snapshot` rows only. Default and registered rows stay. A registered id in the payload changes status fields only. `id`, when sent, is a lowercase slug. Otherwise the slug comes from the name |
| `sessions.snapshot` | `{ sessions: [{ name, agent, model?, ctx?: 0 to 100, lastActivity?, hot? }] }` | Replaces every Session row |
| `calendar.snapshot` | `{ jobs: [{ name, schedule?, day?: 0 Mon to 6 Sun or null, time?: "HH:MM" or null, color?, enabled? }] }` | Replaces every CronJob row |
| `usage.snapshot` | `{ points: [{ at: ISO timestamp, totalCost?, tokensIn?, tokensOut?, providers?: [{ name?, model?, cost?, tokensIn?, tokensOut? }] }] }` | Upserts one America/Chicago day per point. Days not in the payload stay. A period total with no `at` is ignored |
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

It reads `INGEST_TOKEN` from the env or the repo root `.env`, and `MC_API_URL` from the shell, then `.env`, then `http://127.0.0.1` plus the API port (default 3000). It skips any source it cannot read instead of posting empty, and emits `run.running`, `run.completed`, `run.failed` only when a cron job changes state. When sessions are readable it posts one `usage.snapshot` of daily points (up to 30 days on first connect when sessions have timestamps). It does not post separate 7 day or month totals. A successful run writes a unix timestamp to `MC_BRIDGE_STAMP_FILE` (default `bridge/.state/last-sync`). Doctor fails when that timestamp is older than `MC_BRIDGE_STALE_SECONDS` (default 600).

`bash install.sh` installs that schedule when `openclaw` is on PATH. You do not add a cron line by hand. `bash install.sh --uninstall-schedule` removes it. The same script is what the schedule runs:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
```

Also merge `bridge/openclaw.starter.json` into `~/.openclaw/openclaw.json` (merge, do not replace): `agents.defaults.subagents.maxChildrenPerAgent` = 3 and `maxConcurrent` = 4. The installer prints that offer and does not edit the file.

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
| `POST /runs` | `{ name, agent?, ticketId?, status? }` | 201 `{ run, ts }`. No `error` key. Missing or blank name is 400 `name is required`. A non string name is 400 `name must be a string`. Name is at most 200 characters and agent at most 100. Longer is 400 and the message names the field. `status` is optional and defaults to `queued`. Accepted values are `queued`, `running`, `done`, `failed`, `needs_approval`. A bad `status` is 400 `status must be one of queued, running, done, failed, needs_approval`. Omitted `status`, `queued`, and `needs_approval` emit `run.queued`. `running` sets `startedAt` and emits `run.started`. `done` sets `finishedAt` and emits `run.completed`. `failed` sets `finishedAt` and emits `run.failed`. A queued create keeps the previous event shape. The bridge still creates a queued run and then PATCHes it to `running`. Sending `status: "running"` on POST stores the same `startedAt` that PATCH would. Unknown fields are 400 (`unknown field <name>`). Nothing extra is stored. `ticketId`, when set, must be an existing ticket id or the call is 404 `ticketId not found` and nothing is inserted. Null or blank stores no link |
| `PATCH /runs/:id` | `{ status?, progress?, agent?, ticketId? }` | 200 `{ run, ts }` with no `error` key. Unknown run id is 404 `run not found`. Unknown `ticketId` is 404 `ticketId not found` and the row is left unchanged. Unknown fields are 400. A bad `status`, `progress`, or `agent` is 400 and the message names that field. Agent is at most 100 characters. Status `queued`, `running`, `done`, `failed`, `needs_approval`. A body that changes no stored field returns 200 with the unchanged run and writes no activity event. A real change emits `run.started`, `run.completed`, `run.failed` or `run.queued`. `ticketId: null` clears the link |

`$MC_TOKEN` is the ingest token from checklist step 2. When `INGEST_TOKEN` is unset on loopback outside production, omit the `x-ingest-token` line.

```bash
curl -sS -D - -o /tmp/mc-run.json -X POST "http://127.0.0.1:3000/runs" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"name":"Onboarding run","status":"running"}'
```

That returns HTTP 201 and `"status":"running"`.

```bash
curl -sS -D - -o /tmp/mc-run-queued.json -X POST "http://127.0.0.1:3000/runs" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"name":"Queued onboarding run"}'
```

That returns HTTP 201 and `"status":"queued"`. The next call reads the id from that file.

```bash
RUN_ID=$(python3 -c 'import json; print(json.load(open("/tmp/mc-run-queued.json"))["run"]["id"])')
curl -sS -D - -o /tmp/mc-run-patched.json -X PATCH "http://127.0.0.1:3000/runs/$RUN_ID" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"status":"running"}'
```

That returns HTTP 200 and `"status":"running"`.

### 4.7 Models and spend

* `GET /models`, `POST /models` with `{ provider, model, label? }`, `DELETE /models/:id`. This is a list of models to track. **Nothing reads it yet:** the bridge does not call `GET /models`. The API does not call DeepSeek or Z.ai, so those keys do not produce a live balance.
* Spend shown on System comes only from `usage.snapshot` daily points. `GET /usage?period=24h|7d|month` sums them. `period=24h` is Today, the calendar day in America/Chicago, taken from those buckets. There is no hourly storage. The 7 day and month windows use the same calendar. A short range returns `note` (for example `Showing 3 days of data so far`) and does not fill the gap with zero. `period=30d` returns `usage: null`. The bridge posts points, not 7 day or month totals. On first connect it backfills up to 30 days when session timestamps exist. Otherwise it records the days it has synced. The API keeps a point only when its Chicago day is within the last 30 days through today, and it drops a timestamp after now. `npm run seed:demo` writes 30 days and stamps today at seed time, so a fresh System page shows all three windows. The amounts depend on the date. If the bridge cannot read sessions, it posts no usage snapshot.
* Per agent cost on profiles comes from `totalCost` in `agents.snapshot`.

### 4.8 Memory

Read only routes: `GET /memory?day=YYYY-MM-DD&kind=&q=&limit=&offset=` and `GET /memory/:id`. Days use America/Chicago. Writes happen only through `memory.snapshot`. Keep OpenClaw's layout so the bridge finds your notes: `MEMORY.md` for long term, `memory/YYYY-MM-DD.md` or `memory/YYYY-MM-DD-<slug>.md` for daily notes.

### 4.9 Other read routes

`GET /health`, `/system`, `/agents`, `/agents/:id` (id or name), `/sessions`, `/calendar`, `/activity?limit=`, `/logs`, `/search?q=`, `/approvals?status=pending|decided|all`, `/mission`, `/devices`, `/docs`, `/custom-tools`. Writes: `PUT /mission` with `{ mission }`, `POST /approvals/:id/decide` with `{ action: "approve" or "reject" }` (only on your operator's say so; a `pr` approve merges on GitHub). Custom tools also have their own create and update routes under `/custom-tools`. Devices have no write route.

These reads returned 200 on a running API: `/health`, `/system`, `/agents`, `/sessions`, `/calendar`, `/logs`, `/search?q=a`, `/approvals?status=pending`, `/mission`, `/devices`, `/docs`, `/projects`, `/tickets`, `/runs`, `/models`, `/memory`, `/custom-tools`.

### 4.10 Register, heartbeat, and delete

A bot adds or updates itself with `POST /agents/register`. The body is `{ "id", "name", "role?", "model?", "avatar?" }`. `id` is a lowercase slug of 1 to 64 characters using a to z, 0 to 9, and underscores. `name` is required and at most 200 characters. `role`, `model`, and `avatar` are optional and at most 200 characters. Unknown fields are 400 (`unknown field <name>`). A new id returns 201 `{ agent, ts }`. The same id again returns 200 and does not insert a second row. Registering a default or snapshot id keeps that row, sets `source` to `registered`, and keeps `position`, `color`, and `emoji`.

`POST /agents/:id/heartbeat` returns 204 with an empty body and sets `lastSeenAt`. The JSON body is optional. No body and an empty object only set `lastSeenAt`. A body may include `currentTask` and `status`. `currentTask` is a string of at most 200 characters, or JSON null. A non blank string stores that task. JSON null, `""`, and a string that is only spaces clear `currentTask` and set `status` to `idle`, including when the bot was `working`. `status` must be `working` or `idle`. A heartbeat with `status` set to `idle` clears `currentTask`, including when the same body also sends a task. After that clear, the Commons subtitle is Idle. A bad `status` is 400 `status must be one of working, idle`. A non string `status` is 400 `status must be a string`. A `currentTask` that is not a string and not null is 400 `currentTask must be a string`. Unknown fields are 400 (`unknown field <name>`). A bad body is 400 before the id is checked. A missing bot with an unknown field is 400. It returns 404 when that id is not a registered bot (`agent not found` or `agent is not registered`) and the body is empty or valid. A registered bot with no register or heartbeat for 10 minutes reads `online: false` on `GET /agents` and `GET /agents/:id`. The row stays. The call still broadcasts `agents.snapshot`, so an open Agents, Office, or Team page refetches and shows the new `status` and `currentTask` without a reload.

`DELETE /agents/:id` removes a registered bot and returns 204. A default row returns 409 `default agents cannot be deleted`. A snapshot row returns 409 `snapshot agents cannot be deleted`. A missing id returns 404 `agent not found`.

All three are writes. When `INGEST_TOKEN` is set, send `x-ingest-token`. With no token, outside production, on loopback, they stay open. With `NODE_ENV=production` and no token, they return 401 `unauthorized`.

Register, heartbeat, and delete each broadcast `agents.snapshot`. An open Agents, Office, or Team page refetches the roster when that event arrives, so the list updates within 2 seconds without a reload.

`agents.snapshot` creates, updates, or removes only rows whose `source` is `snapshot`. Match is by `id`. An entry with no `id` uses the slug of its name as the id. Default and registered rows stay when the payload omits that id. When the payload includes a default or registered id, only status fields change: `status`, `currentTask`, `recentActivity`, `tasksCompleted`, and `totalCost`. Parent is not one of those fields. A snapshot row may still name `parent`, and that link is resolved by name. `npm run seed:demo` sets Pixel's parent.

OpenClaw stays optional. The bridge still posts `agents.snapshot`. Set `MC_BRIDGE_REGISTER=1` when it should also call `POST /agents/register` for each agent it maps. Leave that unset and the bridge does not register anyone.

`$MC_TOKEN` is the ingest token from checklist step 2. When `INGEST_TOKEN` is unset on loopback outside production, omit the `x-ingest-token` line.

```bash
curl -sS -D - -o /tmp/mc-register.json -X POST "http://127.0.0.1:3000/agents/register" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"id":"forge_helper","name":"Forge Helper","role":"engineer"}'
```

A new id returns HTTP 201 and `"source":"registered"`. Run the same call again with a model:

```bash
curl -sS -D - -o /tmp/mc-register.json -X POST "http://127.0.0.1:3000/agents/register" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"id":"forge_helper","name":"Forge Helper","role":"engineer","model":"local"}'
```

That returns HTTP 200. `GET /agents` lists one `forge_helper`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "x-ingest-token: $MC_TOKEN"
```

That prints `204`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"currentTask":"Shipping the notes","status":"working"}'
```

That prints `204`. `GET /agents/forge_helper` then shows `"status":"working"` and `"currentTask":"Shipping the notes"`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"status":"idle"}'
```

That prints `204`. `GET /agents/forge_helper` then shows `"status":"idle"` and `"currentTask":null`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"currentTask":null}'
```

That prints `204` and clears `currentTask`. `GET /agents/forge_helper` then shows `"status":"idle"` and `"currentTask":null`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"currentTask":""}'
```

That prints `204` and clears `currentTask`. `GET /agents/forge_helper` then shows `"status":"idle"` and `"currentTask":null`. A blank string is not a 400.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE "http://127.0.0.1:3000/agents/forge_helper" \
  -H "x-ingest-token: $MC_TOKEN"
```

That prints `204`.

## 5. Adapting your workflow

* **Every piece of work is a ticket.** Create it in `backlog` or `todo`, attach it to a project with `projectId`, and move it with PATCH as you go: `todo` when ready, `build` when you start, `qa` when it is under test, `review` when it is waiting to ship, `done` when merged. Pipeline shows these as Build, QA, Ship, Deploy. Office seats the assignee in Build, QA, or Ship. A done ticket stays in the Deploy count and does not seat the bot. An active run on that ticket seats Deploy until the run finishes, then the bot returns to Commons. Those names match `apps/web/src/lib/board.ts` and `apps/web/src/lib/live-work.ts`. To-Do and Backlog are not pipeline stages. A bot with no ticket in a stage and no active run sits in Commons.
* **Group work by project.** Create one project per product or repo and reuse it.
* **Make runs visible.** For a longer job, `POST /runs` with an optional `status`, or create the run queued and `PATCH` it to `running`, then send progress and `done` or `failed`. You can also post `run.*` events. Pass `ticketId` when the run belongs to a ticket so Pipeline can show that run's start time. The curls in section 4.6 do both.
* **Ask, do not act, on gated work.** Put anything that needs your operator in an approval (via `approvals.snapshot`) and wait for the decision.
* **Write daily memory** to `memory/YYYY-MM-DD.md` so Memory shows your day.
* **Keep the bridge scheduled** so roster, cron, sessions, usage and memory stay current. `bash install.sh` does that when `openclaw` is on PATH. The default interval is `MC_BRIDGE_INTERVAL_SECONDS` (300). `agents.snapshot` updates snapshot rows only. The installed schedule sets `MC_BRIDGE_REGISTER` (default 1), which also calls `POST /agents/register` (section 4.10).

## 6. Not implemented yet (do not rely on these)

* Sessions, cron jobs, usage, and memory still have no REST write except `POST /events`. Agents do: `POST /agents/register`, `POST /agents/:id/heartbeat`, and `DELETE /agents/:id` (section 4.10). A snapshot cannot delete a registered or default bot.
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
   Your name should be in the list. A hand made `agents.snapshot` that names only you removes other snapshot rows and leaves default and registered bots. To add only yourself, use `POST /agents/register` in section 4.10. With no `openclaw` binary, `--dry-run` exits 0 and posts nothing, and the seeded roster stays (12 agents after `seed:demo`).
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
