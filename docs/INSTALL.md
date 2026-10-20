# Install

The README is the short path. This file is the rest of the installer: env keys, ports, the bridge schedule, doctor, and the native commands. The one line command and the advanced command block in the README are the same commands this file describes.

Docker Compose is the default. One command writes random tokens, starts Postgres, the API, and the web UI, runs doctor, and prints the URL. The browser uses one port.

Prerequisites: git, bash, curl, and Docker with the Docker Compose plugin. When Docker is missing, the same command says so and uses Node.js 20.17 or later and Postgres 16 instead. Docker installs do not need Node on the host. OpenClaw can run this for you. Paste [PASTE_IN.md](PASTE_IN.md) and say yes.

```bash
curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
```

From a checkout you already have, run `bash install.sh` in the repo root. That is the same installer. It clones into `./mission-control` when you use the one line above.

Then open the URL the script prints. The default is **http://localhost:5173/#/tasks** (`MC_WEB_PORT`). A native API listens on `PORT` (default 3000). `MC_API_PORT` is the Compose host port (default 3000). On a native install it is accepted when `PORT` is unset. When both are set, `PORT` wins. The api container still listens on 3000.

`bash install.sh` copies `.env.example` to `.env` only when `.env` is missing. It writes `INGEST_TOKEN` as a random value, and it writes `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`. It never writes `change-me`. Long build output goes to `install.log`. The screen shows one progress line and names that file. The run ends with the URL, the password on the first install, and the reset command. A second run does not print or change the password. The file stores only the hash. A second run keeps every value already in `.env`. If the hash or the session secret is missing, that run fills only the missing one and does not change other keys. The script does not print the ingest token or the session secret. `npm run password:reset` writes a new hash to the session file, prints the password once, and revokes every session. It prints that password only after the new hash is read back. There is no HTTP route for that reset. The same run writes `MC_INSTALL_MODE=compose` or `MC_INSTALL_MODE=native` in `.env`. On compose, a host `npm run password:reset` runs `docker compose exec api npm run password:reset` inside the api container and does not call Node on the host or write a host file. If the api is not running, or Docker cannot run that command, it exits nonzero and tells you to run `docker compose up -d` first. With no `MC_INSTALL_MODE` in `.env`, a host `npm run password:reset` checks Docker for this checkout's Compose containers and its mc-auth volume. If it finds either, or Docker does not answer, it refuses and writes nothing. Run `bash install.sh` again, or start Docker when it did not answer, then run the reset again. With no docker command, or no Compose trace, the native reset runs. If the new hash cannot be read back, the command exits 3 and says the password may have changed. Run the reset again to set a new one.

Host ports follow the shell, then `.env`, then the default. `MC_DB_PORT`, `MC_API_PORT`, `MC_WEB_PORT`, and `MC_REMOTE_PORT` from the environment are written into a new `.env`. A shell `PORT`, or a shell `MC_API_PORT` when `PORT` is unset, is written into `PORT` on that new file so a native process listens there. `MC_REMOTE_PORT` defaults to 3011. A plain second run leaves `.env` unchanged once `MC_INSTALL_MODE` is set. A rerun writes that key when it is missing and does not change tokens. A shell `PORT` or `MC_WEB_PORT` still wins for that run. A shell `MC_DB_PORT` that differs from the stored port updates `DATABASE_URL` only when that URL uses `localhost` or `127.0.0.1` and its port is the previous `MC_DB_PORT`, or 5432 when none was stored. That same run updates the `MC_DB_PORT` line. A custom URL, including another host or a URL with no port, is left as is and the installer says so. Tokens and secrets are not rotated. A shell value still wins for that run.

OpenClaw is optional. The command above does not start the OpenClaw gateway. On this Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. After `npm ci`, `npm run seed:demo` writes sample bots, tickets, and usage. `npm run seed:clear` deletes only those sample rows. A fresh setup does not load sample data. `npm run seed:demo` does not need OpenClaw.

## Bridge schedule

