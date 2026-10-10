# Mission Control

You host this command center yourself. It is the dashboard for an OpenClaw setup: a task board, agents, approvals, projects, an office floor, a pipeline, a calendar of cron jobs, memory, docs, a team page, and system health.

The sidebar order is Tasks, Agents, Approvals, Projects, Office, Pipeline, then Calendar, Memory, Docs, Team, System. Overview is not a route. `/` redirects to `/tasks`.

It also runs with no OpenClaw at all. Seed the demo data and click through the UI.

**OpenClaw agents start here:** [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md). That file is meant to be pasted to an agent. It has the base URL placeholder, the `x-ingest-token` header, and the exact requests this API accepts. Every write route uses that header when `INGEST_TOKEN` is set.

The web app uses hash routes. A page looks like `http://localhost:5173/#/tasks`. A path with no hash, such as `/tasks`, is not a client route.

Verified on a fresh clone with **Node v22.14.0** and **npm 11.17.0** (the `packageManager` field in `package.json`). This repo does not use pnpm. Postgres was **16.15**.

---

## Screenshots

These are the current screens after `npm run seed:demo`. The sidebar has no Overview page, so there is no Overview shot. Sessions and gateway logs stay empty until a real OpenClaw bridge posts them. That empty state is what a fresh clone shows.

| Tasks | Backlog |
| --- | --- |
| ![Tasks board](docs/screenshots/tasks.png) | ![Tasks backlog](docs/screenshots/tasks-backlog.png) |

| Agents | Approvals |
| --- | --- |
| ![Agents](docs/screenshots/agents.png) | ![Approvals](docs/screenshots/approvals.png) |

| Projects | Project detail |
| --- | --- |
| ![Projects](docs/screenshots/projects.png) | ![Project detail](docs/screenshots/project-detail.png) |

| Office | Pipeline |
| --- | --- |
| ![Office](docs/screenshots/office.png) | ![Pipeline](docs/screenshots/pipeline.png) |

| Calendar | Memory |
| --- | --- |
| ![Calendar](docs/screenshots/calendar.png) | ![Memory](docs/screenshots/memory.png) |

| Docs | Team |
| --- | --- |
| ![Docs](docs/screenshots/docs.png) | ![Team](docs/screenshots/team.png) |

| System | Setup |
| --- | --- |
| ![System](docs/screenshots/system.png) | ![Setup](docs/screenshots/connect.png) |

System panels:

| Logs | Sessions |
| --- | --- |
| ![Logs](docs/screenshots/system-logs.png) | ![Sessions](docs/screenshots/system-sessions.png) |

| Settings | Connection |
| --- | --- |
| ![Settings](docs/screenshots/system-settings.png) | ![Connection](docs/screenshots/system-connection.png) |

![Custom tools](docs/screenshots/system-tools.png)

---

## Install and run

Prerequisites that this run used: git, Node.js 22.14.0 (Node 20.17+ or 22.9+ satisfies the npm 11.17.0 engines range), npm 11.17.0, and Postgres 16 listening on `127.0.0.1:5432`.

Create the database the template expects if it is not there yet: database `mission_control`, user `postgres`, password `postgres`. That password is the local default in `.env.example`, not a production secret. Change it before you expose the machine.

`docker` was not installed in the environment where these commands were run, so Docker Compose was not part of the verified path. `docker-compose.yml` is still in the repo for a host that has Docker. The steps below are the ones that were executed on a fresh clone.

```bash
git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control
cd mission-control
npm ci
cp .env.example .env
set -a; . ./.env; set +a
(cd apps/api && npx prisma generate)
(cd apps/api && npx prisma migrate deploy)
npm run seed:demo
npm run dev
```

Then open **http://localhost:5173/#/tasks**.

`npm ci` prints an `allow-scripts` warning for `@prisma/engines`, `prisma`, and `unrs-resolver` on npm 11.17.0. The following `npx prisma generate` still completed, and migrate deployed 7 migrations.

What each step is doing:

