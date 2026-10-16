# Install

The README is the short path. This file is the rest of the installer: env keys, ports, the bridge schedule, doctor, and the native commands. The one line command and the advanced command block in the README are the same commands this file describes.

Docker Compose is the default. One command writes random tokens, starts Postgres, the API, and the web UI, runs doctor, and prints the URL. The browser uses one port.

Prerequisites: git, bash, curl, and Docker with the Docker Compose plugin. When Docker is missing, the same command says so and uses Node.js 22 and Postgres 16 instead. OpenClaw can run this for you. Paste [PASTE_IN.md](PASTE_IN.md) and say yes.

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

From a checkout you already have, run `bash install.sh` in the repo root. That is the same installer. It clones into `./mission-control` when you use the one line above.

Then open the URL the script prints. The default is **http://localhost:5173/#/tasks**.

`bash install.sh` copies `.env.example` to `.env` only when `.env` is missing. It writes `INGEST_TOKEN` as a random value, and it writes `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`. It never writes `change-me`. The password is printed once. The file stores only the hash. A second run keeps every value already in `.env`. If the hash or the session secret is missing, that run fills only the missing one and does not change other keys. The script does not print the ingest token or the session secret.

Host ports follow the shell, then `.env`, then the default. `MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT`, and `MC_REMOTE_PORT` from the environment are written into a new `.env`. `MC_REMOTE_PORT` defaults to 3011. A plain second run leaves `.env` unchanged. A shell `MC_DB_PORT` that differs from the stored port updates `DATABASE_URL` only when that URL uses `localhost` or `127.0.0.1` and its port is the previous `MC_DB_PORT`, or 5432 when none was stored. That same run updates the `MC_DB_PORT` line. A custom URL, including another host or a URL with no port, is left as is and the installer says so. Tokens and secrets are not rotated. A shell value still wins for that run.

OpenClaw is optional. The command above does not start the OpenClaw gateway. `npm run seed:demo` writes sample bots, tickets, and usage. `npm run seed:clear` deletes only those sample rows. A fresh setup does not load sample data. `npm run seed:demo` does not need OpenClaw.

## Bridge schedule

When the `openclaw` command is on PATH, `bash install.sh` installs a bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The installer names the scheduler it used. The interval is `MC_BRIDGE_INTERVAL_SECONDS` from the shell, then `.env`, then 300. The job runs `bridge/mc-bridge-sync.py` and sets `MC_BRIDGE_REGISTER` from the shell, then `.env`, then 1. Its PATH includes the `openclaw` directory, the `python3` directory, and the PATH from install time, so a later run can find `openclaw`. Remove only that schedule with `bash install.sh --uninstall-schedule`. That flag also removes the sync timestamp. It does not stop Docker, does not delete `.env`, and does not change other cron lines or other service units. If `openclaw` is not on PATH, the installer prints a skip line and continues. A second run installs the same schedule again without duplicating it.

Doctor reads the sync timestamp at `MC_BRIDGE_STAMP_FILE` (default `bridge/.state/last-sync`). A missing timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` (default 600) is a failing line when a schedule is installed. With no schedule, that age is an info line. A missing `openclaw` command is still an info line and does not by itself fail doctor. Doctor also reports the gateway. Under Compose, with `OPENCLAW_GATEWAY_HOST` unset, that line uses the bridge report and says Unknown when the report is missing or older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000). A native install, or an explicit host, is a direct probe of `127.0.0.1` or that host on `OPENCLAW_GATEWAY_PORT` (default 18789). The line is info. OpenClaw does not have to be running. The installer also offers `bridge/openclaw.starter.json`. Merge that file into `~/.openclaw/openclaw.json` if you want it. The installer does not edit that file.

## What the command starts

The API loads the root `.env` when that file is on disk, and it runs `prisma migrate deploy` before it listens. Compose injects `DATABASE_URL` for the `db` service, so the image does not contain a `.env` file. A variable that is already set wins over the file, including a blank value. The host `DATABASE_URL` is what `npm run seed:demo` uses. On a new `.env` its port is the resolved `MC_DB_PORT`.

nginx on the web port proxies `/api` and `/socket.io` to the API. The page and the live socket stay on port 5173. That port is the owner port. SSH tunnels use it. Cloudflare Tunnel and Tailscale Serve use port 3011 (`MC_REMOTE_PORT`). Leave `VITE_API_URL` unset. Set it only when the browser should call a different API origin, then rebuild the web image. The laptop steps are in [REMOTE.md](REMOTE.md).

`docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`. Data lives in the named volume `mc-db` and stays across `docker compose restart`.

Before Compose starts, `bash install.sh` creates the host docs directory as the user running the installer. The path is `DOCS_ROOT` from the shell, then `.env`, then `data/docs`. That user can delete the checkout, including `data/docs`. `npm run seed:demo` on the host writes sample markdown as that same user. The api container runs as root, so a seed command started inside that container writes root-owned files in `data/docs`. Session files stay in the named volume `mc-auth`.

The API image includes the default config: `config/crew.json`, `config/prices.json`, and `config/timezones.json`. A plain `docker run` of that image serves `GET /settings` without a config mount. Compose mounts `./config` over `/app/config`, and that mount overrides the files in the image.

The script ends by running doctor (`node scripts/doctor.mjs`). On the Docker path it first waits up to 90 seconds for the API health check on `MC_API_PORT` (default 3000). Doctor then checks that host port. The database and migration lines are info, because Compose runs Postgres and the API container applies migrations. A Docker install does not need `npm ci` for those checks. A missing OpenClaw command is an info line. A missing sync timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` fails doctor when a schedule is installed. If doctor prints a failing line, the script still prints the URL and then exits non zero.

