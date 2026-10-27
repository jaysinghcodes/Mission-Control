# ONBOARDING.md

Paste this file to an OpenClaw agent from the directory where you cloned the repo. The agent walks a person through install. It does not invent secrets.

Paste [docs/PASTE_IN.md](docs/PASTE_IN.md) when OpenClaw should install Mission Control, report the URL, register, and send a heartbeat. The operator only says yes. This file is the longer install walk. The API, including the 401 line, is [docs/API.md](docs/API.md). The short guide is [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md).

---

You are helping your operator install Mission Control. The web app is React 19, Vite 8, and Tailwind CSS v4. The API is NestJS 11, Socket.IO, and Prisma 7 on Postgres 16. The dashboard shows tasks, agents, approvals, projects, an office floor, a pipeline, a calendar of cron jobs, memory, docs, team, and system health.

Without OpenClaw, `npm run seed:demo` fills sample data and the task board still works. With OpenClaw, the vendored `bridge/` posts snapshots to `POST /events`.

The web app uses hash routes. Open `http://localhost:5173/#/tasks`. `/` redirects there. A URL with no `#` is not a client route.

Docker Compose is the default. The browser uses one port. The API loads the root `.env` and runs `prisma migrate deploy` on boot. The one command is `bash install.sh` from the repo root, or the curl one liner in the README. It writes a random `INGEST_TOKEN`, a dashboard password hash, and a session secret into `.env` when that file is missing, starts the stack, runs doctor, and prints the URL. It prints the dashboard password once and does not print the ingest token. A plain second run leaves `.env` unchanged once `MC_INSTALL_MODE` is set. `DATABASE_URL` on a new file uses the resolved `MC_DB_PORT` (the shell, then `.env`, then 5432). A later run updates that URL only when a new `MC_DB_PORT` is passed and the URL is still the stock localhost port. A custom URL is left as is. Tokens and secrets are not rotated. If the hash or the session secret is missing, that run fills only the missing one. If Docker is missing, the script says so and uses Node.js 20.17 or later and Postgres 16. Docker installs do not need Node on the host. Doctor on that path runs inside the api container. Do not invent a second install.

Guide the operator one step at a time.

* Never fabricate secrets. Stop and ask for a real database URL, ingest token, or API key.
* Show the command and wait before anything that changes their machine.
* Do not bypass approvals. Do not write to external services without a yes.
* After each step, say what happened and what is next. If it errors, debug before moving on.
* Redact secrets in anything you echo. Never print a full token.

### Step 1. Confirm prerequisites

Confirm each of these:

* Node.js 20.17 or later (`node -v`). Node 20, 22, 24, and 26 pass, and there is no upper bound. Docker installs do not need Node on the host. The root `packageManager` is `npm@11.17.0`.
* npm 11.17.0 (`npm -v`). If the shell npm is older, `corepack npm -v` should report 11.17.0 after `corepack prepare npm@11.17.0 --activate`.
* git (`git --version`).
* Docker and the Docker Compose plugin (`docker compose version`). This is the default runtime. `bash install.sh` uses it first.
* curl and bash, for the one command in the README. From a checkout, `bash install.sh` does not need curl.
* Postgres 16 is started by Compose. On the advanced path it must already listen on `127.0.0.1:5432`, database `mission_control`, user `postgres`. The template password is `postgres`. That is a local default. Ask before you reuse it anywhere but loopback.
* Optional: a running OpenClaw CLI (`openclaw`). Without it, the dashboard still runs. Sample data is a separate command. Do not pretend the bridge synced.

### Step 2. Clone and install

```sh
git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control
cd mission-control
bash install.sh
```

That writes the ingest token and dashboard login values when `.env` is missing, starts the stack, runs doctor, and prints the URL. The password is printed once. A plain second run leaves `.env` unchanged once `MC_INSTALL_MODE` is set. A later run updates `DATABASE_URL` only when a new `MC_DB_PORT` is passed and the URL is still the stock localhost port. A custom URL is left as is. Do not print the token or the password hash. Tell the operator the token lives in `.env`.

