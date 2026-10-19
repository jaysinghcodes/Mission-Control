# Mission Control API

This is the API reference. The 401 line is in section 4.1. Paste [PASTE_IN.md](PASTE_IN.md) into OpenClaw when the operator should only say yes. The short guide is [OPENCLAW_ONBOARDING.md](OPENCLAW_ONBOARDING.md).

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
2. **Direct REST calls:** tickets, projects, runs and models have their own routes. These are how you file and move work. Run writes use the same `x-ingest-token` header as `POST /events`. `POST /tickets` and `PATCH /tickets/:id` also accept that token. Project and model writes and every other dashboard write stay open on loopback and need a session cookie off loopback. There is no ticket delete route.

Every event is stored in the `ActivityEvent` table and broadcast live over Socket.IO to open dashboards.

## 2. Install and run

Docker Compose is the default. One command writes random tokens, starts the stack, runs doctor, and prints the URL. The browser uses one port. OpenClaw is optional. The dashboard runs with no bridge and no OpenClaw CLI.

Prerequisites: git, bash, curl, and Docker with the Docker Compose plugin. Python 3 only if you will run the bridge. When Docker is missing, the installer says so and uses Node.js 20.17 or later and Postgres 16. Docker installs do not need Node on the host.

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

From a checkout you already have, run `bash install.sh` in the repo root. That is the same installer.

Then open the URL it prints. The default is http://localhost:5173/#/tasks

`bash install.sh` creates `.env` only when that file is missing. It writes `INGEST_TOKEN` as a random value, plus `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`. It never writes `change-me`. The password is printed once. The file stores only the hash. A second run keeps every value already in `.env` when the hash and the session secret are set. If either is missing, that run fills only the missing one. The script does not print the ingest token or the session secret. `DATABASE_URL` on a new file uses the resolved `MC_DB_PORT`. A plain second run leaves `.env` unchanged. A later run updates that URL only when a new `MC_DB_PORT` is passed and the URL is still `localhost` or `127.0.0.1` on the previous port. A custom URL is left as is. Tokens and secrets are not rotated.

Before Compose starts, `bash install.sh` creates the host docs directory as the user running the installer. The path is `DOCS_ROOT` from the shell, then `.env`, then `data/docs`. That user can delete the checkout, including `data/docs`. `npm run seed:demo` on the host writes sample markdown as that same user. The api container runs as root, so a seed command started inside that container writes root-owned files in `data/docs`.

The API loads the root `.env` when that file is on disk, and it runs `prisma migrate deploy` before it listens. Compose injects `DATABASE_URL` for the `db` service, so the API container does not use the host port. nginx proxies `/api` and `/socket.io`, so the page stays on port 5173. That is the owner port. SSH tunnels use it. Cloudflare Tunnel and Tailscale Serve use port 3011 (`MC_REMOTE_PORT`). Leave `VITE_API_URL` unset. `npm run seed:demo` on the host uses the `DATABASE_URL` in `.env`.

`docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`. That log line is the process text in `apps/api/src/main.ts`. Compose sets `HOST=0.0.0.0` inside the container.

The Compose installer runs doctor inside the api container with `docker compose exec`, whether or not Node is on the host. `npm run doctor` from a checkout still runs `node scripts/doctor.mjs` on the host. The native install path does that too. On the Docker path the installer waits up to 90 seconds for the API health check on `MC_API_PORT` (default 3000). The wait polls /health with curl. If curl is missing on the host, it runs curl inside the api container with `docker compose exec`. It reports healthy as soon as the API answers, and it does not call host Node, npm, or npx. Doctor checks that host port and retries the health probe for up to 60 seconds. If the db and api containers are running and the API is not ready, doctor prints `The API is still starting. Run doctor again in a minute.` If db or api has exited, doctor fails and names `docker compose start` for that service. If that container was removed or never created, it names `docker compose up -d`. If one of them is paused, doctor fails and names `docker compose unpause`. A port conflict is reported when another program holds the API, web, or database port, including when containers are created or exited. The line names `MC_API_PORT`, `MC_WEB_PORT`, or `MC_DB_PORT`. A compose file selects that check even when no container exists, unless the native API is already answering and no Compose container exists. Doctor prints the port line before it names a stopped or missing service. When `docker compose up` fails because a port is already in use, the installer prints `Port 3000 is used by another program. Stop it or set MC_API_PORT in .env.` with the real port and the matching name among MC_API_PORT, MC_WEB_PORT, MC_DB_PORT, and MC_REMOTE_PORT. Docker's own error follows that line, and the installer exits 1. Database and migration lines are info, because Compose runs Postgres and applies migrations. A Docker install does not need `npm ci` for those checks. It prints one line per check. It checks the API, web, and database ports. It does not check the tunnel port 3011. The installer prints the local URL and the tunnel port. OpenClaw is optional in that report. A missing command is an info line. A missing sync timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` (default 600) fails the command. A Compose install runs that doctor check even when Node is not on PATH, and it still exits 0 after the API answers when every required check passes.

When `openclaw` is on PATH, `bash install.sh` installs the bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The installer names the scheduler it used. The interval is `MC_BRIDGE_INTERVAL_SECONDS` from the shell, then `.env`, then 300. The job sets `MC_BRIDGE_REGISTER` from the shell, then `.env`, then 1. Its PATH includes the `openclaw` directory, the `python3` directory, and the PATH from install time. Remove it with `bash install.sh --uninstall-schedule`. That removes the sync timestamp. It does not stop the stack and does not change other cron lines or other units. If `openclaw` is not on PATH, the installer prints a skip line and still exits 0 for that step. `npm run seed:demo` does not need the schedule.

`npm run seed:demo` fills sample agents, tickets, projects, and usage. It is idempotent and only touches demo rows. It does not need OpenClaw. `npm run seed:clear` deletes only those sample rows. Registered bots and rows you created through the API stay. A fresh setup does not load sample data.

Edit `.env` before you expose the machine. Rules for you:

