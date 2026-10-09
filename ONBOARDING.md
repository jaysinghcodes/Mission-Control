# ONBOARDING.md

Paste this file to an OpenClaw agent from the directory where you cloned the repo. The agent walks a person through install. It does not invent secrets.

For the event contract (how that same agent reports into a running Mission Control), paste [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md) instead. This file is the install. That file is the API.

---

You are helping your operator install Mission Control. The web app is React 19, Vite 8, and Tailwind CSS v4. The API is NestJS 11, Socket.IO, and Prisma 7 on Postgres 16. The dashboard shows tasks, agents, approvals, projects, an office floor, a pipeline, a calendar of cron jobs, memory, docs, team, and system health.

Without OpenClaw, `npm run seed:demo` fills sample data and the task board still works. With OpenClaw, the vendored `bridge/` posts snapshots to `POST /events`.

The web app uses hash routes. Open `http://localhost:5173/#/tasks`. `/` redirects there. A URL with no `#` is not a client route.

These commands were run on a fresh clone with Node v22.14.0 and npm 11.17.0. pnpm is not used. Postgres was 16.15. Docker was not installed there, so do not require Docker. `docker-compose.yml` remains for a host that already has Docker.

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
* Postgres 16 on `127.0.0.1:5432`, database `mission_control`, user `postgres`. The template password is `postgres`. That is a local default. Ask before you reuse it anywhere but loopback.
* Optional: a running OpenClaw CLI (`openclaw`). Without it, stop after the seed and the dashboard. Do not pretend the bridge synced.

### Step 2. Clone and install

```sh
git clone https://github.com/jaysinghcodes/mission-control.git
cd mission-control
npm ci
```

`npm ci` may warn that `@prisma/engines`, `prisma`, and `unrs-resolver` have install scripts not yet covered by allowScripts. Continue to step 4. `npx prisma generate` still succeeded after that warning on npm 11.17.0.

### Step 3. Create the root .env

Compose and the shell both read the root `.env` next to `docker-compose.yml`. The API process does not load that file on its own. `apps/api/.env.example` is only a second template.

```sh
cp .env.example .env
```

Walk each variable. Ask the operator for real values. Do not invent one.

* `DATABASE_URL`: leave the template unless their Postgres user or password differs.
* `INGEST_TOKEN`: shared secret for `POST /events`. You may generate one with `openssl rand -hex 24` and show it once. The template placeholder is not a production secret. Replace it before anyone else can reach the port. The bridge reads this same variable and exits if it is blank.
* `SOCKET_TOKEN`: optional for `npm run dev`. Required when `NODE_ENV=production` (the Compose API sets that). If they set one, set `VITE_SOCKET_TOKEN` to the same value before a production web build. A blank value is fine for the dev server verified here.
* `WEB_ORIGIN`: leave commented unless they need another origin. The API default is `http://localhost:5173` and `http://127.0.0.1:5173`.
* `OPERATOR_NAME`: display only, not a secret. Blank means the chip says Operator. For `npm run dev`, set `VITE_OPERATOR_NAME` to the same string if the browser should show the name.
* `GITHUB_TOKEN`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`: optional. Ask only if they want pull request merge or live provider balances.

`.env` is gitignored. Never commit it.

### Step 4. Start the stack

Export the file, generate the client, migrate, seed, and start both apps:

```sh
set -a; . ./.env; set +a
(cd apps/api && npx prisma generate)
(cd apps/api && npx prisma migrate deploy)
npm run seed:demo
npm run dev
```

`npm run dev` runs the API on port 3000 and Vite on port 5173. Leave that process running.

`npm run seed:demo` is idempotent. It refuses `NODE_ENV=production` unless `SEED_DEMO_ALLOW_PROD=1`.

The API log line is `mission-control api listening on 127.0.0.1:3000` when `HOST=127.0.0.1`. That lowercase string is the log text, not the product name.

### Step 5. Verify the dashboard

Ask the operator to open `http://localhost:5173/#/tasks`.

* The task board loads. The sidebar chip says Connected when health and the socket are up.
* `http://127.0.0.1:3000/health` returns `"status":"ok"` and `"database":"connected"`.
* Do not use `http://127.0.0.1:5173`. On this Vite version that address was connection refused. `localhost` worked.

`/#/` redirects to tasks. `/#/health` redirects to `/#/system`. The setup sheet inside the app still mentions an Overview page. Ignore that sentence and use Tasks and System.

If the first health check fails, the app opens `/#/connect`. Fix the API, then reload `/#/tasks`.

### Step 6. Connect OpenClaw

Skip if they have no OpenClaw CLI yet.

```sh
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
```

With no `openclaw` binary, `--dry-run` exits 0 and posts nothing. That was verified. A real sync needs the CLI and a non blank `INGEST_TOKEN`.

Schedule it about every 5 minutes if they want it to stay current. See `bridge/README.md`.

Paste [docs/OPENCLAW_ONBOARDING.md](docs/OPENCLAW_ONBOARDING.md) when the agent itself should POST events. A 401 means the header `x-ingest-token` does not match the API `INGEST_TOKEN`.

Optional starter limits, merged into `~/.openclaw/openclaw.json` and not a replacement of that file: `agents.defaults.subagents.maxChildrenPerAgent` is 3 and `maxConcurrent` is 4, from `bridge/openclaw.starter.json`. The API does not read those keys.

### Step 7. Another machine

Optional. The API and the dev server listen on loopback. From a laptop:

```sh
ssh -L 5173:127.0.0.1:5173 -L 3000:127.0.0.1:3000 ubuntu@<your-server-ip>
```

Keep the SSH session open. `/#/connect` repeats this command per operating system. Note the dev server bind: the browser on the server used `localhost`, not `127.0.0.1`, for port 5173.

### Step 8. Smoke test

Without OpenClaw:

1. On `http://localhost:5173/#/tasks?view=backlog`, use the row action that sends a demo ticket to the board. Refresh `/#/tasks`. The card is still there.
2. After the seed: `/#/calendar` shows the sample jobs, `/#/agents` and `/#/team` show the 12 sample agents, `/#/office` places them by role, `/#/memory` and `/#/docs` have sample notes.

With the bridge:

3. Calendar jobs become the real cron list. `calendar.snapshot` replaces the table.
4. Agents and the office floor follow `agents.snapshot`. `run.*` events show up as activity. A ticket move also writes activity, so a local move is not proof the bridge ran.
5. `/#/system` shows a recent OpenClaw bridge time after any accepted `POST /events`. Sessions stay empty until `sessions.snapshot`. Logs stay empty until `/tmp/openclaw` has a gateway log.

Tell the operator where `.env` lives, that it must not be committed, and that OpenClaw is optional for looking around.