If `openclaw` is on PATH, the same command installs the bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The interval comes from `MC_BRIDGE_INTERVAL_SECONDS` (default 300). Remove it with `bash install.sh --uninstall-schedule`. If `openclaw` is not on PATH, the installer says so and continues. `npm run seed:demo` still works. On Compose, run `npm ci` in the checkout first, as [Demo data](docs/INSTALL.md#demo-data) says.

`npm ci` runs only on the native path, when Docker is missing. It may warn that `@prisma/engines`, `prisma`, and `unrs-resolver` have install scripts not yet covered by allowScripts. `npx prisma generate` still succeeded after that warning on npm 11.17.0.

### Step 3. Create the root .env

Compose and the API both read the root `.env` next to `docker-compose.yml`. A variable that is already set wins over the file. `apps/api/.env` wins over the root file when both set a key. `apps/api/.env.example` is only a second template.

If step 2 already ran `bash install.sh`, `.env` exists. Leave it. The tokens are already random. Do not copy the template over that file.

Copy the template only when `.env` is missing and you are not using the installer:

```sh
cp .env.example .env
```

Walk each variable. Ask the operator for real values. Do not invent one.

* `DATABASE_URL`: leave the user and password unless their Postgres login differs. `bash install.sh` sets the port from `MC_DB_PORT` (the shell, then `.env`, then 5432) when it creates `.env`. A later run updates that port only when the URL is still `localhost` or `127.0.0.1` on the previous port and a new `MC_DB_PORT` is passed. A custom URL is left as is. Compose still points the API at the db service.
* `INGEST_TOKEN`: shared secret for agent ingest, including `POST /events`. Send it as `x-ingest-token`. `bash install.sh` writes a random value when it creates `.env`. You may generate one with `openssl rand -hex 24` and show it once. The template placeholder is not a production secret. Replace it before anyone else can reach the port. The bridge reads this same variable and exits if it is blank. The web bundle does not contain the value. If it is unset and `HOST` is not loopback, the API refuses to start. A second run of the installer does not replace a token that is already in `.env`.
* `DASHBOARD_PASSWORD_HASH` and `SESSION_SECRET`: the dashboard password, stored hashed, and the cookie secret. `bash install.sh` writes both when they are missing and prints the password once. Loopback `npm run dev` stays open when the hash is blank. Compose requires both, because the API sees the Docker network and not loopback. `SOCKET_TOKEN` is retired. Do not bake a socket token into the web bundle.
* `WEB_ORIGIN`: leave commented unless they need another origin. The API default is `http://localhost:5173` and `http://127.0.0.1:5173`.
* `OPERATOR_NAME`: display only, not a secret. Blank means the chip says Operator. For `npm run dev`, set `VITE_OPERATOR_NAME` to the same string if the browser should show the name.
* `GITHUB_TOKEN`: optional. Ask only if they want pull request merge from Approvals.

`.env` is gitignored. Never commit it.

### Step 4. Start the stack

`bash install.sh` already starts the stack. Running it again is safe. A plain second run leaves `.env` unchanged once `MC_INSTALL_MODE` is set. It updates a stock `DATABASE_URL` when a new `MC_DB_PORT` is passed, and it leaves a custom URL as is. Default, with Docker. Those commands do not load sample data. Leave `VITE_API_URL` unset. The browser uses port 5173, and nginx proxies `/api` and `/socket.io`.

```sh
docker compose up -d --build
```

`docker compose logs api` should end with `mission-control api listening on 0.0.0.0:3000`. The API runs `prisma migrate deploy` before it listens.

No Docker? Use the advanced path from the README. Export the file, generate the client, migrate, and start both apps:

```sh
set -a; . ./.env; set +a
(cd apps/api && npx prisma generate)
(cd apps/api && npx prisma migrate deploy)
npm run dev
```

`npm run dev` runs the API on port 3000 and Vite on port 5173. The dev server proxies `/api` and `/socket.io`. Leave that process running. The board starts empty. The export is required so Vite sees the file. The dev proxy does not attach a token. The API also loads `.env` on its own.

`npm run seed:demo` fills sample agents, tickets, and the rest of the sample set. `npm run seed:clear` removes only that sample data. Registered bots, snapshot rows, and tickets created through the API stay. Both commands are safe to run again. Both refuse `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`.

The API log line is `mission-control api listening on 127.0.0.1:3000` when `HOST=127.0.0.1`. That lowercase string is the log text, not the product name.

### Step 5. Verify the dashboard

Ask the operator to open `http://localhost:5173/#/tasks`.

* The task board loads. The sidebar chip says Connected when health and the socket are up.
* `http://127.0.0.1:5173/api/health` returns `"status":"ok"` and `"database":"connected"`. Direct `http://127.0.0.1:3000/health` does the same when that port is published.
* `http://127.0.0.1:5173/#/tasks` loads. The page and the API share that origin.

`/#/` redirects to tasks. Open `/#/system` for health. The setup sheet does not mention an Overview page. Use Tasks and System.

If the first health check fails, the app opens `/#/connect`. Fix the API, then reload `/#/tasks`.

### Step 6. Connect OpenClaw

Skip if they have no OpenClaw CLI yet.

```sh
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
```

With no `openclaw` binary, `--dry-run` exits 0 and posts nothing. That was verified. A real sync needs the CLI and a non blank `INGEST_TOKEN`. A steady state run starts `openclaw` once, for sessions. Agents, cron, devices, nodes, the models list, and the CLI version are cached and fetched again when `openclaw.json` changes, a value is missing, or once an hour. `--profile` prints the time, CPU, peak memory, and `openclaw` calls. See [A light run](bridge/README.md#a-light-run).

`bash install.sh` already schedules that command when `openclaw` is on PATH. Do not add a second cron line. The interval is `MC_BRIDGE_INTERVAL_SECONDS` (default 300). The schedule PATH includes the `openclaw` directory and the `python3` directory. `bash install.sh --uninstall-schedule` removes the schedule, removes the sync timestamp, and leaves every other cron line and service unit alone. `npm run doctor` fails when a schedule is installed and the last successful sync is older than `MC_BRIDGE_STALE_SECONDS` (default 600). A missing timestamp is an info line. A stale timestamp is also an info line when no schedule is installed.

Paste [docs/PASTE_IN.md](docs/PASTE_IN.md) when OpenClaw should bring the dashboard up. The operator only says yes. A 401 means the token is wrong, or that route is for the dashboard only. That line is in [docs/API.md](docs/API.md#41-auth). The short guide is [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md).

Optional starter limits, merged into `~/.openclaw/openclaw.json` and not a replacement of that file: `agents.defaults.subagents.maxChildrenPerAgent` is 3 and `maxConcurrent` is 4, from `bridge/openclaw.starter.json`. The API does not read those keys. The installer offers this merge and does not edit the file.

### Step 7. Another machine

Optional. Three free ways are in [docs/REMOTE.md](docs/REMOTE.md). Login is required on a Compose install.

SSH uses the owner web port only. The default is 5173. On the laptop:

```sh
ssh -L 5173:127.0.0.1:5173 ubuntu@your-server-ip
```

Keep the SSH session open. On the laptop, open `http://127.0.0.1:5173/#/tasks`. If the installer printed another web port, use that port in the command and in the URL. Tailscale Serve and Cloudflare Tunnel point at `127.0.0.1` on `MC_REMOTE_PORT` (default 3011). `/#/connect` repeats the SSH command per operating system and links to the guide. The Connection panel does too.

### Step 8. Smoke test

Without OpenClaw:

1. On `http://localhost:5173/#/tasks?view=backlog`, use the row action that sends a demo ticket to the board. Refresh `/#/tasks`. The card is still there.
2. After the seed: `/#/calendar` shows the sample jobs, `/#/agents` and `/#/team` show the 12 sample agents, `/#/office` places them by role, `/#/memory` and `/#/docs` have sample notes.

With the bridge:

3. Calendar jobs become the real cron list. `calendar.snapshot` replaces the table.
4. Agents and the office floor follow `agents.snapshot`, and also `POST /agents/register` and `DELETE /agents/:id`, which broadcast that same event. `run.*` events show up as activity. A ticket move also writes activity, so a local move is not proof the bridge ran.
5. `/#/system` shows a recent OpenClaw bridge time after any accepted `POST /events`. Sessions stay empty until `sessions.snapshot`. Logs stay empty until the log directory has a gateway log. That directory is `OPENCLAW_LOG_DIR`, default `/tmp/openclaw`, and the empty state names the directory `GET /logs` returns. Provider rows stay empty until `models.snapshot`. The empty sentence is "No providers found yet. Run the bridge to detect them." Team devices follow `devices.snapshot` from `openclaw devices list` and `openclaw nodes list`. Pair a device on Team adds a manual device that snapshots leave alone. Until then, the devices card says you can add one there or wait for the bridge.

Tell the operator where `.env` lives, that it must not be committed, and that OpenClaw is optional for looking around.