When the `openclaw` command is on PATH, `bash install.sh` installs a bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The installer names the scheduler it used. The interval is `MC_BRIDGE_INTERVAL_SECONDS` from the shell, then `.env`, then 300. The job runs `bridge/mc-bridge-sync.py` and sets `MC_BRIDGE_REGISTER` from the shell, then `.env`, then 1. A steady state run starts `openclaw` once, for sessions. Agents, cron, devices, nodes, the models list, and the CLI version are cached and fetched again when `openclaw.json` changes, a value is missing, or once an hour. `--profile` prints the time, CPU, peak memory, and `openclaw` calls. See [A light run](../bridge/README.md#a-light-run). Its PATH includes the `openclaw` directory, the `python3` directory, and the PATH from install time, so a later run can find `openclaw`. Remove only that schedule with `bash install.sh --uninstall-schedule`. That flag also removes the sync timestamp. It does not stop Docker, does not delete `.env`, and does not change other cron lines or other service units. If `openclaw` is not on PATH, the installer prints a skip line and continues. A second run installs the same schedule again without duplicating it.

Doctor reads the sync timestamp at `MC_BRIDGE_STAMP_FILE` (default `bridge/.state/last-sync`). A missing timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` (default 600) is a failing line when a schedule is installed. With no schedule, that age is an info line. A missing `openclaw` command is still an info line and does not by itself fail doctor. Doctor also reports the gateway. Under Compose, with `OPENCLAW_GATEWAY_HOST` unset, that line uses the bridge report and says Unknown when the report is missing or older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000). A future checkedAt is counted from the time the API stored the report. If this user lacks permission to use the Docker socket, that Unknown line says to add the user to the docker group and start a new login session. A native install, or an explicit host, is a direct probe of `127.0.0.1` or that host on `OPENCLAW_GATEWAY_PORT` (default 18789). The line is info. OpenClaw does not have to be running. The installer also offers `bridge/openclaw.starter.json`. Merge that file into `~/.openclaw/openclaw.json` if you want it. The installer does not edit that file.

## What the command starts

The API loads the root `.env` when that file is on disk, and it runs `prisma migrate deploy` before it listens. Compose injects `DATABASE_URL` for the `db` service, so the image does not contain a `.env` file. A variable that is already set wins over the file, including a blank value. The host `DATABASE_URL` is what `npm run seed:demo` uses. On a new `.env` its port is the resolved `MC_DB_PORT`.

nginx on the web port proxies `/api` and `/socket.io` to the API. The page and the live socket stay on `MC_WEB_PORT` (default 5173). That port is the owner port. SSH tunnels use it. Cloudflare Tunnel and Tailscale Serve use `MC_REMOTE_PORT` (default 3011). Leave `VITE_API_URL` unset. Set it only when the browser should call a different API origin, then rebuild the web image. The laptop steps are in [REMOTE.md](REMOTE.md).

`docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`. That is the port inside the container. The host port is `MC_API_PORT`. Data lives in the named volume `mc-db` and stays across `docker compose restart`.

Before Compose starts, `bash install.sh` creates the host docs directory as the user running the installer. The path is `DOCS_ROOT` from the shell, then `.env`, then `data/docs`. That user can delete the checkout, including `data/docs`. `npm run seed:demo` on the host writes sample markdown as that same user. The api container runs as root, so a seed command started inside that container writes root-owned files in `data/docs`. Session files stay in the named volume `mc-auth`.

The API image includes the default config: `config/crew.json`, `config/prices.json`, and `config/timezones.json`. A plain `docker run` of that image serves `GET /settings` without a config mount. Compose mounts `./config` over `/app/config`, and that mount overrides the files in the image.

The script ends by running doctor. On the Docker path that check runs inside the api container with `docker compose exec`, whether or not Node is on the host. The native path runs `node scripts/doctor.mjs`. On the Docker path it first waits up to 90 seconds for the API health check on `MC_API_PORT` (default 3000). That wait polls /health with curl from the host. If curl is missing on the host, it runs curl inside the api container with `docker compose exec`. It reports healthy as soon as the API answers. The wait does not call host Node, npm, or npx. Doctor then checks that host port and retries the health probe for up to 60 seconds. If the db, api, and web containers are running and the API is not ready, doctor prints `The API is still starting. Run doctor again in a minute.` If db, api, or web has exited, doctor fails and names `docker compose start` for that service. If that container was removed or never created, it names `docker compose up -d`. If one of them is paused, doctor fails and names `docker compose unpause`. Doctor reports a port conflict when another program holds the API, web, database, or tunnel port, including when containers are created or exited. The line names `MC_API_PORT`, `MC_WEB_PORT`, `MC_DB_PORT`, or `MC_REMOTE_PORT`. A compose file selects that check even when no container exists, unless the native API is already answering and no Compose container exists. The port line comes before a stopped or missing service. The native installer runs doctor with `MC_DOCTOR_DOCKER=0`, so that run keeps the native check. When `docker compose up` fails because a port is already in use, the installer prints `Port 3000 is used by another program. Stop it or set MC_API_PORT in .env.` with the real port and the matching name among MC_API_PORT, MC_WEB_PORT, MC_DB_PORT, and MC_REMOTE_PORT. Docker's own error follows that line, and the installer exits 1. The database and migration lines are info, because Compose runs Postgres and the API container applies migrations. A Docker install does not need `npm ci` for those checks. It checks the API, web, database, and tunnel ports. The tunnel port is `MC_REMOTE_PORT` (default 3011). A missing OpenClaw command is an info line. A missing sync timestamp is an info line. A timestamp older than `MC_BRIDGE_STALE_SECONDS` fails doctor when a schedule is installed. If doctor prints a failing line, the script still prints the URL and then exits non zero. A Compose install runs that doctor check even when Node is not on PATH, and it still exits 0 after the API answers when every required check passes.

Compose does not invent an ingest token or a dashboard password. A blank `INGEST_TOKEN` stays blank. A blank `DASHBOARD_PASSWORD_HASH` makes the API refuse to start, because Compose sets `HOST=0.0.0.0` inside the api container. `bash install.sh` writes both before Compose starts.

CI runs `bash install.sh` on the free GitHub hosted runners. Ubuntu runs the Docker Compose install and the native install. macOS runs the native install only, because Docker on that runner is unreliable. Each of those jobs posts `bridge/examples/fresh-install` with `bridge/mc-bridge-sync.py` and checks devices, nodes, approvals, and gateway status through the API. The fresh clone job still runs the advanced path below on Node.js 20, Node.js 22, and Node.js 24. A separate job still checks `bash install.sh` with a docker stub on Ubuntu and macOS. The compose file, the nginx config, and the Dockerfiles are checked as text.

## Advanced: Node and Postgres

Use this path when Docker is not installed. The fresh clone CI job runs these commands on Node.js 20, Node.js 22, and Node.js 24. `bash install.sh` follows this path when Docker is missing, which is what the native installer jobs do.

Prerequisites that a local run used: git, Node.js 20.17 or later, npm 11.17.0, and Postgres 16 listening on `127.0.0.1:5432`. Node 20, 22, 24, and 26 pass, and there is no upper bound.

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

Then open **http://localhost:5173/#/tasks** unless `MC_WEB_PORT` names another port. The dev server and the preview server listen on `MC_WEB_PORT` and do not move to a free port if that port is taken. They proxy `/api` and `/socket.io` to `PORT` (or `MC_API_PORT` when `PORT` is unset). The browser stays on the web port. Leave `VITE_API_URL` unset here too.

`npm ci` prints an `allow-scripts` warning for `@prisma/engines`, `prisma`, and `unrs-resolver` on npm 11.17.0. The following `npx prisma generate` still completes. `npx prisma migrate deploy` applies every folder in `apps/api/prisma/migrations`.

| Command | Why |
| --- | --- |
| `cp .env.example .env` | Root env file. The API loads it on boot. Compose reads the same file. |
| `set -a; . ./.env; set +a` | Vite and Turbo only see variables that are already in the environment. The API also loads the file itself. The dev proxy does not attach a token. |
| `npx prisma generate` | Builds the Prisma client. Run it from `apps/api`. npm 11 does not do this during `npm ci`. |
| `npx prisma migrate deploy` | Applies `apps/api/prisma/migrations`. The API also runs this on boot. |
| `npm run dev` | Turbo starts the API (`nest start --watch`) and the web app (`vite`) together. |

Leave `GITHUB_TOKEN` empty unless you want pull request merge from Approvals. Do not commit `.env`. Under Compose the bridge checks the gateway at 127.0.0.1 and posts `gateway.snapshot` with `x-ingest-token`. System shows Unknown when that report is missing or older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000). A report stored before the API process started is Unknown too, so a recreated API container shows Unknown until the next bridge report. A future checkedAt is counted from the time the API stored the report. A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host on `OPENCLAW_GATEWAY_PORT` (default 18789). `extra_hosts` still maps `host.docker.internal` for that override. Gateway logs are read from `OPENCLAW_LOG_DIR` (default `/tmp/openclaw`).

`OPERATOR_NAME` is a display name, not a secret. Blank means the account chip says Operator. For `npm run dev`, also set `VITE_OPERATOR_NAME` to the same value if you want the browser bundle to see it. Vite only exposes `VITE_*` variables.

`TZ` is the server timezone when Settings has not saved one. `OFFLINE_AFTER_MS` is how long a registered bot can go without a heartbeat (default 600000, ten minutes). `GATEWAY_STATUS_MAX_AGE_MS` is how long a Compose gateway report stays fresh (default 600000, 10 minutes). Blank, 0, or an invalid number uses that default. `HEALTH_TICK_MS` is the socket health interval (default 30000, and 0 turns it off). `USAGE_RETENTION_DAYS` is how many usage days a snapshot may keep (default 30). The same names are in `.env.example` and `apps/api/.env.example`.

## Ports

| Service | Name | Default |
| --- | --- | --- |
| Web, native dev and preview, and the Compose host port | `MC_WEB_PORT` | 5173 |
| API listen on a native install | `PORT` | 3000 |
| API host port on Compose. Also the native listen port when `PORT` is unset | `MC_API_PORT` | 3000 |
| Tunnel host port | `MC_REMOTE_PORT` | 3011 |
| Postgres host port | `MC_DB_PORT` | 5432 |

The web address is `http://127.0.0.1:<MC_WEB_PORT>`. `http://localhost:<MC_WEB_PORT>` also works when localhost resolves to that address. SSH tunnels use that owner port. Direct API clients use `http://127.0.0.1:<PORT>` on a native install and `http://127.0.0.1:<MC_API_PORT>` when Compose published the API. The browser does not call that port. It calls `/api` on the web port. The bridge default target is `MC_API_URL`, then `MC_API_PORT` when that is set, then `PORT`, then port 3000. With a compose file, doctor checks `MC_API_PORT`, `MC_WEB_PORT`, `MC_DB_PORT`, and `MC_REMOTE_PORT`. The native check uses `PORT`.

`docker-compose.yml` publishes the host ports on `127.0.0.1` only. Inside Compose the API binds `0.0.0.0:3000` and nginx listens on `5173` and `3011`. Moving `MC_API_PORT` does not change the browser unless you also set `VITE_API_URL`. `bash install.sh` writes the resolved `MC_DB_PORT` into a new `DATABASE_URL` for commands on the host. A later run updates that URL only when it is still the stock host and port. Compose still connects the API to `db:5432`. The installer prints the local URL and the tunnel port. [REMOTE.md](REMOTE.md) is the laptop guide for SSH, Tailscale Serve, and Cloudflare Tunnel.

## First run

1. `bash install.sh` starts Postgres, the API, and the web UI. `docker compose up -d --build` is the same Docker start when the tokens are already in `.env`. `npm run dev` is the advanced path and starts the API and the web app without Docker.
2. Open the URL the installer printed (`http://localhost:<MC_WEB_PORT>/#/tasks`, default port 5173). `/` redirects to `/tasks`. The sidebar account chip says **Connected** plus the health latency when `GET /health` succeeds and the Socket.IO feed is up. **API only** means health is up and the socket is still reconnecting. **Offline** means the health probe failed.
3. If the first health probe fails, the shell sends the browser to `/#/connect`. Later failures do not keep redirecting.
4. `/#/connect` is an 8 step sheet: prerequisites, clone, root `.env`, start the stack, verify, OpenClaw bridge, remote access, smoke test. Progress is stored in this browser under `mc-setup-progress-v2`. Steps that say they probe health call `GET /health`. The other steps are marked done by the person at the keyboard. The last step returns to `/`, which lands on Tasks. Step 7 links to [REMOTE.md](REMOTE.md).
5. `/#/` goes to Tasks. Health lives on `/#/system`. Trust the sidebar chip.
6. The first open asks for a timezone, then whether to use the Mission Control crew or keep each agent's own name, then confirms the detected provider. Skip finishes that open. Each choice is saved on the settings row. Change them later under System, then Settings. Office uses the naming choice as soon as it is saved. `npm run seed:demo` does not finish setup and does not choose names. If crew mode is already saved, a new demo agent takes a seat by the rules in [How crew seats work](../README.md#how-crew-seats-work). `npm run seed:clear` drops those seats. Crew names come from `config/crew.json`. Usage and memory count days in the saved timezone. The names are `config/timezones.json`. A legacy name such as `Asia/Calcutta` is saved as its current name. With no saved timezone, that is `TZ` when that name is in the list, otherwise the host zone.

A fresh setup does not load sample data. `npm run dev` after migrate shows empty states. That is a valid first run, not a crash.

`npm run seed:demo` writes sample agents, cron jobs, tickets, projects, runs, activity, approvals, memories, docs, devices, usage, a mission line, and one custom tool. It is idempotent. It refuses to run when `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`. Demo tickets, demo runs, activity, memory, doc authors, and usage agent lists store the agent id. The usage `bot` column stays the display name. A second run rewrites a demo row that still has a crew name or a legacy name. A registered bot named Forge does not take the seat, sticker, or status of the crew bot whose id is `forge`.

`npm run seed:clear` deletes only those sample rows. It matches the seeded ids, or the usage marker on a day nothing has overwritten. Registered bots, snapshot rows, and rows you created through the API stay. A mission you edited stays. A doc you edited stays. It is idempotent. Running it twice exits 0 both times. The same production guard applies.
