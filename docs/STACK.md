# Stack

Mission Control is an npm workspace. `packageManager` is `npm@11.17.0`. This repo does not use pnpm. The short table is on the README. This file is the inventory.

| Piece | Path | What it is |
| --- | --- | --- |
| `web` | `apps/web` | React 19, Vite 8, Tailwind CSS v4, React Router hash routes, Socket.IO client |
| `api` | `apps/api` | NestJS 11, Socket.IO, Prisma 7.9, Postgres 16 |
| `bridge` | `bridge` | Optional Python 3 standard library sync from the OpenClaw CLI |
| workspaces | repo root | npm workspaces and Turbo 2 |

Prisma models, 14 counted in `apps/api/prisma/schema.prisma`: `Agent`, `Run`, `Project`, `Ticket`, `Session`, `CronJob`, `UsageBucket`, `ActivityEvent`, `Approval`, `MemoryEntry`, `ModelConfig`, `Setting`, `Device`, `CustomTool`.

The API has 21 controllers (`@Controller` in `apps/api/src`). `team.controller.ts` registers two of them, `mission` and `devices`. The others are sessions, runs, activity, logs, calendar, models, approvals, custom tools, projects, search, usage, events, tickets, docs, health, memory, agents, the root app controller, and system.

Schema changes stay human reviewed. On boot the API runs `prisma migrate deploy`, which applies those reviewed migrations. It does not create new ones. That includes `npm run dev` and `node dist/main.js`.

The web app uses hash routes. A page looks like `http://localhost:5173/#/tasks`. A path with no hash, such as `/tasks`, is not a client route. Overview is not a route. `/` redirects to `/tasks`.

The sidebar order is Tasks, Agents, Approvals, Projects, Office, Pipeline, then Calendar, Memory, Docs, Team, Usage, System.

## Pages

| Route | Screen |
| --- | --- |
| `/#/tasks` | Task board. Home. |
| `/#/tasks?view=backlog` | Backlog list for the same tickets |
| `/#/agents` | Agent cards |
| `/#/approvals` | Pending and decided approvals |
| `/#/projects` | Project list |
| `/#/projects/<id>` | One project and its tickets |
| `/#/office` | Full bleed Office. Live rooms are Build, QA, Ship, Deploy, and Commons |
| `/#/pipeline` | The same tickets as Build, QA, Ship, Deploy |
| `/#/calendar` | Cron jobs for the week |
| `/#/memory` | Memory notes |
| `/#/usage` | Cost so far, by day, bot, and model |
| `/#/docs` | Markdown library from `DOCS_ROOT` |
| `/#/team` | Mission, people, devices |
| `/#/system` | Health, provider and model per agent, versions, spend, links to the panels below |
| `/#/system/logs` | Gateway log tail, or an empty state |
| `/#/system/sessions` | Sessions from `sessions.snapshot` |
| `/#/system/settings` | Connection and log out |
| `/#/system/connection` | How this browser reaches the API |
| `/#/system/tools` | Experimental custom tools |
| `/#/connect` | Setup sheet (no sidebar) |

These paths are redirects, not pages: `/tickets` to `/tasks`, `/backlog` to `/tasks?view=backlog`, `/factory` and `/activity` to `/office`, `/health` to `/system`, `/logs` to `/system/logs`, `/sessions` to `/system/sessions`, `/settings` to `/system/settings`.

## Scripts

There is no separate `typecheck` script. `npm run build` typechecks both apps (`tsc -b` in web, `nest build` in api).

Generate the Prisma client first. npm 11.17.0 does not run the Prisma install scripts, so `npm test` and `npm run build` cannot see `.prisma/client` until you do:

```bash
(cd apps/api && npx prisma generate)
npm test
npm run build
```

`npm run lint` checks the web app with oxlint and the API with eslint. It only reads files. `npm run lint:fix` runs the same checks and applies their automatic fixes. Commit the result only after you review the diff. `npm test` for the API needs Postgres. It uses `TEST_DATABASE_URL` when that is set, and otherwise creates a throwaway database named `mc_test_<random>` so it never migrates the database named by `DATABASE_URL`. If creating a database is not permitted, setup uses a throwaway schema and drops it afterward. Before any write, when both URLs are set, setup connects to each one and compares server identity. If `TEST_DATABASE_URL` reaches the same database as `DATABASE_URL`, including another host name or socket, the run refuses before it writes. If `DATABASE_URL` is unset or cannot be reached, that check is skipped. Web tests do not use Postgres. `npm run test:e2e` uses `DATABASE_URL`. `npm run doctor` prints one line per check. The order is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## What works without OpenClaw

On the Compose path, run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`. Without that install, prisma is not found and the seed command fails. `npm run seed:demo` fills the dashboard with no bridge and no OpenClaw CLI. Nothing seeds that data for you. `npm run seed:clear` removes it again and leaves live rows in place.

* Tasks and the backlog view, from seeded tickets.
* Projects, including ticket counts, from seeded projects.
* Pipeline, the same tickets as Build, QA, Ship, Deploy.
* Memory notes, from seeded rows. Docs do not use the bridge. The seed writes sample markdown under `data/docs`.
* Team mission, from `GET /mission`. People come from the seeded roster and show a Sample tag until a real bot is registered. Devices come from the seed until `devices.snapshot` replaces them. There is no dashboard form that adds a device.
* Custom tools, one seeded tool on `/#/system/tools`.
* Office, Calendar, Approvals, and Usage for Today, the last 7 days, and the month. The seed writes 30 days of tokens. Dollars are computed on read from `config/prices.json`. Office seats each demo bot by agent id.

Sessions and gateway logs stay empty until a real bridge posts them.

## Roster marks

Once any registered or snapshot bot exists, unclaimed defaults hide on Agents, Office, and Team. The rows stay in the database. Turn on Show sample bots on System to bring them back. They show the Sample tag. The switch is saved in this browser and stays on after a reload. Delete every real bot and the defaults show again on their own. A bridge snapshot never removes a registered bot.

A registered bot with no heartbeat for 10 minutes shows Offline. The label uses the existing idle robot, dimmed. The row is not deleted.

## Layout

```
apps/web/                     React dashboard
apps/api/                     NestJS API, Prisma schema, seed script
bridge/                       Optional OpenClaw sync
docs/                         Install, security, API, remote access
docs/screenshots/             README hero GIF and stills
wireframes/                   Static wireframe art, not the running UI
LOG.md                        Change log
ONBOARDING.md                 Human install steps for an agent to walk through
```

The running UI is `apps/web`. `wireframes/` is the drawing set. `design/` is older reference art and is not the screenshot source.