Compose does not invent an ingest token or a dashboard password. A blank `INGEST_TOKEN` stays blank. A blank `DASHBOARD_PASSWORD_HASH` makes the API refuse to start, because Compose sets `HOST=0.0.0.0` inside the api container. `bash install.sh` writes both before Compose starts.

CI runs `bash install.sh` on the free GitHub hosted runners. Ubuntu runs the Docker Compose install and the native install. macOS runs the native install only, because Docker on that runner is unreliable. Each of those jobs posts `bridge/examples/fresh-install` with `bridge/mc-bridge-sync.py` and checks devices, nodes, approvals, and gateway status through the API. The fresh clone job still runs the advanced path below on Node.js 20 and Node.js 22. A separate job still checks `bash install.sh` with a docker stub on Ubuntu and macOS. The compose file, the nginx config, and the Dockerfiles are checked as text.

## Advanced: Node and Postgres

Use this path when Docker is not installed. The fresh clone CI job runs these commands on Node.js 20 and Node.js 22. `bash install.sh` follows this path when Docker is missing, which is what the native installer jobs do.

Prerequisites that a local run used: git, Node.js 22 (Node 20.17+ or 22.9+ satisfies the npm 11.17.0 engines range), npm 11.17.0, and Postgres 16 listening on `127.0.0.1:5432`.

Create the database the template expects if it is not there yet: database `mission_control`, user `postgres`, password `postgres`. That password is the local default in `.env.example`, not a production secret. Change it before you expose the machine.

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

Then open **http://localhost:5173/#/tasks**. The dev server proxies `/api` and `/socket.io`, so the browser still uses port 5173. Leave `VITE_API_URL` unset here too.

`npm ci` prints an `allow-scripts` warning for `@prisma/engines`, `prisma`, and `unrs-resolver` on npm 11.17.0. The following `npx prisma generate` still completes. `npx prisma migrate deploy` applies every folder in `apps/api/prisma/migrations`.

| Command | Why |
| --- | --- |
| `cp .env.example .env` | Root env file. The API loads it on boot. Compose reads the same file. |
| `set -a; . ./.env; set +a` | Vite and Turbo only see variables that are already in the environment. The API also loads the file itself. The dev proxy does not attach a token. |
| `npx prisma generate` | Builds the Prisma client. Run it from `apps/api`. npm 11 does not do this during `npm ci`. |
| `npx prisma migrate deploy` | Applies `apps/api/prisma/migrations`. The API also runs this on boot. |
| `npm run dev` | Turbo starts the API (`nest start --watch`) and the web app (`vite`) together. |

Leave `GITHUB_TOKEN` empty unless you want pull request merge from Approvals. Do not commit `.env`. Under Compose the bridge checks the gateway at 127.0.0.1 and posts `gateway.snapshot` with `x-ingest-token`. System shows Unknown when that report is missing or older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000). A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host on `OPENCLAW_GATEWAY_PORT` (default 18789). `extra_hosts` still maps `host.docker.internal` for that override. Gateway logs are read from `OPENCLAW_LOG_DIR` (default `/tmp/openclaw`).

`OPERATOR_NAME` is a display name, not a secret. Blank means the account chip says Operator. For `npm run dev`, also set `VITE_OPERATOR_NAME` to the same value if you want the browser bundle to see it. Vite only exposes `VITE_*` variables.