* **Never invent secrets.** Ask your operator for any real key.
* `INGEST_TOKEN`: `bash install.sh` writes a random value when `.env` is missing. The template value is `change-me` on the advanced path. Replace that placeholder if you copied the template by hand (`openssl rand -hex 24` is fine) and tell your operator. Agent ingest checks it when it is set: `POST /events`, register, heartbeat, and run writes. The bridge refuses to run if this is blank. The web bundle does not contain the value. Vite and nginx do not attach it.
* `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`: `bash install.sh` writes both when they are missing. The password is printed once and stored as scrypt. Blank on loopback leaves the dashboard open. Blank when `HOST` is not loopback, including Compose, refuses to start.
* `TRUSTED_PROXY`: optional comma separated proxy addresses. Leave it unset for Compose. The bundled nginx is trusted through `BUNDLED_PROXY`, not through this list. Do not set it to the Docker bridge. It never grants loopback and it never skips login.
* `BUNDLED_PROXY`: hostname or IP of the bundled nginx. Compose sets the web service name. The default is `web`. The API resolves that name on the Compose network and trusts `X-Forwarded-For` and `X-Real-IP` only from that peer. It also trusts `X-MC-Remote` only from that peer. Outside Compose a blank value trusts no extra peer.
* `OPERATOR_NAME`: display only. It becomes the default assignee for new tickets and runs.
* `SOCKET_TOKEN`: retired. Dashboard login replaced the socket token that issue 36 baked into the web bundle. Leave it blank. The installer does not generate it, and the web image does not receive it.
* `GITHUB_TOKEN`: optional. Lets approving a `pr` approval merge the PR on GitHub.
* `OPENCLAW_GATEWAY_HOST` and `OPENCLAW_GATEWAY_PORT` are the gateway address. Outside Compose the defaults are `127.0.0.1` and `18789`, and `GET /system` probes that address. Under Compose, leave the host blank. The bridge checks `127.0.0.1` on the configured port and posts `gateway.snapshot` with `x-ingest-token`. A missing report, or one older than `GATEWAY_STATUS_MAX_AGE_MS` (default `600000`, and blank, `0`, or invalid uses that default), is `unknown`. A future checkedAt is counted from the time the API stored the report. An explicit host probes that address directly. `extra_hosts` still maps `host.docker.internal` for that override. Doctor uses the same rule. `OPENCLAW_LOG_DIR` is the gateway log directory. The default is `/tmp/openclaw`. `GET /logs` returns that directory as `dir`, and the empty state shows it. `GIT_SHA` is the commit shown by `GET /health` when set. A checkout uses git when it is unset. Spend on System comes from `usage.snapshot`.
* Host ports can be moved with `MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT`, and `MC_REMOTE_PORT` in the shell or in `.env`. The shell wins, then `.env`, then the defaults. `MC_REMOTE_PORT` defaults to 3011. A new `.env` keeps the shell values. A plain second run leaves `.env` unchanged. A shell `MC_DB_PORT` that differs from the stored port updates `DATABASE_URL` only when that URL is `localhost` or `127.0.0.1` on the previous port, and it updates the `MC_DB_PORT` line. A custom URL is left as is. The browser ignores `MC_API_PORT` unless `VITE_API_URL` is set. SSH uses `MC_WEB_PORT`. Cloudflare Tunnel and Tailscale Serve use `MC_REMOTE_PORT`.

### Advanced: Node and Postgres

The fresh clone job runs this path on Node.js 20, Node.js 22, and Node.js 24. It needs Node.js 20.17 or later, npm 11.17.0, and Postgres 16 on `127.0.0.1:5432`. Node 20, 22, 24, and 26 pass, and there is no upper bound. Docker installs do not need Node on the host. Database `mission_control`, user `postgres`, password `postgres`. That password is the local default in `.env.example`, not a production secret. A separate Ubuntu job runs `bash install.sh` with Docker Compose. Ubuntu and macOS jobs also run `bash install.sh` on the native path. The macOS job does not use Docker. Those installer jobs post `bridge/examples/fresh-install` and read devices, nodes, approvals, and gateway status back from the API.

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

The `set -a` export is still required on this path so Vite and Turbo see the file. The dev proxy does not attach a token. The API also loads the root `.env` itself. `apps/api/.env` wins over the root file when both set a key. A variable that is already set wins over either file.

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

The sidebar order is Tasks, Agents, Approvals, Projects, Office, Pipeline, then Calendar, Memory, Docs, Team, Usage, System. Overview is not a route. `/#/` redirects to Tasks.

| Page | Route | What it shows | Fed by |
| --- | --- | --- | --- |
| Tasks | `/#/tasks` | Ticket kanban: To-Do, Build, QA, Review, Done. Backlog is `/#/tasks?view=backlog`. `/#/tickets` redirects to Tasks. `/#/backlog` redirects to the backlog view | `/tickets` |
| Agents | `/#/agents` | Agent roster and profiles. The Now line uses the same live placement as Office | `agents.snapshot`, `/tickets`, `/runs` |
| Approvals | `/#/approvals` | Pending and decided approvals. The empty state names `MC_BRIDGE_APPROVALS_CMD` | `approvals.snapshot`, `/approvals` |
| Projects | `/#/projects`, `/#/projects/:id` | Projects with ticket and done counts | `/projects` |
| Office | `/#/office` | Floor seats from live work (Build, QA, Ship, Deploy, Commons). Agents, Team, and Office share one placement. `/#/activity` and `/#/factory` redirect here | `/agents`, `/tickets`, `/runs`, events |
| Pipeline | `/#/pipeline` | Tickets as Build, QA, Ship, Deploy (statuses build, qa, review, done) | `/tickets`, `/approvals`, `/runs` |
| Calendar | `/#/calendar` | Weekly grid of cron jobs | `calendar.snapshot` |
| Memory | `/#/memory` | Memory notes grouped by day in the timezone saved in Settings | `memory.snapshot` |
| Docs | `/#/docs` | Markdown files from `DOCS_ROOT` (default `data/docs`), read only in the browser | files on disk |
| Team | `/#/team` | Mission, people, and devices. Not an org chart. People use the same live placement as Office. Devices and nodes come from the bridge | `agents.snapshot`, `devices.snapshot`, `/mission`, `/devices`, `/tickets`, `/runs` |
| Usage | `/#/usage` | Cost so far, broken down by day, bot, and model | `usage.snapshot`, `GET /usage`, `config/prices.json` |
| System | `/#/system` | Health, uptime, provider and model per agent, versions, a spend summary, sessions, activity. Panels: `/#/system/logs`, `/#/system/sessions`, `/#/system/settings`, `/#/system/tools`, `/#/system/connection` | `/health`, `/system`, `/usage`, `/sessions` |
| Connect | `/#/connect` | Setup sheet. The laptop paths are in [REMOTE.md](REMOTE.md) | |

Office, Agents, and Team read one derived placement. Precedence, first match wins:

