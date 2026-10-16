# ONBOARDING.md

Paste this file to an OpenClaw agent from the directory where you cloned the repo. The agent walks a person through install. It does not invent secrets.

For the event contract (how that same agent reports into a running Mission Control), paste [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md) instead. This file is the install. That file is the API.

---

You are helping your operator install Mission Control. The web app is React 19, Vite 8, and Tailwind CSS v4. The API is NestJS 11, Socket.IO, and Prisma 7 on Postgres 16. The dashboard shows tasks, agents, approvals, projects, an office floor, a pipeline, a calendar of cron jobs, memory, docs, team, and system health.

Without OpenClaw, `npm run seed:demo` fills sample data and the task board still works. With OpenClaw, the vendored `bridge/` posts snapshots to `POST /events`.

The web app uses hash routes. Open `http://localhost:5173/#/tasks`. `/` redirects there. A URL with no `#` is not a client route.

Docker Compose is the default. The browser uses one port. The API loads the root `.env` and runs `prisma migrate deploy` on boot. The one command is `bash install.sh` from the repo root, or the curl one liner in the README. It writes random `INGEST_TOKEN` and `SOCKET_TOKEN` values into `.env` when that file is missing, starts the stack, runs doctor, and prints the URL. It does not print the token. A second run keeps `.env` as it is. If Docker is missing, the script says so and uses Node.js 22 and Postgres 16. Do not invent a second install.

Guide the operator one step at a time.

* Never fabricate secrets. Stop and ask for a real database URL, ingest token, or API key.
* Show the command and wait before anything that changes their machine.
* Do not bypass approvals. Do not write to external services without a yes.
* After each step, say what happened and what is next. If it errors, debug before moving on.
* Redact secrets in anything you echo. Never print a full token.

### Step 1. Confirm prerequisites

Confirm each of these:

* Node.js 20.17 or newer, or 22.9 or newer (`node -v`). The root `packageManager` is `npm@11.17.0`.
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

That writes tokens when `.env` is missing, starts the stack, runs doctor, and prints the URL. A second run keeps `.env`. Do not print the token values. Tell the operator they live in `.env`.

If `openclaw` is on PATH, the same command installs the bridge schedule. Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd. The interval comes from `MC_BRIDGE_INTERVAL_SECONDS` (default 300). Remove it with `bash install.sh --uninstall-schedule`. If `openclaw` is not on PATH, the installer says so and continues. `npm run seed:demo` still works.

`npm ci` runs only on the native path, when Docker is missing. It may warn that `@prisma/engines`, `prisma`, and `unrs-resolver` have install scripts not yet covered by allowScripts. `npx prisma generate` still succeeded after that warning on npm 11.17.0.

### Step 3. Create the root .env

Compose and the API both read the root `.env` next to `docker-compose.yml`. A variable that is already set wins over the file. `apps/api/.env` wins over the root file when both set a key. `apps/api/.env.example` is only a second template.

If step 2 already ran `bash install.sh`, `.env` exists. Leave it. The tokens are already random. Do not copy the template over that file.

Copy the template only when `.env` is missing and you are not using the installer:

```sh
cp .env.example .env
```

Walk each variable. Ask the operator for real values. Do not invent one.

* `DATABASE_URL`: leave the template unless their Postgres user or password differs.
* `INGEST_TOKEN`: shared secret for every API write, including `POST /events`. Send it as `x-ingest-token`. `bash install.sh` writes a random value when it creates `.env`. You may generate one with `openssl rand -hex 24` and show it once. The template placeholder is not a production secret. Replace it before anyone else can reach the port. The bridge reads this same variable and exits if it is blank. The web UI does not put the value in the browser. If it is unset and `HOST` is not loopback, the API refuses to start. A second run of the installer does not replace a token that is already in `.env`.
* `SOCKET_TOKEN`: `bash install.sh` writes a random value when it creates `.env`. Optional for `npm run dev`. Required when `NODE_ENV=production` (the Compose API sets that). If they set one, set `VITE_SOCKET_TOKEN` to the same value before a production web build. A blank value is fine for the dev server verified here. A blank value still becomes `dev-socket-token` only when Compose starts without the installer.
* `WEB_ORIGIN`: leave commented unless they need another origin. The API default is `http://localhost:5173` and `http://127.0.0.1:5173`.
* `OPERATOR_NAME`: display only, not a secret. Blank means the chip says Operator. For `npm run dev`, set `VITE_OPERATOR_NAME` to the same string if the browser should show the name.
* `GITHUB_TOKEN`: optional. Ask only if they want pull request merge from Approvals. `DEEPSEEK_API_KEY` and `ZAI_API_KEY` are in the template. The API does not read them.