`TZ` is the server timezone when Settings has not saved one. `OFFLINE_AFTER_MS` is how long a registered bot can go without a heartbeat (default 600000, ten minutes). `GATEWAY_STATUS_MAX_AGE_MS` is how long a Compose gateway report stays fresh (default 600000, 10 minutes). Blank, 0, or an invalid number uses that default. `HEALTH_TICK_MS` is the socket health interval (default 30000, and 0 turns it off). `USAGE_RETENTION_DAYS` is how many usage days a snapshot may keep (default 30). The same names are in `.env.example` and `apps/api/.env.example`.

## Ports

| Service | Where it listened |
| --- | --- |
| Web | `http://127.0.0.1:5173`. This is the owner UI port. `http://localhost:5173` also works when localhost resolves to that address. SSH tunnels use this port. |
| Tunnel | `http://127.0.0.1:3011`. Cloudflare Tunnel and Tailscale Serve use this port. `MC_REMOTE_PORT` defaults to 3011. |
| API | Direct clients use `http://127.0.0.1:3000`. The browser does not. It calls `/api` on the web port. |
| Postgres | `127.0.0.1:5432`, database `mission_control` |

`docker-compose.yml` publishes those ports on `127.0.0.1` only (`MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT`, and `MC_REMOTE_PORT` override the host side). Inside Compose the API binds `0.0.0.0:3000` and nginx listens on `5173` and `3011`. Moving `MC_API_PORT` does not change the browser unless you also set `VITE_API_URL`. `bash install.sh` writes the resolved `MC_DB_PORT` into a new `DATABASE_URL` for commands on the host. A later run updates that URL only when it is still the stock host and port. Compose still connects the API to `db:5432`. The installer prints the local URL and the tunnel port. [REMOTE.md](REMOTE.md) is the laptop guide for SSH, Tailscale Serve, and Cloudflare Tunnel.

## First run

1. `bash install.sh` starts Postgres, the API, and the web UI. `docker compose up -d --build` is the same Docker start when the tokens are already in `.env`. `npm run dev` is the advanced path and starts the API and the web app without Docker.
2. Open `http://localhost:5173/#/tasks`. `/` redirects to `/tasks`. The sidebar account chip says **Connected** plus the health latency when `GET /health` succeeds and the Socket.IO feed is up. **API only** means health is up and the socket is still reconnecting. **Offline** means the health probe failed.
3. If the first health probe fails, the shell sends the browser to `/#/connect`. Later failures do not keep redirecting.
4. `/#/connect` is an 8 step sheet: prerequisites, clone, root `.env`, start the stack, verify, OpenClaw bridge, remote access, smoke test. Progress is stored in this browser under `mc-setup-progress-v2`. Steps that say they probe health call `GET /health`. The other steps are marked done by the person at the keyboard. The last step returns to `/`, which lands on Tasks. Step 7 links to [REMOTE.md](REMOTE.md).
5. `/#/` goes to Tasks. Health lives on `/#/system`. Trust the sidebar chip.
6. The first open asks for a timezone, then whether to use the Mission Control crew or keep each agent's own name, then confirms the detected provider. Skip finishes that open. Each choice is saved on the settings row. Change them later under System, then Settings. Office uses the naming choice as soon as it is saved. `npm run seed:demo` does not finish setup and does not choose names. Crew names come from `config/crew.json` and apply only by the agent id you save. Usage and memory count days in the saved timezone. The names are `config/timezones.json`. A legacy name such as `Asia/Calcutta` is saved as its current name. With no saved timezone, that is `TZ` when that name is in the list, otherwise the host zone.

A fresh setup does not load sample data. `npm run dev` after migrate shows empty states. That is a valid first run, not a crash.

`npm run seed:demo` writes sample agents, cron jobs, tickets, projects, runs, activity, approvals, memories, docs, devices, usage, a mission line, and one custom tool. It is idempotent. It refuses to run when `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. Demo tickets, demo runs, activity, memory, doc authors, and usage agent lists store the agent id. The usage `bot` column stays the display name. A second run rewrites a demo row that still has a crew name or a legacy name. A registered bot named Forge does not take the seat, sticker, or status of the crew bot whose id is `forge`.

`npm run seed:clear` deletes only those sample rows. It matches the seeded ids, or the usage marker on a day nothing has overwritten. Registered bots, snapshot rows, and rows you created through the API stay. A mission you edited stays. A doc you edited stays. It is idempotent. Running it twice exits 0 both times. The same production guard applies.