| Command | Why |
| --- | --- |
| `cp .env.example .env` | The API does not load `.env` by itself. Compose would, but this path exports the file into the shell. |
| `set -a; . ./.env; set +a` | Puts `DATABASE_URL`, `INGEST_TOKEN`, `PORT`, `HOST`, and the rest into the environment. `turbo.json` only forwards listed variables into `npm run dev`. |
| `npx prisma generate` | Builds the Prisma client. Run it from `apps/api`. |
| `npx prisma migrate deploy` | Applies `apps/api/prisma/migrations`. The API does not migrate on this path. (The API container runs migrate on boot.) |
| `npm run seed:demo` | Idempotent sample agents, cron jobs, tickets, projects, activity, approvals, memories, docs, devices, a mission line, and one custom tool. Safe to repeat. Refuses to run when `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. |
| `npm run dev` | Turbo starts the API (`nest start --watch`) and the web app (`vite`) together. |

Leave `GITHUB_TOKEN` empty unless you want pull request merge from Approvals. `DEEPSEEK_API_KEY` and `ZAI_API_KEY` are in the template and are not read by the API. Do not commit `.env`.

`OPERATOR_NAME` is a display name, not a secret. Blank means the account chip says Operator. For `npm run dev`, also set `VITE_OPERATOR_NAME` to the same value if you want the browser bundle to see it. Vite only exposes `VITE_*` variables.

### Ports

| Service | Where it listened in this run |
| --- | --- |
| Web | `http://127.0.0.1:5173` (Vite `server.host` is `127.0.0.1`, same loopback bind as the API). `http://localhost:5173` also works when localhost resolves to that address. |
| API | `http://127.0.0.1:3000` (`HOST` from `.env.example`). `GET /health` also answered on `http://localhost:3000`. |
| Postgres | `127.0.0.1:5432`, database `mission_control` |

`docker-compose.yml` publishes the same three ports on `127.0.0.1` only (`MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT` override the host side). Inside Compose the API binds `0.0.0.0:3000` and the web image serves on `5173`.

### First run

1. `npm run dev` starts the API and the web app.
2. Open `http://localhost:5173/#/tasks`. `/` redirects to `/tasks`. The sidebar account chip says **Connected** plus the health latency when `GET /health` succeeds and the Socket.IO feed is up. **API only** means health is up and the socket is still reconnecting. **Offline** means the health probe failed.
3. If the first health probe fails, the shell sends the browser to `/#/connect`. Later failures do not keep redirecting.
4. `/#/connect` is an 8 step sheet: prerequisites, clone, root `.env`, start the stack, verify, OpenClaw bridge, SSH tunnel, smoke test. Progress is stored in this browser under `mc-setup-progress-v2`. Steps that say they probe health call `GET /health`. The other steps are marked done by the person at the keyboard. The last step returns to `/`, which lands on Tasks.
5. The setup sheet text still tells you to look for an Overview page and for `/#/health`. Those routes are redirects now: `/#/` goes to Tasks, `/#/health` goes to System. Trust the sidebar chip and `/#/system`.

`npm run seed:demo` is what fills the screenshots. Without it the board is empty, which is a valid first run, not a crash.

---

## Stack

| Piece | Path | What it is |
| --- | --- | --- |
| `web` | `apps/web` | React 19, Vite 8, Tailwind CSS v4, React Router hash routes, Socket.IO client |
| `api` | `apps/api` | NestJS 11, Socket.IO, Prisma 7.9, Postgres 16 |
| `bridge` | `bridge` | Optional Python 3 standard library sync from the OpenClaw CLI |
| workspaces | repo root | npm workspaces and Turbo 2. `packageManager` is `npm@11.17.0` |

Prisma models, 14 counted in `apps/api/prisma/schema.prisma`: `Agent`, `Run`, `Project`, `Ticket`, `Session`, `CronJob`, `UsageSnapshot`, `ActivityEvent`, `Approval`, `MemoryEntry`, `ModelConfig`, `Setting`, `Device`, `CustomTool`.

The API has 21 controllers (`@Controller` in `apps/api/src`). `team.controller.ts` registers two of them, `mission` and `devices`. The others are sessions, runs, activity, logs, calendar, models, approvals, custom tools, projects, search, usage, events, tickets, docs, health, memory, agents, the root app controller, and system.

Schema changes stay human reviewed. The app does not auto migrate on the `npm run dev` path.

### Pages