1. Active ticket. The assignee equals the agent id. A display name does not seat a bot. The ticket is in `build`, `qa`, or `review` (`inprogress` counts as build). The room is that stage: Build, QA, or Ship. The subtitle is the ticket title. Several tickets: the newest `createdAt` wins, then the later stage. A ticket in `done` does not seat its bot. The bot returns to Commons.
2. Active run, when no active ticket applies. `status` is `running` or `needs_approval`, `agent` equals this bot's id, and `ticketId` points at a ticket in `build`, `qa`, `review`, or `done`. The room is that ticket's stage. Deploy seats a bot only when this run points at a ticket in `done` and no higher precedence ticket applies. A run that points at a ticket in `review` seats Ship. The subtitle is the ticket title, or the run name when the title is blank. A queued, done, or failed run does not take a desk. A run with no ticket in a stage does not take a desk.
3. Heartbeat. The room is Commons. The subtitle is `currentTask` when it is non blank, otherwise Working or Idle from `status`.

Role text is not a seat. A stored status does not pick a room. To Do and Backlog are not stages, so those tickets send the bot back to Commons when no active run applies. Pipeline still counts a done ticket in the Deploy column. `run.*` and `agent.status` socket events refetch tickets, runs, and activity. `agents.snapshot` refetches the roster. A register or a delete also refetches activity, so the Office rail updates without waiting for the next poll. The page does not reload.

Stickers, colors, and status dots match the agent id on every screen. A display name does not, so a registered bot named Forge does not wear the crew Forge sticker or status. Ticket events include `agent`. Run events include `agent`. When that string is an agent id it is kept. When it is a display name it becomes the id only if exactly one agent has that name. Two agents named Forge stay unresolved. A row with no agent falls back to the ticket assignee, then the run agent, and only an id selects a bot. The word system is not a name. A string that is not an agent id draws a generic sticker. `npm run seed:demo` stores those ids on tickets, runs, activity, memory, doc authors, and usage agent lists, so the sample crew still wears its own stickers. The usage `bot` column stays the display name.

The first open has three screens: timezone, bot naming, and the detected provider. Skip finishes that open and it does not show again. Each one can be changed later under System, then Settings. Saving a naming mode updates Office, Agents, and Team from the same settings row. Naming is `GET /settings` and `PUT /settings`. Crew names live in `config/crew.json`. Use the Mission Control crew is the recommended choice. Crew mode maps each seat by agent id. A matching id takes that seat only when the seat is free. A saved seat stays with that agent. Other agents take the next free seat in the order they first registered. When a seat opens, the earliest agent without a seat takes it. Adding an agent does not move a seat that is already saved. The first run naming screen and Settings show the map and can change any seat. The screen applies a seat only when the saved mode is crew and the map names that agent id. A display name does not pick a seat. A role word does not rename anyone. Own names shows the stored name, role, and color, and the desk stays generic. The provider screen lists `GET /models`. With no rows the sentence is exactly `No provider detected yet`.

## 4. How you report into Mission Control

API base URL: `http://127.0.0.1:3000` unless your operator moved it. All bodies are JSON.

### 4.1 Auth

There are two checks. Dashboard login replaced the old rule that every write used `x-ingest-token` (issue 36).

**Dashboard.** Reads and writes, including `GET /sessions`, `GET /health`, tickets, projects, settings, and `DELETE /agents/:id`, require the `mc_session` cookie when the caller is not loopback. Loopback stays open with no cookie. `POST /auth/login`, `POST /auth/logout`, and `GET /auth/session` are always open so a browser can sign in.

Loopback is the real socket address (`127.0.0.1`, `::1`, or `127.0.0.0/8`, including IPv4 mapped IPv6). A missing socket address is not loopback. A forwarded header never makes a request loopback. `X-Forwarded-For: 127.0.0.1` from a peer in `TRUSTED_PROXY` still requires login, and `GET /sessions` without a cookie is 401.

`X-Forwarded-For` and `X-Real-IP` change the login bucket only when the peer is the bundled nginx or is listed in `TRUSTED_PROXY` (comma separated IPs or IPv4 CIDRs). The bundled nginx is `BUNDLED_PROXY`. Compose sets that to the web service name, default `web`, and the API resolves it. It is not a hardcoded bridge address. When that peer is trusted, the client is the rightmost hop that is not itself trusted. `X-Real-IP` is used only when `X-Forwarded-For` is empty. Do not trust the leftmost hop. A client can spoof it. A header sent straight to the API, from a peer that is not trusted, is ignored.

The local nginx listener (host `MC_WEB_PORT`, default 5173) is the owner. SSH tunnels use only that port. nginx sets `X-Real-IP` and `X-Forwarded-For` from the address it accepted, clears `X-MC-Remote` and `CF-Connecting-IP`, and drops the values the client sent. The host browser and an SSH tunnel share that owner bucket. They still sign in.

The tunnel listener (host `MC_REMOTE_PORT`, default 3011, published on `127.0.0.1` only) is for Cloudflare Tunnel and Tailscale Serve. nginx always sets `X-MC-Remote` to `1` and passes `CF-Connecting-IP` and `X-Forwarded-For` from the tunnel. The API trusts `X-MC-Remote` only when the socket peer is the bundled nginx. On that listener nobody is loopback and nobody is the owner. The login bucket is `CF-Connecting-IP` when that value is an IP, otherwise the first `X-Forwarded-For` hop. Tailscale Serve does not send `CF-Connecting-IP`. It sends the client in `X-Forwarded-For`. A request with neither header shares one remote bucket. That bucket is not the owner bucket. A client cannot move onto the owner bucket by sending `X-MC-Remote` to the API port or to the local web port. Laptop steps are in [REMOTE.md](REMOTE.md). Login is required on each path for a Compose install. On a tunnel other than Cloudflare, a new spoofed `CF-Connecting-IP` on each try is a new bucket.

`POST /auth/login` with JSON `{ "password": "..." }` returns 204 and sets an HttpOnly `mc_session` cookie, or 401 `{"statusCode":401,"message":"unauthorized"}`. After 5 wrong passwords from the same client IP inside 60 seconds, the next attempt returns 429 with a `Retry-After` header, even when the password is right. The first wait is 60 seconds. Each later lockout doubles, up to 15 minutes. Those three numbers are `LOGIN_FAIL_LIMIT`, `LOGIN_WINDOW_SECONDS`, and `LOGIN_BACKOFF_MAX_SECONDS`. A blank or invalid value uses the default. Loopback is not limited. The sign in page shows the message from the API. Off Compose that message is `Too many tries. Try again in a minute. npm run login:reset clears the lock.` When `MC_COMPOSE` is `1` the message names `docker compose exec api npm run login:reset`. `npm run login:reset` clears every lock. It only works on the API itself (`POST /auth/login-reset` from `127.0.0.1`). Under Compose run `docker compose exec api npm run login:reset`. A forwarded header cannot clear the lock.