`.env` is gitignored. Never commit it.

### Step 4. Start the stack

`bash install.sh` already starts the stack. Running it again is safe and keeps `.env`. Default, with Docker. Those commands do not load sample data. Leave `VITE_API_URL` unset. The browser uses port 5173, and nginx proxies `/api` and `/socket.io`.

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

`npm run dev` runs the API on port 3000 and Vite on port 5173. The dev server proxies `/api` and `/socket.io`. Leave that process running. The board starts empty. The export is required so Vite sees `INGEST_TOKEN`. The API also loads `.env` on its own.

`npm run seed:demo` fills sample agents, tickets, and the rest of the sample set. `npm run seed:clear` removes only that sample data. Registered bots, snapshot rows, and tickets created through the API stay. Both commands are safe to run again. Both refuse `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`.

The API log line is `mission-control api listening on 127.0.0.1:3000` when `HOST=127.0.0.1`. That lowercase string is the log text, not the product name.

### Step 5. Verify the dashboard

Ask the operator to open `http://localhost:5173/#/tasks`.

* The task board loads. The sidebar chip says Connected when health and the socket are up.
* `http://127.0.0.1:5173/api/health` returns `"status":"ok"` and `"database":"connected"`. Direct `http://127.0.0.1:3000/health` does the same when that port is published.
* `http://127.0.0.1:5173/#/tasks` loads. The page and the API share that origin.

`/#/` redirects to tasks. `/#/health` redirects to `/#/system`. The setup sheet inside the app still mentions an Overview page. Ignore that sentence and use Tasks and System.

If the first health check fails, the app opens `/#/connect`. Fix the API, then reload `/#/tasks`.

### Step 6. Connect OpenClaw

Skip if they have no OpenClaw CLI yet.

```sh
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
```

With no `openclaw` binary, `--dry-run` exits 0 and posts nothing. That was verified. A real sync needs the CLI and a non blank `INGEST_TOKEN`.

`bash install.sh` already schedules that command when `openclaw` is on PATH. Do not add a second cron line. The interval is `MC_BRIDGE_INTERVAL_SECONDS` (default 300). The schedule PATH includes the `openclaw` directory and the `python3` directory. `bash install.sh --uninstall-schedule` removes the schedule, removes the sync timestamp, and leaves every other cron line and service unit alone. `npm run doctor` fails when a schedule is installed and the last successful sync is older than `MC_BRIDGE_STALE_SECONDS` (default 600). A missing timestamp is an info line. A stale timestamp is also an info line when no schedule is installed.

Paste [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md) when the agent itself should POST events. A 401 means the header `x-ingest-token` does not match the API `INGEST_TOKEN`.

Optional starter limits, merged into `~/.openclaw/openclaw.json` and not a replacement of that file: `agents.defaults.subagents.maxChildrenPerAgent` is 3 and `maxConcurrent` is 4, from `bridge/openclaw.starter.json`. The API does not read those keys. The installer offers this merge and does not edit the file.

### Step 7. Another machine

Optional. The API and the dev server listen on loopback. From a laptop:

```sh
ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>
```

Keep the SSH session open. `/#/connect` and the Health page repeat this command per operating system. Vite listens on `127.0.0.1:5173`, which is the address this tunnel forwards to. On the laptop, open `http://127.0.0.1:5173/#/tasks`.

### Step 8. Smoke test

Without OpenClaw:

1. On `http://localhost:5173/#/tasks?view=backlog`, use the row action that sends a demo ticket to the board. Refresh `/#/tasks`. The card is still there.
2. After the seed: `/#/calendar` shows the sample jobs, `/#/agents` and `/#/team` show the 12 sample agents, `/#/office` places them by role, `/#/memory` and `/#/docs` have sample notes.

With the bridge:

3. Calendar jobs become the real cron list. `calendar.snapshot` replaces the table.
4. Agents and the office floor follow `agents.snapshot`, and also `POST /agents/register` and `DELETE /agents/:id`, which broadcast that same event. `run.*` events show up as activity. A ticket move also writes activity, so a local move is not proof the bridge ran.
5. `/#/system` shows a recent OpenClaw bridge time after any accepted `POST /events`. Sessions stay empty until `sessions.snapshot`. Logs stay empty until `/tmp/openclaw` has a gateway log.

Tell the operator where `.env` lives, that it must not be committed, and that OpenClaw is optional for looking around.
