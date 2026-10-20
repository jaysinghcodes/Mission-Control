# Mission Control onboarding for OpenClaw agents

This is the short guide. Paste [PASTE_IN.md](PASTE_IN.md) into OpenClaw. The operator only says yes. That file runs the installer, reports the URL, then registers and sends a heartbeat.

The API reference, including the 401 line, is [API.md](API.md). OpenClaw is optional. `npm run seed:demo` runs without it. `npm run doctor` checks the local setup. The README opens with the one line installer. Longer install notes are in [INSTALL.md](INSTALL.md).

Each heading below is an old anchor. The sentence under it points at the same section in the API reference.

## 1. What Mission Control is

Mission Control is the dashboard. The description is in [API.md](API.md#1-what-mission-control-is).

## 2. Install and run

Run `bash install.sh`. Docker is first. If Docker is missing, the installer says so and uses Node.js 20.17 or later and Postgres 16. Docker installs do not need Node on the host. The Compose health wait polls /health with curl. If curl is missing on the host, it runs curl inside the api container with docker compose exec. That wait does not call host Node, npm, or npx. The Compose install then runs doctor inside the api container with docker compose exec, with or without Node on the host. That check does not call host Node, npm, or npx. On Compose it checks MC_API_PORT, MC_WEB_PORT, MC_DB_PORT, and MC_REMOTE_PORT, and it names a missing, stopped, or paused web service the same way as db and api. When docker compose up cannot bind a port, the installer prints that the port is used by another program, names MC_API_PORT, MC_WEB_PORT, MC_DB_PORT, or MC_REMOTE_PORT, and exits 1. It writes a random ingest token, a dashboard password hash, and a session secret to `.env` (mode 600). Long build output goes to `install.log`. The screen shows one progress line and names that file. The run ends with the URL, the password on the first install, and the reset command. A second run does not print or change the password. Pass the URL and the password to the operator privately. Never post the password in a shared channel. Reset with `npm run password:reset`, which writes the session file. There is no HTTP route. Under Compose, `docker compose exec api npm run password:reset` runs inside the api container and does not call Node on the host. If the api container is stopped, run `docker compose start api` first. A host `npm run password:reset` exits nonzero when this checkout has a Compose API container or the mc-auth volume. It resolves ports from the shell, then `.env`, then the defaults, and writes `DATABASE_URL` with that `MC_DB_PORT` on a new file. The web port is `MC_WEB_PORT` (default 5173). The native API listen port is `PORT` (default 3000). `MC_API_PORT` is the Compose host port and is accepted on the native path when `PORT` is unset. When both are set, `PORT` wins. A plain second run leaves `.env` unchanged. A later run updates that URL only when a new `MC_DB_PORT` is passed and the URL is still the stock localhost port. A custom URL is left as is. It installs a removable bridge schedule. Remove that schedule with `bash install.sh --uninstall-schedule`. Report the URL the installer prints. That URL uses `MC_WEB_PORT`. `npm run doctor` reads the bridge sync age. Under Compose the bridge checks the gateway at 127.0.0.1 on the configured port and posts gateway.snapshot with x-ingest-token, and System shows Unknown when that report is missing or older than GATEWAY_STATUS_MAX_AGE_MS (default 600000). A future checkedAt is counted from the time the API stored the report. A native install, or an explicit OPENCLAW_GATEWAY_HOST, probes that host directly on OPENCLAW_GATEWAY_PORT (default 18789). A down or unknown gateway does not stop `npm run seed:demo`. On this Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. Before Compose starts, the installer creates the host docs directory as the user running the script. That user can delete the checkout, including `data/docs`. CI runs `bash install.sh` with Docker Compose on Ubuntu, and on the native path on Ubuntu and macOS. The macOS runner does not use Docker. Details are in [API.md](API.md#2-install-and-run), [INSTALL.md](INSTALL.md), and the README section Install and run. The README also puts that same curl command on the first screen.

### Advanced: Node and Postgres

The native path is in [API.md](API.md#advanced-node-and-postgres), [INSTALL.md](INSTALL.md#advanced-node-and-postgres), and the README section Advanced: Node and Postgres. `bash install.sh` uses it only when Docker is missing.

## 3. What each screen shows

Screen notes are in [API.md](API.md#3-what-each-screen-shows). The first open asks for a timezone, then whether to use the Mission Control crew or keep each agent's own name, then confirms the detected provider. The operator makes those choices. Skip finishes that open. Do not choose them for the operator. Seat rules are in the README section [How crew seats work](../README.md#how-crew-seats-work).

## 4. How you report into Mission Control

Request shapes are in [API.md](API.md#4-how-you-report-into-mission-control).

### 4.1 Auth

A missing or wrong `x-ingest-token` on agent ingest is HTTP 401 with `{"statusCode":401,"message":"unauthorized"}`. The same body is a dashboard call that is not from loopback and has no session cookie. Logout bumps a session version, so a copied cookie is 401 after logout and after a restart. Too many wrong dashboard passwords from one client IP return 429. The owner on the local web port and a tunnel client on port 3011 do not share that count. `npm run login:reset` clears the lock. Under Compose, `docker compose exec api npm run login:reset` runs it in the api container, and the sign in message names that command. Loopback is the socket address only. Ingest is not limited. The 401 line is in [API.md](API.md#41-auth). SSH uses the local web port. Cloudflare Tunnel and Tailscale Serve use `MC_REMOTE_PORT` (default 3011). The laptop steps are in [REMOTE.md](REMOTE.md). Login is required on each of them for a Compose install.

### 4.2 Events: `POST /events`

See [API.md](API.md#42-events-post-events).

### 4.3 The bridge (recommended for snapshots)

The bridge also posts `devices.snapshot` from `openclaw devices list` and `openclaw nodes list`. See [API.md](API.md#43-the-bridge-recommended-for-snapshots).

### 4.4 Tickets: your units of work

POST /tickets and PATCH /tickets/<id> are the ticket calls. There is no ticket delete route. [PASTE_IN.md](PASTE_IN.md) shows them. See [API.md](API.md#44-tickets-your-units-of-work).

### 4.5 Projects

See [API.md](API.md#45-projects).

### 4.6 Runs

POST /runs and PATCH /runs/<id> are the run calls. [PASTE_IN.md](PASTE_IN.md) shows them. See [API.md](API.md#46-runs).

### 4.7 Models and spend

The bridge posts `models.snapshot` from `~/.openclaw/openclaw.json`. System lists the provider and model for each agent. Usage prices session tokens from `config/prices.json`. A reported `costUsd` wins. See [API.md](API.md#47-models-and-spend).

### 4.8 Memory

See [API.md](API.md#48-memory).

### 4.9 Other read routes

See [API.md](API.md#49-other-read-routes).

### 4.10 Register, heartbeat, and delete

`POST /agents/register`, `POST /agents/:id/heartbeat`, and `DELETE /agents/:id` are in [API.md](API.md#410-register-heartbeat-and-delete).

## 5. Adapting your workflow

See [API.md](API.md#5-adapting-your-workflow).

## 6. Not implemented yet (do not rely on these)

See [API.md](API.md#6-not-implemented-yet-do-not-rely-on-these).

## 7. First read checklist

[PASTE_IN.md](PASTE_IN.md) is the checklist an operator pastes. The older steps remain in [API.md](API.md#7-first-read-checklist).