`GET /auth/session` returns 200 `{ "authenticated": true or false, "loginRequired": true or false }`. On loopback, `loginRequired` is false and `authenticated` is true. `POST /auth/logout` returns 204 and clears the cookie. When the caller is loopback or sends a valid cookie, it also bumps the session version. A copied cookie then returns 401, including after a restart. A remote logout without a cookie only clears that cookie. It does not bump the version. Open sockets that are not loopback and still present the old cookie are disconnected.

`POST /auth/password` with JSON `{ "currentPassword": "...", "newPassword": "..." }` returns 204 when the current password matches. The new password is 1 to 1024 characters. The route stores the new hash, bumps the session version, and clears the cookie. Every existing session returns 401. Off loopback this route needs a valid session. Loopback does not. A wrong current password is 401 and does not revoke. A missing password is 400 `{ "statusCode": 400, "message": "password required" }`.

The session version and a changed password hash live in `SESSION_STATE_PATH`. The default is `apps/api/data/session-state.json`. Compose sets `/data/auth/session-state.json` on the `mc-auth` volume so a new container keeps the revocation. When that file has a password hash, it overrides `DASHBOARD_PASSWORD_HASH` on startup. Delete the file before you replace the hash in `.env` by hand. The login counters are in memory. A restart clears the wait and keeps the session version. `npm run login:reset` clears the wait and does not change the session version.

The 429 body is:

```json
{"statusCode":429,"message":"Too many tries. Try again in a minute. npm run login:reset clears the lock."}
```

Under Compose the message is `Too many tries. Try again in a minute. docker compose exec api npm run login:reset clears the lock.`

Agent ingest is unchanged. `x-ingest-token` is not counted by the login limit.

`bash install.sh` stores the password as `DASHBOARD_PASSWORD_HASH` (`scrypt:N:r:p:saltHex:keyHex`) and stores `SESSION_SECRET`. It prints the password once. A second run does not replace an existing hash or secret. With no hash, loopback stays open and the process logs one warning. With no hash, or no session secret, on any other bind, the process refuses to start.

**Compose and Docker.** The api container sets `HOST=0.0.0.0` and `MC_COMPOSE=1`. The browser talks to nginx on the published web port. nginx talks to `api:3000` on the Docker network, so the socket is the web container, not `127.0.0.1`. Login is required for a browser on the host. The local listener sets `X-Real-IP` and `X-Forwarded-For` from the address it accepted and drops any value the client sent. The API trusts that address when the peer is the bundled nginx. `BUNDLED_PROXY` is that hostname (default `web`, the compose service name) and is resolved on the Compose network. `TRUSTED_PROXY` adds other proxies. Leave `TRUSTED_PROXY` unset unless you run one. Do not set it to the Docker bridge. That does not skip login. A browser on the local port is the owner bucket. A tunnel client on port 3011 is another bucket. A call straight to the published API port ignores a spoofed header and uses the socket address. The host socket is the bridge gateway, the same bucket as the host browser. `docker compose exec api npm run login:reset` clears every bucket. The installer probes `GET /health` inside the api container, where `127.0.0.1` is loopback. Agent ingest is not part of the login buckets.

`npm run dev` stays frictionless. `HOST` is `127.0.0.1` and the Vite proxy connects from `127.0.0.1`, so the dashboard does not ask for a password.

**Agent ingest.** When `INGEST_TOKEN` is set, send header `x-ingest-token: <INGEST_TOKEN>` on `POST /events`, `POST /agents/register`, `POST /agents/:id/heartbeat`, `POST /runs`, and `PATCH /runs/:id`. A session cookie does not replace that header.

`POST /tickets` and `PATCH /tickets/:id` accept that same header when the caller is not loopback and has no session. Send `x-actor-id`, or JSON `actor`, with a registered agent id. Activity stores that id. A token PATCH may set `status`, `assignee`, `title`, and `description` only. Loopback and a session cookie still open those two routes without the header.

Which check applies:

| Routes | Auth |
| --- | --- |
| `POST /events`, `POST /agents/register`, `POST /agents/:id/heartbeat`, `POST /runs`, `PATCH /runs/:id` | `x-ingest-token` when `INGEST_TOKEN` is set. A session cookie does not replace it. |
| `POST /tickets`, `PATCH /tickets/:id` | Loopback, a session cookie, or `x-ingest-token`. A token write also names a registered agent. |
| `POST /projects`, `PATCH /projects/:id`, `PUT /mission`, `PUT /settings`, `POST /models`, `DELETE /models/:id`, `POST /approvals/:id/decide`, custom tool writes, `DELETE /agents/:id`, and every other dashboard write | Loopback or a session cookie. A token does not open them. There is no ticket delete route. |
| Dashboard reads, including `GET /sessions`, `GET /health`, `GET /tickets` | Loopback or a session cookie. |
| `POST /auth/login`, `POST /auth/logout`, `POST /auth/login-reset`, `GET /auth/session` | Open, so a browser can sign in. |

A 401 means the token is wrong, or that route is for the dashboard only. A missing or wrong ingest token on an ingest route, a token on a dashboard only write, and a missing session off loopback, are all HTTP 401 and this JSON body:

```json
{"statusCode":401,"message":"unauthorized"}
```

When `INGEST_TOKEN` is unset and the API is bound to a loopback address, ingest is allowed and the process logs one warning, for any `NODE_ENV` other than `production`. With `NODE_ENV=production` and no `INGEST_TOKEN`, the process still starts on loopback and ingest returns 401. Dashboard loopback routes stay open.

When `INGEST_TOKEN` is unset and the API binds to any other address, the process refuses to start. The message tells you to set `INGEST_TOKEN`. Example from that message: `INGEST_TOKEN=$(openssl rand -hex 24)`.

Compose does not invent a token. A blank `INGEST_TOKEN` stays blank. The web bundle contains no ingest token and no socket token. Vite and nginx do not attach `x-ingest-token`. The browser sends the session cookie.

