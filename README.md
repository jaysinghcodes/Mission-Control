# Mission Control

![Office, tasks, providers, sessions, and approvals from a fixture bridge run](docs/screenshots/hero.gif)

You host this command center yourself.

It shows tasks, an office floor, approvals, and spend for the agents on your machine.

OpenClaw is optional, and one command starts the dashboard.

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

Then open the URL the script prints. The default is **http://localhost:5173/#/tasks**. That URL uses `MC_WEB_PORT` (default 5173). A native install listens for the API on `PORT` (default 3000). `MC_API_PORT` is the Compose host port for the API (default 3000) and is also accepted on the native path when `PORT` is unset. When both are set, `PORT` is the native listen port. The container still listens on 3000.

**Pick your setup.** Run OpenClaw and Mission Control together on a VPS, or run Mission Control on a laptop with OpenClaw on a VPS. The install does not connect OpenClaw by itself, and Agents stays empty until the bridge runs or `npm run seed:demo` loads sample data. The numbered steps for both setups and a short FAQ are in [docs/REMOTE.md](docs/REMOTE.md#pick-your-setup).

The clip above is five frames from one local run of the API and the web app. `bridge/mc-bridge-sync.py` read fixture JSON, because this machine has no OpenClaw install. The stills and the captions are in [Screenshots](#screenshots).

## Works with any provider

The dashboard does not pick a vendor. The bridge reports the provider and model OpenClaw is already using, and System prints that id. You do not need an account with any provider to install or to run `npm run seed:demo`.

| Provider id | Name on System | Spend |
| --- | --- | --- |
| `openai` | OpenAI | Tokens times `config/prices.json` |
| `anthropic` | Anthropic | Tokens times `config/prices.json` |
| `google` or `gemini` | Gemini | Tokens times `config/prices.json` |
| `deepseek` | DeepSeek | Tokens times `config/prices.json` |
| `openrouter` | OpenRouter | Tokens times `config/prices.json` |
| `ollama` | Ollama | $0.00. Local. |
| Any other id | The id the bridge sent | `Price not set` until you add a row |

`config/prices.json` lists current DeepSeek (including `deepseek-v4-flash`), OpenAI, Anthropic, Gemini, and OpenRouter defaults, with the date the prices were read in `sourceDate` and a link per provider in `sources`. The bridge names each usage line `provider/model` from the OpenClaw `modelProvider` and `model`. A bare model gets its provider in front, so `deepseek` with `deepseek-v4-flash` is `deepseek/deepseek-v4-flash`. A run through OpenRouter keeps `openrouter` in front, so it is charged the OpenRouter row and not the direct provider rate. A name that already starts with its provider is kept as is. A reported `costUsd` wins, including 0. A provider marked local is $0.00. When some models in the period are priced and others are not, the System header and Usage show the known total and `Price not set for some models`. When no model is priced, they show only `Price not set`. A plain $0.00 means every model is priced or local. `config/prices.local.json` is gitignored and merged on each read, so a price edit does not need a rebuild. The field tables are in [docs/API.md](docs/API.md#47-models-and-spend).

**Security.** Login is required when the caller is not on loopback. Compose always asks, because the API sees the Docker network. The installer ends with the URL and, on the first install, the password. A second run does not print or change that password. `npm run password:reset` writes a new hash to the session file, prints the password once, and revokes every session. Log out, Revoke sessions, a password change, and that reset close the live socket of every signed in browser, and each one shows the sign in form within 2 s. There is no HTTP route for that reset. Under Compose, `bash install.sh` sets `MC_INSTALL_MODE=compose`, and a host `npm run password:reset` runs `docker compose exec api npm run password:reset` inside the api container. SSH uses the owner port (default 5173). Cloudflare Tunnel and Tailscale Serve use tunnel port 3011 (`MC_REMOTE_PORT`). The laptop steps are in [docs/REMOTE.md](docs/REMOTE.md). Agent ingest still uses the `x-ingest-token` header when `INGEST_TOKEN` is set. That split is issue 36. The long note is [docs/SECURITY.md](docs/SECURITY.md).

## Screenshots

1440 by 900, light theme. The GIF at the top is a smaller copy of five of these frames.

This machine has no OpenClaw install. The bridge read JSON fixtures and posted them to the API. Captions name the file. Nothing here is a live gateway.

| Office, one registered bot in QA | Tasks, the same ticket |
| --- | --- |
| ![Example Tester in QA after the fixture bridge run](docs/screenshots/office-bridge-qa.png) | ![Tasks board with the fixture ticket in QA](docs/screenshots/tasks-bridge.png) |

Example Tester, Example Builder, and Example Lead were registered from `bridge/examples/agents.json`. The QA seat is ticket MC-150. It was created with POST /tickets and then moved to QA. Example Builder and Example Lead have no active ticket, so they sit in Commons. The Tasks board is that same ticket.

| Providers from the models fixture | Gateway down, no OpenClaw process |
| --- | --- |
| ![System providers from the models fixture](docs/screenshots/system-providers.png) | ![System with the gateway down](docs/screenshots/system-gateway.png) |

The provider rows are `bridge/examples/models/openclaw.json`. Quill, Sage, Nova, Router, Lens, and Local are names in that file. They are not connected accounts. Ollama is marked local. On the same run the gateway probe to `127.0.0.1:18789` was down, because nothing was listening. The bridge chip stays not connected until a sync timestamp is fresh.

| Approvals from fresh-install | Devices from fresh-install |
| --- | --- |
| ![Pending approval tagged FreshInstall](docs/screenshots/approvals-bridge.png) | ![Team devices Fresh Studio, Fresh Phone, and Fresh Node](docs/screenshots/team-devices.png) |

The pending approval and the three devices are `bridge/examples/fresh-install`. The tag is FreshInstall. Fresh Studio, Fresh Phone, and Fresh Node are fixture names. The dates are the timestamps in that JSON. That directory is the fixture the installer CI posts.

| Sessions from the sessions fixture | Calendar from the cron fixture |
| --- | --- |
| ![Sessions example model-a and model-b](docs/screenshots/sessions-bridge.png) | ![Calendar jobs Morning Brief, Weekly Review, and Inbox Poll](docs/screenshots/calendar-bridge.png) |

Sessions are `bridge/examples/sessions.json`. The model ids are `example/model-a` and `example/model-b`. Calendar jobs are `bridge/examples/cron.json`: Morning Brief, Weekly Review, and Inbox Poll.

### Sample shots

These three are `npm run seed:demo`. They are sample data, not a bridge run. A fresh install does not load them. Each sample bot shows a Sample tag. Once a registered bot exists, sample bots hide until you turn on Show sample bots.

| Sample Office | Sample tasks |
| --- | --- |
| ![Sample Office after seed:demo](docs/screenshots/office-sample.png) | ![Sample tasks after seed:demo](docs/screenshots/tasks-sample.png) |

The sample Office seats the seeded bots by agent id. A done ticket does not hold a seat. The tasks board is those seeded tickets.

![Sample System spend after seed:demo](docs/screenshots/system-sample.png)

Sample System spend is Today, the last 7 days, and the month to date from the seeded usage rows. The dollar amounts depend on the day you run `npm run seed:demo`. This shot was taken on 16 Oct 2026.

![Empty Office after seed:clear](docs/screenshots/office-empty.png)

Empty Office is the floor after `npm run seed:clear` on that database. The command removes only sample rows. No registered bot was left, so the floor is empty. Sessions and gateway logs stay empty until a real OpenClaw bridge posts them.

## Install and run

Docker Compose is the default. One command writes random tokens, starts Postgres, the API, and the web UI, runs doctor, and prints the URL. The browser uses one port. From a checkout you already have, run `bash install.sh` in the repo root. That is the same installer.

Prerequisites: git, bash, curl, and Docker with the Docker Compose plugin. When Docker is missing, the same command says so and uses Node.js 20.17 or later and Postgres 16 instead. Docker installs do not need Node on the host. The Compose health wait polls /health with curl. If curl is missing on the host, it runs curl inside the api container with docker compose exec. That wait does not call host Node, npm, or npx. The Compose install then runs doctor inside the api container with docker compose exec, with or without Node on the host. That check does not call host Node, npm, or npx. When docker compose up cannot bind a port, the installer prints that the port is used by another program, names MC_API_PORT, MC_WEB_PORT, MC_DB_PORT, or MC_REMOTE_PORT, and exits 1. No paid service is required. OpenClaw can run this for you. Paste [docs/PASTE_IN.md](docs/PASTE_IN.md) and say yes. The short guide is [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md).

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

Then open the URL the script prints. The default is **http://localhost:5173/#/tasks** (`MC_WEB_PORT`). Leave `VITE_API_URL` unset. The dev server and nginx proxy `/api` and `/socket.io`, so the browser stays on that web port. A native API listens on `PORT`. Compose publishes `MC_API_PORT` and the container log stays on port 3000.

OpenClaw is optional. The command above does not start the OpenClaw gateway. A fresh setup does not load sample data. On this Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. After `npm ci`, `npm run seed:demo` writes the sample bots, tickets, and usage in the sample shots above, and it does not need OpenClaw. `npm run seed:clear` deletes only those sample rows. `npm run doctor` checks the local setup. On Compose it checks `MC_API_PORT`, `MC_WEB_PORT`, `MC_DB_PORT`, and `MC_REMOTE_PORT`, and it names a missing, stopped, or paused web service the same way as db and api. Each problem prints on its own line. A missing OpenClaw command does not fail that command.

`bash install.sh` copies `.env.example` to `.env` only when `.env` is missing. It writes a random `INGEST_TOKEN`, plus `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`. It never writes `change-me`. Long build output goes to `install.log`. The screen shows one progress line and names that file. The run ends with the URL, the password on the first install, and the reset command. On Compose the summary names the tunnel port. On the native path that line points at docs/REMOTE.md, because nothing listens on the tunnel port. On the native path the installer waits for the web app and prints the URL only after that port answers. If it does not answer in time, the summary says so and names `install-dev.log` instead of printing a URL. A native install prints only ports that answer. A second run does not print or change the password. The file stores only the hash. A second run keeps values already in `.env`. The script does not print the ingest token or the session secret.

Reset a lost or shared password from the checkout:

```bash
npm run password:reset
```

Under Compose, run this on the host. npm runs inside the api container. The host does not need Node.

```bash
docker compose exec api npm run password:reset
```

The command prints the new password once and revokes every session. It prints that password only after the new hash is read back and every session is revoked. `bash install.sh` writes `MC_INSTALL_MODE=compose` or `MC_INSTALL_MODE=native` in `.env`. On compose, a host `npm run password:reset` runs `docker compose exec api npm run password:reset` and does not write a host file. If the api is not running, or Docker cannot run that command, it exits nonzero and tells you to run `docker compose up -d` first. With no `MC_INSTALL_MODE` in `.env`, a host `npm run password:reset` asks Docker for this checkout's Compose containers and its mc-auth volume. If it finds either, or Docker cannot answer, it refuses, writes nothing, and asks you to run `bash install.sh` again. When Docker did not answer, the message also says to start Docker. A machine with no docker command, or with no Compose trace, keeps the native reset. If the new hash cannot be read back, the command exits 3 and says the password may have changed. Run the reset again to set a new one.

When the `openclaw` command is on PATH, the installer adds a bridge schedule and names the scheduler it used. Remove only that schedule with `bash install.sh --uninstall-schedule`. If `openclaw` is not on PATH, the installer prints a skip line and continues.

CI runs `bash install.sh` on the free GitHub hosted runners. Ubuntu runs the Docker Compose install and the native install. macOS runs the native install only, because Docker on that runner is unreliable. Each of those jobs posts `bridge/examples/fresh-install` with `bridge/mc-bridge-sync.py`. The fresh clone job runs the advanced path below on Node.js 20, Node.js 22, and Node.js 24.

The `/#/connect` page shows the installed web port, not a fixed 5173. Compose bakes `MC_WEB_PORT` into the web image, so rebuild with `docker compose up -d --build` after you change it. Host ports are `MC_WEB_PORT`, `PORT` (native API listen), `MC_API_PORT` (Compose host API port, and the native listen port when `PORT` is unset), `MC_DB_PORT`, and `MC_REMOTE_PORT`. The shell wins, then `.env`, then the default. The env file, doctor, and the bridge schedule are written out in [docs/INSTALL.md](docs/INSTALL.md).

### Upgrading

After updating past #132, run `bash install.sh` once so `.env` records `MC_INSTALL_MODE`. Until then, `npm run password:reset` on a Compose install refuses and asks for that run.

### Advanced: Node and Postgres

Use this path when Docker is not installed. The fresh clone CI job runs these commands on Node.js 20, Node.js 22, and Node.js 24. `bash install.sh` follows this path when Docker is missing.

Prerequisites: git, Node.js 20.17 or later, npm 11.17.0, and Postgres 16 listening on `127.0.0.1:5432`. Node 20, 22, 24, and 26 pass, and there is no upper bound. Create database `mission_control`, user `postgres`, password `postgres`, if it is not there yet. That password is the local default in `.env.example`, not a production secret. Change it before you expose the machine.

```bash
git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control
cd mission-control
npm ci
[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a
(cd apps/api && npx prisma generate)
(cd apps/api && npx prisma migrate deploy)
npm run dev
```

Then open **http://localhost:5173/#/tasks**. Leave `VITE_API_URL` unset here too.

`npm ci` on npm 11.17.0 prints an `allow-scripts` warning for Prisma. The following `npx prisma generate` still builds the client. What each line is doing, and the env keys, are in [docs/INSTALL.md](docs/INSTALL.md#advanced-node-and-postgres).

### Ports

| Service | Where it listens |
| --- | --- |
| Web | `http://127.0.0.1:5173`. Owner UI. SSH tunnels use this port. |
| Tunnel | `http://127.0.0.1:3011`. Cloudflare Tunnel and Tailscale Serve. `MC_REMOTE_PORT` defaults to 3011. |
| API | `http://127.0.0.1:3000` for curl and the bridge. The browser calls `/api` on the web port. |
| Postgres | `127.0.0.1:5432`, database `mission_control` |

`docker-compose.yml` publishes those ports on `127.0.0.1` only. The laptop guide is [docs/REMOTE.md](docs/REMOTE.md).

### First run

1. `bash install.sh`, or the advanced commands above, starts Postgres, the API, and the web UI.
2. Open `http://localhost:5173/#/tasks`. `/` redirects to `/tasks`. The sidebar chip says **Connected** when `GET /health` and the socket are up.
3. The first open asks for a timezone, then a naming choice, then confirms the detected provider. Skip finishes that open. Change them later under System, then Settings. Seat rules are in [How crew seats work](#how-crew-seats-work).
4. A fresh setup does not load sample data. Empty states are a valid first run. On the Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. `npm run seed:demo` fills the sample shots. `npm run seed:clear` removes only those rows.
5. If something fails, run `npm run doctor` from the repo root. The failing line ends with a colon, and the next command follows on its own indented line, ready to paste. Notes are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## How crew seats work

Crew mode maps each seat by agent id. The names live in `config/crew.json`. A matching id takes that seat only when the seat is free. A saved seat stays with that agent. Everyone else with no saved choice takes the next free seat in the order they first registered. When a seat opens, the earliest agent with no saved choice takes it. Own name is a saved choice. It stays until a Settings save changes that agent, and that agent is never auto seated. A Settings save changes only the agents it names. Agents it leaves out keep their seat or Own name choice. If a save gives a seat to one agent while another agent holds it, the named agent gets the seat and the holder loses it. The holder then has no saved choice, unless this save sets the holder to Own name. After every save in crew mode, each agent with no saved choice takes a free seat in that same save, matching id first and then join order. That includes a holder the save just unseated, so the map has no gap. If no seat is free, that agent stays unseated until a seat opens. Choosing Keep my own names keeps the stored seats and Own name choices. Choosing the crew again restores them exactly. Agents deleted in the meantime drop out of the map, and agents added in the meantime take free seats in that save. Nothing clears the map on its own. You change it one seat at a time in Settings. A `crewMap` key that is not a roster agent id returns 400 and writes nothing. The message is `unknown agent <id>`. A display name does not pick a seat. A saved naming mode or seat reaches every open tab, in this browser and in others, within 2 s. Each tab reloads the settings row when the API sends `settings.changed`, so Office, Agents, and Team update without a page reload.

## Stack

| Piece | Path | What it is |
| --- | --- | --- |
| `web` | `apps/web` | React 19, Vite 8, Tailwind CSS v4, hash routes, Socket.IO client |
| `api` | `apps/api` | NestJS 11, Socket.IO, Prisma 7.9, Postgres 16 |
| `bridge` | `bridge` | Optional Python 3 standard library sync from the OpenClaw CLI |
| workspaces | repo root | npm workspaces and Turbo 2. `packageManager` is `npm@11.17.0` |

Models, controllers, and the route table are in [docs/STACK.md](docs/STACK.md). This repo does not use pnpm.

### Pages

| Route | Screen |
| --- | --- |
| `/#/tasks` | Task board. Home. |
| `/#/agents` | Agent cards |
| `/#/approvals` | Pending and decided approvals |
| `/#/projects` | Project list |
| `/#/office` | Office floor. Rooms are Build, QA, Ship, Deploy, and Commons |
| `/#/pipeline` | The same tickets as Build, QA, Ship, Deploy |
| `/#/calendar` | Cron jobs for the week |
| `/#/memory` | Memory notes |
| `/#/docs` | Markdown library |
| `/#/team` | Mission, people, devices |
| `/#/usage` | Cost so far |
| `/#/system` | Health, providers, spend |
| `/#/connect` | Setup sheet |

The full route list, including redirects, is in [docs/STACK.md](docs/STACK.md#pages).

## How OpenClaw reports in

Request bodies and field tables are in [docs/API.md](docs/API.md). The short guide is [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md). Bridge flags are in [bridge/README.md](bridge/README.md).

Endpoint: `POST /events` on the API (port 3000). Header: `x-ingest-token`. Success is `202`.

Register and heartbeat use `x-ingest-token`. Delete is a dashboard write: open on loopback, session cookie off loopback. `$MC_TOKEN` is `INGEST_TOKEN` from the root `.env`. A new id returns 201. The same id again returns 200. Registering a default id, such as `forge`, claims that bot in place: same seat, no Sample tag.

```bash
curl -sS -D - -o /tmp/mc-register.json -X POST "http://127.0.0.1:3000/agents/register" \
  -H "content-type: application/json" \
  -H "x-ingest-token: $MC_TOKEN" \
  -d '{"id":"forge_helper","name":"Forge Helper","role":"engineer"}'
```

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:3000/agents/forge_helper/heartbeat" \
  -H "x-ingest-token: $MC_TOKEN"
```

That prints `204`.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE "http://127.0.0.1:3000/agents/forge_helper"
```

`204` is the native loopback result. On Compose the same command returns 401, because the API does not see loopback. Delete the agent from the UI, or send a session cookie. Settings can remove any agent. A snapshot agent comes back only when a later snapshot includes it. If register returns 401, run `npm run doctor` and send the token that check is using. Field tables: [docs/API.md](docs/API.md#410-register-heartbeat-and-delete). The same heading still resolves in [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md#410-register-heartbeat-and-delete).

Once any registered or snapshot bot exists, unclaimed defaults hide on Agents, Office, and Team. Turn on Show sample bots on System to bring them back. Counts follow the visible bots. While sample bots are hidden, the Office Pipeline card and room ticket list skip tickets assigned to a hidden sample bot, and a System model card counts only visible bots. Sample bots that are on screen show the Sample tag. A registered bot with no heartbeat for 10 minutes shows Offline, and the idle robot is dimmed. The row is not deleted.

Optional bridge, with no `openclaw` binary on `PATH`:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
```

That skips the CLI and posts nothing. A real sync is the same command without `--dry-run`. A steady state run starts `openclaw` once, for sessions. Agents, cron, devices, nodes, the models list, and the CLI version are cached and fetched again when `openclaw.json` changes, a value is missing, or once an hour. `--profile` prints the time, CPU, peak memory, and `openclaw` calls. See [A light run](bridge/README.md#a-light-run). The screenshots above used `--from-dir` on the fixtures in `bridge/examples`.

## Scripts

There is no separate `typecheck` script. `npm run build` typechecks both apps (`tsc -b` in web, `nest build` in api).

```bash
(cd apps/api && npx prisma generate)
npm test
npm run build
```

`npm test` writes with `TEST_DATABASE_URL` only. When `TEST_DATABASE_URL` is unset, setup creates a database named `mc_test_<random>` on the same server, migrates it, and drops it when the run ends, including after a failure. If creating a database is not permitted, setup uses a throwaway schema and drops that schema afterward. Before any write, when both URLs are set, setup connects to each one and compares server identity. If `TEST_DATABASE_URL` reaches the same database as `DATABASE_URL`, including another host name, address, or socket, the run prints `Tests will not run against your live database. Set TEST_DATABASE_URL.` and exits before it writes. If `DATABASE_URL` is unset or cannot be reached, that check is skipped. Postgres must be reachable. `npm run lint` checks the web app with oxlint and the API with eslint. `npm run test:e2e` needs a migrated Postgres at `DATABASE_URL`. `npm run doctor` prints one line per check, and one line per problem when a check finds more than one. OpenClaw staying down does not fail it. The order of those lines, and what a failing line means, is in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Troubleshooting

Start with `npm run doctor`. A failing line that names a command ends with a colon, and the command is on the next line, indented two spaces, ready to paste. A missing OpenClaw command does not fail doctor. A sync timestamp older than `MC_BRIDGE_STALE_SECONDS` fails doctor only when a bridge schedule is installed.

The cases hit on a fresh clone, including 401, login lockout, and a bridge with no `openclaw` on PATH, are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## What works without OpenClaw

On the Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. `npm run seed:demo` fills the dashboard with no bridge and no OpenClaw CLI. Nothing seeds that data for you. `npm run seed:clear` removes it again and leaves live rows in place.

Tasks, projects, pipeline, memory, docs, team, custom tools, Office, Calendar, Approvals, and Usage all render from that seed. Sessions and gateway logs stay empty until a real bridge posts them. The list is in [docs/STACK.md](docs/STACK.md#what-works-without-openclaw).

## Roadmap

Shipped: the pages in the table above, `POST /events`, idempotent `seed:demo` and `seed:clear`, and the optional `bridge/` sync.

Still open: `GET /usage?period=30d` is not a window and stays empty. Live provider balances are not in this build.

## Known limitations

Anyone holding the shared ingest token can name any agent as the actor in Activity. Per agent tokens are planned (#104).

## Security notes

Read [docs/SECURITY.md](docs/SECURITY.md) before you open a port. Short version, matching the code:

* Issue 36: agent ingest uses `x-ingest-token` when `INGEST_TOKEN` is set. The dashboard uses a session cookie. Loopback dashboard reads and writes stay open, including `GET /health`.
* Off loopback, including Compose, dashboard reads and writes return 401 until `POST /auth/login`.
* With `NODE_ENV=production` and no `INGEST_TOKEN`, ingest returns 401 even on loopback.
* With no `INGEST_TOKEN` and `HOST` off loopback, the API refuses to start.
* Tunnel port 3011 is never loopback. Login is required there. Steps: [docs/REMOTE.md](docs/REMOTE.md).

## Layout

```
apps/web/                     React dashboard
apps/api/                     NestJS API, Prisma schema, seed script
bridge/                       Optional OpenClaw sync
docs/INSTALL.md               Installer, ports, env, doctor
docs/SECURITY.md              Login, ingest token, tunnel port 3011
docs/TROUBLESHOOTING.md       Fresh clone failures
docs/STACK.md                 Pages, models, scripts
docs/PASTE_IN.md              Paste this into OpenClaw. The operator only says yes
docs/OPENCLAW_ONBOARDING.md   Short guide. Old headings still resolve here
docs/API.md                   API reference, including the 401 line
docs/REMOTE.md                Pick your setup, SSH, Tailscale Serve, and Cloudflare Tunnel
docs/screenshots/             Hero GIF and the stills above
```

## License

Mission Control is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