| Route | Screen |
| --- | --- |
| `/#/tasks` | Task board. Home. |
| `/#/tasks?view=backlog` | Backlog list for the same tickets |
| `/#/agents` | Agent cards |
| `/#/approvals` | Pending and decided approvals |
| `/#/projects` | Project list |
| `/#/projects/<id>` | One project and its tickets |
| `/#/office` | Office floor |
| `/#/pipeline` | The same tickets as Build, QA, Ship, Deploy |
| `/#/calendar` | Cron jobs for the week |
| `/#/memory` | Memory notes |
| `/#/docs` | Markdown library from `DOCS_ROOT` |
| `/#/team` | Mission, people, devices |
| `/#/system` | Health, spend, links to the panels below |
| `/#/system/logs` | Gateway log tail, or an empty state |
| `/#/system/sessions` | Sessions from `sessions.snapshot` |
| `/#/system/settings` | Connection and log out |
| `/#/system/connection` | How this browser reaches the API |
| `/#/system/tools` | Experimental custom tools |
| `/#/connect` | Setup sheet (no sidebar) |

These paths are redirects, not pages: `/tickets` to `/tasks`, `/backlog` to `/tasks?view=backlog`, `/factory` and `/activity` to `/office`, `/health` and `/usage` to `/system`, `/logs` to `/system/logs`, `/sessions` to `/system/sessions`, `/settings` to `/system/settings`. The URL table above lists only routes that render a screen.

---

## How OpenClaw reports in

Full request bodies, field tables, and the heartbeat rules are in [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md). Short version, matching the code:

* Endpoint: `POST /events` on the API (port 3000).
* Header: `x-ingest-token: <INGEST_TOKEN>` where `<INGEST_TOKEN>` equals `INGEST_TOKEN` in the root `.env`. The same header is required on every `POST`, `PUT`, `PATCH`, and `DELETE` when that variable is set, not only on `POST /events`.
* Body: `{ "type": "<one of KNOWN_TYPES>", "payload": { } }`. The list lives in `apps/api/src/ingest/ingest.controller.ts`.
* Success is `202` with `{ "accepted": true, "type", "ts" }`.
* Snapshot types replace or upsert tables: `agents.snapshot`, `sessions.snapshot`, `calendar.snapshot`, `usage.snapshot`, `approvals.snapshot`, and `memory.snapshot`. Handlers are in `apps/api/src/snapshots/snapshots.service.ts`.
* `memory.snapshot` upserts notes by id and drops bridge sourced rows for the agents in the payload when those ids are missing. An empty `entries` list is a no op. It does not wipe Memory. Demo rows stay.
* `agents.snapshot` replaces the whole roster. There is no endpoint that registers one agent.
* `usage.snapshot` is what System spends. The bridge posts `24h`, `7d`, and `month` when it can read OpenClaw sessions (`bridge/mc-bridge-sync.py`). `npm run seed:demo` writes the same three periods. `GET /usage?period=30d` returns `usage: null` because nothing posts `30d`. If the bridge cannot read sessions, it posts no usage snapshot, and the 24h, 7d, and month cards stay empty together.
* `GET /models` is a stored list. The bridge does not read it. The API does not call DeepSeek or Z.ai. The comment that used to say otherwise in `apps/api/src/models/models.controller.ts` was wrong and has been corrected.
* `run.*` events are activity and a socket broadcast. They do not insert tickets or runs, and they do not move office seats. Seats come from role text and status.
* The board is `POST /tickets` and `PATCH /tickets/:id`. A run row is `POST /runs` (201) and `PATCH /runs/:id` (200). Optional `ticketId` on those run calls stores `Run.ticketId` when the ticket exists. An unknown `ticketId` is 404 and does not write the row. Those routes require `x-ingest-token` when `INGEST_TOKEN` is set. A missing run name is 400 and the message names `name`. An unknown run id is 404. Success bodies have no `error` key.
* The office floor has no endpoint. It reads agents, tickets, approvals, and activity.
* The server broadcasts its own `health.tick` on the socket about every 30 seconds. A client can also POST `health.tick`. The System bridge chip follows the newest activity row with source `openclaw`.

Example that returned `202` against the running API (token redacted):

```bash
curl -sS -X POST "http://127.0.0.1:3000/events" \
  -H "content-type: application/json" \
  -H "x-ingest-token: <INGEST_TOKEN>" \
  -d '{"type":"health.tick","payload":{"uptimeSeconds":1,"connectedClients":0}}'
```

Roster example, the object the ingest tests persist (send the whole roster, not one agent, or you wipe the table):