OpenClaw stays optional. The bridge still posts `POST /events` with `x-ingest-token`. `npm run seed:demo` writes through Prisma, not HTTP, so it does not send the header.

### 4.2 Events: `POST /events`

Body: `{ "type": "<event type>", "payload": { ... } }`. Reply: `202 {"accepted": true, "type": ..., "ts": ...}`. Unknown type or non object payload: 400.

Accepted types (exactly these):

`run.started`, `run.queued`, `run.running`, `run.progress`, `run.completed`, `run.done`, `run.failed`, `health.tick`, `hello`, `message.sent`, `message.received`, `session.patch`, `command.new`, `approval.new`, `approval.decided`, `agents.snapshot`, `sessions.snapshot`, `calendar.snapshot`, `usage.snapshot`, `approvals.snapshot`, `memory.snapshot`, `models.snapshot`, `devices.snapshot`, `gateway.snapshot`.

Non snapshot types are just stored and broadcast. `run.*` payloads are free form; use `{ "name": "...", "agent": "...", "status": "...", "progress": 0, "summary": "..." }`.

Snapshot types write tables. **Warning:** sessions and calendar replace a whole table. `agents.snapshot` does not. It leaves default and registered bots in place, and it removes only snapshot rows that the payload omits. A snapshot agent removed with `DELETE /agents/:id` stays gone until a later snapshot includes that id.

| Type | Payload | Effect |
| --- | --- | --- |
| `agents.snapshot` | `{ agents: [{ id?, name, role?, color?, status?: "working" or "idle", parent?: name, emoji?, personalityTags?, currentTask?, tasksCompleted?, totalCost?, recentActivity?, channel? }] }` | Creates, updates, or removes `snapshot` rows only. Default and registered rows stay. A row removed with DELETE stays gone when a later snapshot omits that id, and it is created again when a later snapshot includes it. A registered id in the payload changes status fields only. `id`, when sent, is a lowercase slug. Otherwise the slug comes from the name |
| `sessions.snapshot` | `{ sessions: [{ name, agent, model?, ctx?: 0 to 100, lastActivity?, hot? }] }` | Replaces every Session row |
| `calendar.snapshot` | `{ jobs: [{ name, schedule?, day?: 0 Mon to 6 Sun or null, time?: "HH:MM" or null, color?, enabled? }] }` | Replaces every CronJob row |
| `usage.snapshot` | `{ points: [{ at: ISO timestamp, totalCost?, tokensIn?, tokensOut?, providers?: [{ bot?, provider?, model?, tokensIn?, tokensOut?, costUsd?, local? }] }] }` | Upserts one server timezone day per point. Days not in the payload stay. A period total with no `at` is ignored. `costUsd` is set only when the provider reported it |
| `approvals.snapshot` | `{ approvals: [{ kind, tag, desc, status?, meta? }] }` | Deletes pending approvals, keeps decided ones, inserts these. `kind` is exec, pair, msg, sess or pr. A `pr` approval needs `meta: { repo, number, branch? }` to merge on approve |
| `memory.snapshot` | `{ entries: [{ id, title, body, agent, createdAt, kind: "long-term" or "daily" or "other", source?, ref? }] }` | Upserts by `id`; removes bridge sourced rows for the agents present that are not in the payload. An empty storable list is a no op and does not wipe the table |
| `models.snapshot` | `{ agents: [{ id?, name?, provider, model }], models?: [{ provider, model }], openclawVersion? }` | Replaces every model row. Stores `openclawVersion` on the settings row when that string is non empty. A payload with neither array is ignored |
| `devices.snapshot` | `{ devices?: [{ id, name, type, online, lastSeenAt?, pairedAt?, requestedAt? }], nodes?: [{ id, name, type, online, lastSeenAt?, pairedAt?, requestedAt? }] }` | Replaces bridge rows for each array that is present and removes sample devices. A node with the same id replaces that device row. Neither array present is ignored. An empty array clears that kind only. `online` is true only for a live connection. `lastSeenAt` is a real last seen time and is empty while online. `pairedAt` is the pairing time. `requestedAt` is a pending request. A paired machine with no connection and no last seen time is not online |
| `gateway.snapshot` | `{ up: true or false, checkedAt: unix ms, host?, port?, latencyMs?, version? }` | Stored as the latest gateway check. `up` must be a boolean and `checkedAt` must be a number, or the API returns 400 and stores nothing. Under Compose, `GET /system` reads the newest row. A missing row, or `checkedAt` older than `GATEWAY_STATUS_MAX_AGE_MS`, is `unknown`. A future checkedAt is counted from the time the API stored the report |

### 4.3 The bridge (recommended for snapshots)

You do not need to build snapshots by hand. The bridge reads OpenClaw through the `openclaw` CLI and posts them:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
python3 bridge/mc-bridge-sync.py --dry-run --memory-dir bridge/examples/openclaw-memory
```

With no `openclaw` binary, `--dry-run` exits 0, skips sessions, agents, cron, devices, and nodes, and prints one `gateway.snapshot`. It still does not post. The same command with `--memory-dir bridge/examples/openclaw-memory` prints one `memory.snapshot` plus the gateway check and still does not post.

It reads `INGEST_TOKEN` from the env or the repo root `.env`, and `MC_API_URL` from the shell, then `.env`, then `http://127.0.0.1` plus the API port (default 3000). It skips any source it cannot read instead of posting empty, and emits `run.running`, `run.completed`, `run.failed` only when a cron job changes state. When sessions are readable it posts one `usage.snapshot` of daily points (up to 30 days on first connect when sessions have timestamps). It does not post separate 7 day or month totals. It posts `models.snapshot` from `~/.openclaw/openclaw.json` (or `OPENCLAW_CONFIG_PATH`). When that file has no agent model, it runs `openclaw models list`. A missing file and a missing CLI skip that event. It posts `devices.snapshot` from `openclaw devices list` and `openclaw nodes list`. A source that cannot be read is omitted. An empty reading still posts that array. When paired nodes omit `connected`, the bridge also reads `openclaw nodes status`. A paired device is online only when that source says it is connected, or it keeps a real last seen time. `approvedAtMs` is `pairedAt`, not `lastSeenAt`. A pending request is `requestedAt`. Every run also probes the gateway at `127.0.0.1` on `OPENCLAW_GATEWAY_PORT` (default 18789) and posts `gateway.snapshot` with `up`, `checkedAt`, and `version` when the CLI prints one. A refused connection is `up: false`. That post uses `x-ingest-token`. A gateway only run does not write the sync stamp. A successful OpenClaw run writes a unix timestamp to `MC_BRIDGE_STAMP_FILE` (default `bridge/.state/last-sync`). Doctor fails when that timestamp is older than `MC_BRIDGE_STALE_SECONDS` (default 600). Gateway down or unknown does not fail doctor.

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
| `POST /tickets` | `{ title, status?, priority?, assignee?, tags?: string[], projectId?, description?, actor? }` | 201. `title` required. `status` only `backlog` (default) or `todo`. `priority` defaults `med` (high, med, low). `description` defaults empty. Key auto assigned as `MC-150`, `MC-151`... |
| `PATCH /tickets/:id` | `{ status?, assignee?, title?, description?, priority?, projectId? }` | `:id` is the ticket id, not the key. Status must be one of `backlog`, `todo`, `build`, `qa`, `review`, `done` (`inprogress` is a legacy alias of `build`). `projectId: null` unassigns. A token may send `status`, `assignee`, `title`, and `description` only |

