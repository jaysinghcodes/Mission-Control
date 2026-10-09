# Mission Control web (`apps/web`)

React 19, Vite 8, and Tailwind CSS v4 dashboard for [Mission Control](../../README.md).

Hash routes look like `http://localhost:5173/#/tasks`. `/` redirects to `/tasks`. A path with no hash is not a client route.

Screens: Tasks (board and backlog), Agents, Approvals, Projects, project detail, Office, Pipeline, Calendar, Memory, Docs, Team, System (logs, sessions, settings, connection, custom tools), and Setup at `/#/connect`.

Data comes from the [API](../api/README.md) over REST (`useApi`) and Socket.IO (`useLiveActivity`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite on port 5173. In the verified run, `localhost` worked and `127.0.0.1` did not. |
| `npm run build` | `tsc -b` then `vite build` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |
| `npm test` | `node --test test/*.mjs` |

From the repo root, `npm run dev` starts this app and the API together.

## Environment

Vite inlines `VITE_*` at build time. For `npm run dev`, export the root `.env` or set the variables in the shell.

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3000` | REST and socket base URL |
| `VITE_SOCKET_TOKEN` | empty | Must match `SOCKET_TOKEN` when the API runs with `NODE_ENV=production` |
| `VITE_OPERATOR_NAME` | blank | Display only. Account chip. Blank stays Operator |
| `VITE_DISCORD_GUILD_ID` | blank | Optional. Turns a bare channel id into a link. Blank means no link |

## Layout

```
src/App.tsx            HashRouter and routes
src/layout/AppLayout   sidebar shell and health redirect
src/pages/             one file per screen
src/config.ts          VITE_OPERATOR_NAME
src/hooks/             useApi, useLiveActivity
```