```json
{
  "type": "agents.snapshot",
  "payload": {
    "agents": [
      {
        "name": "Nova",
        "color": "#4DD0E1",
        "role": "development",
        "status": "working",
        "emoji": "🔧",
        "personalityTags": ["builder", "daily"],
        "currentTask": "MC-200 agent data model",
        "tasksCompleted": 42,
        "totalCost": 12.4,
        "recentActivity": "merged PR #11",
        "channel": "#development"
      }
    ]
  }
}
```

Optional bridge, from this repo, with no `openclaw` binary on `PATH`:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
```

That exited 0 and printed that it was skipping sessions, agents, and cron, and posting nothing. A real sync is the same command without `--dry-run`, after `openclaw` is installed and `INGEST_TOKEN` is set. Details: [bridge/README.md](bridge/README.md).

---

## Scripts

There is no separate `typecheck` script. `npm run build` typechecks both apps (`tsc -b` in web, `nest build` in api).

Generate the Prisma client first. npm 11.17.0 does not run the Prisma install scripts, so `npm test` and `npm run build` cannot see `.prisma/client` until you do:

```bash
(cd apps/api && npx prisma generate)
npm test
npm run build
```

On this clone, after that generate, `npm test` passed (API Jest: 29 suites, 208 tests; web: 51 tests) and `npm run build` passed. This pass used Node 22.14.0. Six of the nine tests in `apps/api/src/ingest/ingest.controller.spec.ts` need Postgres. With Postgres stopped, that file is the only API failure: 6 failed, 202 passed, 208 total. The unknown event type check and the production missing token checks (`POST /events` and `POST /tickets` with no token) return before they write. The write route coverage tests do not need Postgres. Web tests do not use Postgres.

`npm run lint` is `oxlint` for the web app (warnings, exit 0) and `eslint --fix` for the API. The API lint exits 1 on the current sources (mostly `prettier/prettier`, plus typescript-eslint `no-unsafe-*` and `require-await`). That failure is in the existing API tree. Do not treat `eslint --fix` as safe to commit: it rewrites a lot of files. `npm run test:e2e` needs Postgres and was not part of this pass.

---

## Troubleshooting

These are the failures hit while bringing up a fresh clone. Commands were run from the repo root unless noted.

**The dev server listens on `127.0.0.1:5173`.** Vite `server.host` is `127.0.0.1`. The tunnel `ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000` forwards to that address. Open `http://127.0.0.1:5173/#/tasks` on the machine that opened the tunnel. The API, with `HOST=127.0.0.1`, listens on `127.0.0.1:3000`. `http://localhost:3000` also reaches it when localhost resolves to IPv4.

**Sidebar says Offline and the browser lands on `/#/connect`.** The first `GET /health` failed. The API is not up, or it is up on a different host than `VITE_API_URL` (default `http://localhost:3000`). Start Postgres, export `.env`, then `npm run dev`. A later health failure does not redirect again.

**A write returns 401 `unauthorized`.** `INGEST_TOKEN` is set (the template ships `change-me`) and the `x-ingest-token` header is missing or different. This is every `POST`, `PUT`, `PATCH`, and `DELETE`, including `POST /events` and `POST /tickets`. The body is `{"statusCode":401,"message":"unauthorized"}`. Send the same value the API process has. A wrong token failed the same way. Reads such as `GET /health` do not check the header.

**`POST /events` returns 400 unknown event type.** `type` is not in `KNOWN_TYPES`. The response body lists the allowed names.

**`POST /events` returns 400 `payload must be a JSON object`.** `payload` was an array or some other non object. Omit it or send `{}`.

**`POST /tickets` returns 400 `title is required`.** The title was missing or blank. Create status must be `backlog` or `todo` if you send one.

**`npm ci` warns that install scripts are not covered by allowScripts.** Seen for `@prisma/engines`, `prisma`, and `unrs-resolver` on npm 11.17.0. Until `(cd apps/api && npx prisma generate)`, `npm test` and `npm run build` fail with `Cannot find module '.prisma/client/default'`. Generate succeeded after the warning. If generate cannot find query engines, allow those scripts (`npm approve-scripts` in the npm 11 docs) and generate again.

**`npm run lint` exits 1.** The web oxlint step finishes. The API eslint step reports existing `prettier/prettier` and typescript-eslint errors and exits 1. That is the current tree, not a missing env var.