Creating emits `run.queued`; each PATCH emits `run.progress`, so ticket moves show up live. Loopback and a session cookie can call both routes. An ingest token can too, when `x-actor-id` or `actor` is a registered agent id, and Activity stores that id (section 4.1). There is no ticket delete route. A token cannot patch `priority`, `projectId`, or `tags`. A checked create with `{"title":"Onboarding check","status":"todo"}` on loopback returned 201, and PATCH `{"status":"done"}` returned 200 with status `done`.

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

* `GET /models` returns `{ models: [{ id, provider, model, label, agentId, agentName, local, createdAt }] }` from the latest `models.snapshot`. The bridge reads `~/.openclaw/openclaw.json`, or `OPENCLAW_CONFIG_PATH` when that is set. When that file has no agent model, the fallback is `openclaw models list`. `local` is true for Ollama and for any provider the config marks local. `POST /models` with `{ provider, model, label? }` and `DELETE /models/:id` are dashboard writes: open on loopback, session cookie off loopback. They do not call a provider. The next `models.snapshot` replaces the table. System shows one provider and model per agent. With no rows the sentence is exactly `No providers found yet. Run the bridge to detect them.`
* Spend on Usage and the System summary comes from `usage.snapshot` daily points. `GET /usage?period=24h|7d|month` prices them. `period=24h` is Today, the calendar day in the timezone saved in Settings, taken from those buckets. When none is saved, that is `TZ` when that name is in `config/timezones.json`, otherwise the host zone. A legacy name such as `Asia/Calcutta` is stored as its current name. There is no hourly storage. The 7 day and month windows use the same calendar. Compose sets `TZ` from the shell, or UTC when that is unset. A saved timezone wins over `TZ`. A short range returns `note` (for example `Showing 3 days of data so far`) and does not fill the gap with zero. `period=30d` returns `usage: null`. The bridge posts points, not 7 day or month totals. On first connect it backfills up to 30 days when session timestamps exist. Otherwise it records the days it has synced. The API keeps a point only when its calendar day is within the last `USAGE_RETENTION_DAYS` days through today (default 30), and it drops a timestamp after now. Cost is input and output tokens times `config/prices.json` (USD per one million tokens). `config/prices.local.json` is gitignored and merged on top at each read, so an edit changes totals without a rebuild. A provider `costUsd` wins when it is present, including zero. Ollama and any provider marked local cost $0. A model with no price shows its tokens and exactly `Price not set`. The Usage page breaks the window down by day, bot, and model. `npm run seed:demo` writes 30 days and stamps today at seed time, with no OpenClaw. If the bridge cannot read sessions, it posts no usage snapshot. This build does not read a live provider balance.
* Per agent cost on profiles comes from `totalCost` in `agents.snapshot`.

### 4.8 Memory

Read only routes: `GET /memory?day=YYYY-MM-DD&kind=&q=&limit=&offset=` and `GET /memory/:id`. Days use the timezone saved in Settings. When none is saved, that is `TZ` when that name is in `config/timezones.json`, otherwise the host zone. Writes happen only through `memory.snapshot`. Keep OpenClaw's layout so the bridge finds your notes: `MEMORY.md` for long term, `memory/YYYY-MM-DD.md` or `memory/YYYY-MM-DD-<slug>.md` for daily notes. The bridge reads the same timezone from `GET /settings`, then `MC_TIMEZONE`, then `TZ`, then the host zone named by the `/etc/localtime` symlink. Both sides use `config/timezones.json`.

### 4.9 Other read routes

