# Mission Control — Web (`apps/web`)

React 19 + Vite 8 + Tailwind CSS v4 dashboard for [Mission Control](../../README.md). 15 pages: 14 dashboard routes (Overview, Tasks, Tickets, Backlog, Calendar, Approvals, Team, Office, Activity, Health, Sessions, Usage, Logs, Settings) plus the `/connect` onboarding runbook.

**Hash routes:** the app uses `HashRouter`, so URLs look like `http://localhost:5173/#/tickets`. A plain `/tickets` (no `#`) shows Overview.

Data comes from the [API](../api/README.md) over REST (`useApi`) and Socket.IO (`useLiveActivity`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `http://localhost:5173/#/` |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |

From the repo root: `npm run dev -w apps/web` (or `npm run dev` for api + web via turbo).

## Environment (build-time)

Vite inlines `VITE_*` variables at **build** time. In Docker, compose passes them as web build args (rebuild the image after changing them). For `npm run dev`, set them in the root `.env` (exported) or `apps/web/.env`.

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3000` | API base URL (REST + socket). |
| `VITE_SOCKET_TOKEN` | — | Must match the api's `SOCKET_TOKEN`. Compose defaults both to `dev-socket-token`. |
| `VITE_OPERATOR_NAME` | blank | **Display only, not a secret.** Overview greeting (`Good evening, <name>`) and topbar avatar initial. Blank → neutral `Good evening` + generic avatar. Compose fills it from the root `OPERATOR_NAME`. See `src/config.ts`. |
| `VITE_DISCORD_GUILD_ID` | blank | Optional: your own Discord server id, used only to expand bare channel ids pushed by the bridge into Team-drawer links. Blank → no link. |

## Layout

```
src/App.tsx            HashRouter + routes
src/layout/AppLayout   sidebar + topbar shell
src/pages/             one file per page
src/config.ts          VITE_OPERATOR_NAME helpers
src/data/roster.ts     Team display identities + channel links
src/hooks/             useApi, useLiveActivity
```