**`python3 bridge/mc-bridge-sync.py` says `openclaw` is not on PATH and posts nothing.** Expected on a machine without the OpenClaw CLI. Exit code was 0. Demo data stays. Install the CLI, or POST `/events` yourself using the onboarding file.

**Setup sheet mentions Overview and `/#/health`.** The current home is `/#/tasks`. `/#/health` redirects to `/#/system`. The Connected chip is in the sidebar under the account name.

---

## What works without OpenClaw

`npm run seed:demo` fills the dashboard with no bridge and no OpenClaw CLI.

* Tasks and the backlog view, from seeded tickets.
* Projects, including ticket counts, from seeded projects.
* Pipeline, the same tickets as Build, QA, Ship, Deploy.
* Memory notes, from seeded rows. Docs do not use the bridge. The seed writes sample markdown under `data/docs`.
* Team mission, from `GET /mission`. People come from the seeded roster. Devices come from the seed. There is no device write route.
* Custom tools, one seeded tool on `/#/system/tools`.
* Office, Calendar, Approvals, and System spend for 24h, 7d, and month, from the same seed.

Sessions and gateway logs stay empty until a real bridge posts them.

## Roadmap

What this tree already does:

* ✅ Tasks, Agents, Approvals, Projects, Office, Pipeline
* ✅ Calendar, Memory, Docs, Team (mission, people, devices), System
* ✅ System panels for logs, sessions, settings, connection, and custom tools
* ✅ `POST /events` intake, including `memory.snapshot` and `usage.snapshot` for 24h, 7d, and month
* ✅ Idempotent `seed:demo` so the UI works with no OpenClaw
* ✅ Optional `bridge/` sync from the OpenClaw CLI

Still open:

* Devices have no write route.
* `GET /models` is stored and unused by the bridge.
* `GET /usage?period=30d` stays empty. Nothing posts that period.

## Security notes

Read this before you open a port.

* When `INGEST_TOKEN` is set, every write requires header `x-ingest-token`. That is `POST`, `PUT`, `PATCH`, and `DELETE`: `POST /events`, `POST /tickets`, `PATCH /tickets/:id`, `POST /projects`, `PATCH /projects/:id`, `POST /runs`, `PATCH /runs/:id`, `PUT /mission`, `POST /approvals/:id/decide`, `POST /models`, `DELETE /models/:id`, and the custom tool writes. A missing or wrong token is 401 JSON `{"statusCode":401,"message":"unauthorized"}`. Reads do not check the token.
* With no `INGEST_TOKEN` and `HOST` on loopback (`127.0.0.1` by default for `npm run dev`), writes stay open and the API logs one warning, for any `NODE_ENV` other than `production`. The web UI still works.
* With `NODE_ENV=production` and no `INGEST_TOKEN`, the API still starts on loopback and logs one line that shows how to set `INGEST_TOKEN`. Every write returns 401, including `POST /events`.
* With no `INGEST_TOKEN` and `HOST` on any other address, the API refuses to start. Set `INGEST_TOKEN` to a long random string (`openssl rand -hex 24`) and start again. Compose sets `HOST=0.0.0.0` inside the api container, so it always has a token: your `.env` value, or `dev-ingest-token` when that value is blank.
* The browser never receives the token. Dev Vite and compose nginx add `x-ingest-token` on same origin `/api` writes. Do not put `INGEST_TOKEN` in a `VITE_` variable or in local storage. `npm run seed:demo` writes through Prisma and does not send the header. The bridge still posts `POST /events` with the header.
* Do not publish port 3000 beyond loopback without a token. `npm run dev` binds `127.0.0.1` (`HOST` in the root `.env`). Compose publishes the API on `127.0.0.1` as well.
* There is no agent self registration endpoint. `agents.snapshot` replaces the whole roster. Posting a snapshot that contains only one agent deletes every other agent.

## Layout

```
apps/web/                  React dashboard
apps/api/                  NestJS API, Prisma schema, seed script
bridge/                    Optional OpenClaw sync
docs/OPENCLAW_ONBOARDING.md   Paste this to an OpenClaw agent
docs/screenshots/          Current screen PNGs embedded above
wireframes/                Static wireframe art, not the running UI
LOG.md                     Change log
ONBOARDING.md              Human install steps for an agent to walk through
```

The running UI is `apps/web`. `wireframes/` is the drawing set. `design/` is older reference art and is not the screenshot source.