`GET /health`, `/system`, `/agents`, `/agents/:id` (id or name), `/sessions`, `/calendar`, `/activity?limit=`, `/logs`, `/search?q=`, `/approvals?status=pending|decided|all`, `/mission`, `/devices`, `/docs`, `/custom-tools`, `/settings`. `GET /health` includes `version` (the `version` field in `apps/api/package.json`), `gitSha`, and `openclawVersion` (null until `models.snapshot` reports one). `GET /system` includes `gateway` with `host`, `port`, `state` (`up`, `down`, or `unknown`), `up`, `latencyMs`, `checkedAt`, `source` (`probe` or `bridge`), and `version` when present. `up` is true only when `state` is `up`. Under Compose, with `OPENCLAW_GATEWAY_HOST` blank, the value is the latest `gateway.snapshot`. No report, or a report older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000), is `unknown`. A future checkedAt is counted from the time the API stored the report. A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host on `OPENCLAW_GATEWAY_PORT` (default 18789). The System header does not say everything is running while the gateway is down or unknown. Unknown shows the hint `Gateway status comes from the bridge. Run the bridge to check it.` Writes: `PUT /mission` with `{ mission }`, `PUT /settings`, `POST /approvals/:id/decide` with `{ action: "approve" or "reject" }` (only on your operator's say so; a `pr` approve merges on GitHub). Custom tools also have their own create and update routes under `/custom-tools`. Devices have no write route.

`GET /settings` returns `{ namingMode, crewMap, seats, timezone, serverTimeZone, timezoneSaved, setupDone, offlineAfterMs, ts }`. `namingMode` is `crew`, `own`, or null until the first choice is saved. `crewMap` maps an agent id to a seat id. An agent id that equals a seat id takes that seat only when the seat is free. A saved seat stays with that agent. Other agents take the next free seat in the order they first registered. When a seat opens, the earliest agent without a seat takes it. Register, snapshot, and delete write that map in one locked transaction, together with a new roster position, so concurrent registers each get a distinct seat and a distinct position. A display name does not pick a seat. `seats` always lists `config/crew.json` (id, name, role, desk, color). The API image includes that file, plus `config/prices.json` and `config/timezones.json`. A plain `docker run` without a config mount still serves this route. Compose mounts `./config` over `/app/config`, and that mount overrides the baked files. The screen applies a seat only when `namingMode` is `crew` and the map names that agent id. A missing map entry, or a seat id the file does not contain, keeps the stored name, role, and color, and the desk label stays empty. `timezone` is the zone usage and memory use. `serverTimeZone` is `TZ` when that name is in `config/timezones.json`, otherwise the host zone. `timezoneSaved` is false until a zone is stored. `setupDone` is false until the first open is finished or skipped. `offlineAfterMs` is `OFFLINE_AFTER_MS` (default 600000).

`PUT /settings` is a dashboard write, so section 4.1 applies. On loopback it is open. Off loopback it needs the session cookie. Send any mix of `{ namingMode, crewMap, timezone, setupDone }`. An empty object is 400. Unknown fields are 400 (`unknown field <name>`). When a name field is present, `namingMode` is `crew` or `own`. Omit `crewMap`, or send null, and the stored map is empty. `own` also stores an empty map. `crew` stores the map you send. An agent this save removes from the map stays without a seat. A seat that save frees goes to the earliest agent who was already without a seat. Each value must be a seat id from the crew file. The same seat cannot be used twice. At most 200 agents. A bad mode, an unknown seat, a duplicate seat, or a crewMap key that is not an agent id is 400. The unknown agent message is `unknown agent <id>`. That request writes nothing. While crew mode is saved, `POST /agents/register` for a new id, and `agents.snapshot` when it creates an id, give that agent the matching seat when it is free, or the next free seat. An agent missing from the map takes a free seat on the next register or snapshot. A saved seat is not moved. `DELETE /agents/:id` drops that one entry and gives the open seat to the earliest agent who had none. The open Office, Agents, and Team pages read the same settings row, so a saved map shows up without a reload. `timezone` is an IANA name, or null to return to the server timezone. A name the runtime does not know is 400. `setupDone` is true or false. The row is the same settings row as the mission. Saving one field does not clear the others. `npm run seed:demo` does not set `namingMode`, `timezone`, or `setupDone`. If crew mode is already saved, a demo agent created by that command takes a seat under the same rules. `npm run seed:clear` drops those seats. A saved seat stays, and an open seat goes to the earliest agent without one.

These reads returned 200 on a loopback API: `/health`, `/system`, `/agents`, `/sessions`, `/calendar`, `/logs`, `/search?q=a`, `/approvals?status=pending`, `/mission`, `/devices`, `/docs`, `/projects`, `/tickets`, `/runs`, `/models`, `/memory`, `/usage`, `/custom-tools`. Off loopback, including Compose, the same reads return 401 until the session cookie is set.

### 4.10 Register, heartbeat, and delete

A bot adds or updates itself with `POST /agents/register`. The body is `{ "id", "name", "role?", "model?", "avatar?" }`. `id` is a lowercase slug of 1 to 64 characters using a to z, 0 to 9, and underscores. `name` is required and at most 200 characters. The same display name may belong to more than one id, so a bot named Forge can register beside the crew bot whose id is `forge`. Stickers follow the id. `role`, `model`, and `avatar` are optional and at most 200 characters. Unknown fields are 400 (`unknown field <name>`). A new id returns 201 `{ agent, ts }`. The same id again returns 200 and does not insert a second row. When naming mode is crew, a new id takes the matching crew seat when it is free, or the next free seat, and that map entry is saved in the same locked write as the roster position. An id that already has a seat keeps it. An id missing from the map takes a free seat on this register. Concurrent registers get distinct seats and distinct positions. Registering a default or snapshot id keeps that row, sets `source` to `registered`, and keeps `position`, `color`, and `emoji`.

`POST /agents/:id/heartbeat` returns 204 with an empty body and sets `lastSeenAt`. The JSON body is optional. No body and an empty object only set `lastSeenAt`. A body may include `currentTask` and `status`. `currentTask` is a string of at most 200 characters, or JSON null. A non blank string stores that task. JSON null, `""`, and a string that is only spaces clear `currentTask` and set `status` to `idle`, including when the bot was `working`. `status` must be `working` or `idle`. A heartbeat with `status` set to `idle` clears `currentTask`, including when the same body also sends a task. After that clear, the Commons subtitle is Idle. A bad `status` is 400 `status must be one of working, idle`. A non string `status` is 400 `status must be a string`. A `currentTask` that is not a string and not null is 400 `currentTask must be a string`. Unknown fields are 400 (`unknown field <name>`). A bad body is 400 before the id is checked. A missing bot with an unknown field is 400. It returns 404 when that id is not a registered bot (`agent not found` or `agent is not registered`) and the body is empty or valid. A registered bot with no register or heartbeat for 10 minutes reads `online: false` on `GET /agents` and `GET /agents/:id`. The row stays. The call still broadcasts `agents.snapshot`, so an open Agents, Office, or Team page refetches and shows the new `status` and `currentTask` without a reload.

`DELETE /agents/:id` removes any agent and returns 204. That includes a default row and a snapshot row. A missing id returns 404 `agent not found`. When naming mode is crew, that agent's seat entry is dropped. The earliest agent without a seat takes the open seat. Every saved seat stays where it is. A removed snapshot agent stays gone when a later `agents.snapshot` omits that id, and it is created again when a later snapshot includes it. Settings calls this route for every agent.

Register and heartbeat are ingest writes. When `INGEST_TOKEN` is set, send `x-ingest-token`. With no token, outside production, on loopback, they stay open. With `NODE_ENV=production` and no token, they return 401 `unauthorized`. `DELETE /agents/:id` is a dashboard write. It does not use `x-ingest-token`. On loopback it is open. Off loopback, including Compose, send the session cookie from `POST /auth/login`.

Register, heartbeat, and delete each broadcast `agents.snapshot`. An open Agents, Office, or Team page refetches the roster when that event arrives, so the list updates within 2 seconds without a reload.

`agents.snapshot` creates, updates, or removes only rows whose `source` is `snapshot`. Match is by `id`. An entry with no `id` uses the slug of its name as the id. Default and registered rows stay when the payload omits that id. When the payload includes a default or registered id, only status fields change: `status`, `currentTask`, `recentActivity`, `tasksCompleted`, and `totalCost`. Parent is not one of those fields. A snapshot row may still name `parent`, and that link is resolved by name. `npm run seed:demo` sets Pixel's parent. When naming mode is crew, a snapshot id that is created takes the matching crew seat when it is free, or the next free seat. A snapshot id that is removed drops that one seat, and the earliest agent without a seat takes it. An agent missing from the map takes a free seat on this snapshot. A saved seat stays with that agent.

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
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE "http://127.0.0.1:3000/agents/forge_helper"
```

That prints `204`.

## 5. Adapting your workflow

* **Every piece of work is a ticket.** Create it in `backlog` or `todo`, attach it to a project with `projectId`, and move it with PATCH as you go: `todo` when ready, `build` when you start, `qa` when it is under test, `review` when it is waiting to ship, `done` when merged. Pipeline shows these as Build, QA, Ship, Deploy. Office seats the bot whose id equals `assignee` in Build, QA, or Ship. A display name does not seat a bot. A done ticket stays in the Deploy count and does not seat the bot. An active run seats Deploy when `agent` is that bot's id, until the run finishes, then the bot returns to Commons. Those names match `apps/web/src/lib/board.ts` and `apps/web/src/lib/live-work.ts`. To-Do and Backlog are not pipeline stages. A bot with no ticket in a stage and no active run sits in Commons.
* **Group work by project.** Create one project per product or repo and reuse it.
* **Make runs visible.** For a longer job, `POST /runs` with an optional `status`, or create the run queued and `PATCH` it to `running`, then send progress and `done` or `failed`. You can also post `run.*` events. Pass `ticketId` when the run belongs to a ticket so Pipeline can show that run's start time. The curls in section 4.6 do both.
* **Ask, do not act, on gated work.** Put anything that needs your operator in an approval (via `approvals.snapshot`) and wait for the decision.
* **Write daily memory** to `memory/YYYY-MM-DD.md` so Memory shows your day.
* **Keep the bridge scheduled** so roster, cron, sessions, usage, memory, and models stay current. `bash install.sh` does that when `openclaw` is on PATH. The default interval is `MC_BRIDGE_INTERVAL_SECONDS` (300). `agents.snapshot` updates snapshot rows only. The installed schedule sets `MC_BRIDGE_REGISTER` (default 1), which also calls `POST /agents/register` (section 4.10).

## 6. Not implemented yet (do not rely on these)

* Tickets have no delete route. `POST /tickets` creates one and `PATCH /tickets/:id` moves it.
* Sessions, cron jobs, usage, and memory still have no REST write except `POST /events`. Agents do: `POST /agents/register`, `POST /agents/:id/heartbeat`, and `DELETE /agents/:id` (section 4.10). A snapshot cannot delete a registered or default bot.
* Nothing in this repo fetches a provider account balance. Prices live in `config/prices.json`, with `config/prices.local.json` merged on top. `models.snapshot` is the provider and model list, including which providers are local.
* Approvals from OpenClaw are opt in: set `MC_BRIDGE_APPROVALS_CMD` to a command that prints a JSON array of `{kind, tag, desc, meta?}`. OpenClaw has no stable pending approvals command.
* A run with no `ticketId` is not linked to a ticket. Pipeline then uses the ticket `createdAt` for Started. Seeded demo runs can carry a `ticketId`. `POST /runs` and `PATCH /runs/:id` store one only when you send it. An unknown `ticketId` is 404. The bridge retries that 404 once without `ticketId`, logs a warning, and still records the run. The ticket detail and the open Pipeline row list runs whose `ticketId` matches.
* Devices have no dashboard write route. `devices.snapshot` fills them from `openclaw devices list` and `openclaw nodes list`. `npm run seed:demo` still writes three sample devices, and the next snapshot removes those sample rows.
* Do not publish port 3000 on a non loopback address without `INGEST_TOKEN` and a dashboard password. The API refuses that start. With the ingest token set, an ingest call that omits `x-ingest-token` is 401. A dashboard call off loopback without a session cookie is also 401, except `POST /tickets` and `PATCH /tickets/:id` when the ingest token and a registered agent id are sent.

## 7. First read checklist

The operator paste is [PASTE_IN.md](PASTE_IN.md). It runs the installer, reports the URL, then registers and sends a heartbeat. The steps below are the older checklist. They still describe the same API.

1. **Verify install.**
   ```bash
   curl -s http://127.0.0.1:3000/health
   ```
   On the native path this is loopback and a checked call returned 200 with `"status":"ok"`. On Compose the host curl is not loopback, so expect 401 until you have a session cookie. The installer polls that URL with curl, and when the answer is 401, or when curl is missing on the host, it runs curl inside the api container. If it fails, check `docker compose ps` and `docker compose logs api`, or on the non Docker path confirm Postgres is up and `.env` was exported.
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
   Expect `{"accepted":true,...}` and HTTP 202. A 401 on this ingest call means the token does not match the api. A 401 on another route can also mean that route is for the dashboard only.
5. **Confirm it shows up.**
   ```bash
   curl -s 'http://127.0.0.1:3000/activity?limit=5'
   ```
   Your event should be first. A checked call returned 200, and the first row was `run.completed` with name `onboarding check`. Ask your operator to open http://localhost:5173/#/office and look for that name in the activity list. The floor seats will not move because of this event.
6. **File a test ticket and move it.** On loopback the calls below need no token. On Compose, add `x-ingest-token: $MC_TOKEN` and `x-actor-id: YOUR_AGENT_ID` (a registered agent id). A token may set status, assignee, title, and description. Activity stores that agent id. There is no ticket delete route. Every other dashboard write still needs loopback or a session cookie. A 401 means the token is wrong, or that route is for the dashboard only.
   ```bash
   curl -sS -X POST http://127.0.0.1:3000/tickets \
     -H 'content-type: application/json' \
     -d '{"title":"Onboarding check","status":"todo","assignee":"YOUR_AGENT_ID"}'
   curl -sS -X PATCH http://127.0.0.1:3000/tickets/<id from above> \
     -H 'content-type: application/json' \
     -d '{"status":"done"}'
   ```
   Confirm it lands in Done on http://localhost:5173/#/tasks. A checked loopback create returned 201 and the following PATCH returned status `done`. `assignee` is the agent id. A display name does not seat the bot.
7. **Schedule the bridge** every 5 minutes, then tell your operator what you set up.
