# OpenClaw agent instructions

Paste this file to an OpenClaw agent that should report into Mission Control. It describes only the requests the API code accepts today. Replace the placeholders before sending anything.

## What Mission Control is

Mission Control is a dashboard for one OpenClaw setup. It shows the agent roster, the task board, approvals, projects, an office floor, a pipeline, a calendar of cron jobs, memory notes, docs, the team page, and system health.

The web app reads the API. It does not read OpenClaw files on disk. You report by HTTP.

There is no separate register endpoint. A roster update is an `agents.snapshot` event. A cron calendar update is a `calendar.snapshot` event. Work moving on the floor is a `run.*` event plus the `currentTask` and `status` fields on the roster.

## Base URL

Use this placeholder until the operator gives you the real origin:

```text
<MISSION_CONTROL_URL>
```

On a loopback install the API listens at `http://127.0.0.1:3000`. Check it with:

```bash
curl -sS http://127.0.0.1:3000/health
```

A healthy process returns JSON with `"status":"ok"` and `"database":"connected"`.

Do not call the web port (`5173`) for these requests. The web app is the dashboard. The API is port 3000 unless `PORT` or `MC_API_PORT` says otherwise.

## Auth

Every report goes to:

```text
POST <MISSION_CONTROL_URL>/events
```

Headers:

```text
content-type: application/json
x-ingest-token: <INGEST_TOKEN>
```

`<INGEST_TOKEN>` is the `INGEST_TOKEN` value in the Mission Control root `.env`. It must match exactly. The bridge reads that same variable. Do not invent a token. Do not print the token back to the operator.

Body shape, from `apps/api/src/ingest/ingest.controller.ts`:

```json
{ "type": "<event type>", "payload": { } }
```

`payload` must be a JSON object. An array is rejected.

What the running API returned when this was checked:

| Request | Result |
| --- | --- |
| Known type, header missing or wrong | `401` `{"message":"unauthorized"}` |
| Header matches, `type` is not in the list below | `400` with the allowed type list |
| Header matches, `payload` is not an object | `400` `{"message":"payload must be a JSON object"}` |
| Header matches, known type | `202` `{"accepted":true,"type":"health.tick","ts":<number>}` |

When `NODE_ENV=production` (Docker Compose sets this), a missing `INGEST_TOKEN` on the server rejects every call. When `INGEST_TOKEN` is unset and `NODE_ENV` is not production, the API allows a call with no header. Still send the header.

`POST /tickets` and `POST /runs` do not read `x-ingest-token`. They are open on the loopback API. Prefer `POST /events` for reporting. Use the ticket and run routes only when the operator asked you to create a board card or a run row.

## Register agents and report status

`agents.snapshot` replaces the whole Agent table. Send the full roster every time. A payload with one agent deletes everyone else. Parent links are names, not ids. The server creates rows first, then wires `parent`.

Fields the server stores (`applyAgents` in `apps/api/src/snapshots/snapshots.service.ts`):

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Missing name is stored as `unknown` |
| `role` | no | Desk placement uses this text. See Office below |
| `color` | no | Defaults to `#58A6FF` |
| `status` | no | Defaults to `idle`. The floor treats `working` as on the clock |
| `parent` | no | Another agent's `name`. Omitted or unknown means no parent |
| `emoji` | no | |
| `personalityTags` | no | Array of strings. Anything else is ignored |
| `currentTask` | no | Short line under that agent on the office floor |
| `tasksCompleted` | no | Number |
| `totalCost` | no | Number |
| `recentActivity` | no | String |
| `channel` | no | Chat channel id or full URL |

Example taken from the profile fields the ingest tests persist:

```bash
curl -sS -X POST "<MISSION_CONTROL_URL>/events" \
  -H "content-type: application/json" \
  -H "x-ingest-token: <INGEST_TOKEN>" \
  -d '{
    "type": "agents.snapshot",
    "payload": {
      "agents": [
        {
          "name": "Nova",
          "color": "#4DD0E1",
          "role": "development",
          "status": "working",
          "emoji": "🔧",
          "personalityTags": ["builder", "daily"],
          "currentTask": "MC-200 agent data model",
          "tasksCompleted": 42,
          "totalCost": 12.4,
          "recentActivity": "merged PR #11",
          "channel": "#development"
        }
      ]
    }
  }'
```

That single agent example is the test payload. On a real roster, include every agent in the same `agents` array. Add `"parent": "Nova"` on a child, using the parent name.

Status for the UI is `status` plus `currentTask` on this snapshot. There is no `POST /agents`.

## Heartbeats

Two different clocks exist. Do not confuse them.

1. The dashboard probes `GET /health` every 5 seconds. That is the sidebar "Connected" line. You do not send it.
2. The API broadcasts a socket event `health.tick` about every 30 seconds (`HEALTH_TICK_MS`, default `30000`, `0` turns it off). That broadcast is not an HTTP call from you.
3. You may POST `health.tick` if you want a row in the activity log. The System page treats the newest activity row whose source is `openclaw` as the bridge heartbeat. Any accepted `POST /events` writes that source. The bridge chip goes stale after 15 minutes with no such row.

Verified heartbeat request:

```bash
curl -sS -X POST "<MISSION_CONTROL_URL>/events" \
  -H "content-type: application/json" \
  -H "x-ingest-token: <INGEST_TOKEN>" \
  -d '{"type":"health.tick","payload":{"uptimeSeconds":1,"connectedClients":0}}'
```

The ticker itself sends this payload shape (`apps/api/src/health/health.ticker.ts`):

```json
{ "uptimeSeconds": 1, "connectedClients": 0 }
```

`hello` is also an accepted event type. The socket emits `hello` when a dashboard connects. Posting `hello` only appends an activity row. It does not register an agent.

## Tasks

The Tasks screen is the ticket board (`GET /tickets`), not the Run table. Columns are `backlog`, `todo`, `build`, `qa`, `review`, and `done`. The API also accepts the legacy status `inprogress` as an alias of `build`.

`POST /events` does not create a ticket. A `run.*` event is stored as activity and broadcast. It does not insert a Ticket row and it does not insert a Run row.

### Board card

`POST <MISSION_CONTROL_URL>/tickets`

Create statuses are only `backlog` and `todo`. Omit `status` and the server uses `backlog`. Any other status on create is `400`. The server assigns the next `MC-<number>` key, starting at `MC-150` on an empty board.

```bash
curl -sS -X POST "<MISSION_CONTROL_URL>/tickets" \
  -H "content-type: application/json" \
  -d '{
    "title": "Draft onboarding checklist",
    "status": "todo",
    "priority": "med",
    "assignee": "Atlas",
    "tags": ["docs"]
  }'
```

A missing or blank title returns `400` `{"message":"title is required"}`. A successful create returns `201` and `{ "ticket": { "id", "key", "title", "status", ... }, "ts" }`.

Move a card with `PATCH <MISSION_CONTROL_URL>/tickets/<id>` and a body the controller accepts: `status` (one of the statuses above), `assignee`, `priority`, `tags`, or `projectId`. Send only the fields that change.

### Run row

`POST <MISSION_CONTROL_URL>/runs` creates a Run in status `queued` and broadcasts `run.queued`.

```bash
curl -sS -X POST "<MISSION_CONTROL_URL>/runs" \
  -H "content-type: application/json" \
  -d '{"name":"Morning Brief","agent":"Speedy"}'
```

`name` is required. `agent` defaults to `OPERATOR_NAME`, or `Operator` when that is blank. The response is `{ "run": { "id", "name", "agent", "status": "queued", "progress": 0, ... }, "ts" }`.

`PATCH <MISSION_CONTROL_URL>/runs/<id>` accepts `{ "status", "progress", "agent" }`. Status `running` broadcasts `run.started`. Status `done` broadcasts `run.completed`. Status `failed` broadcasts `run.failed`. Any other status broadcasts `run.queued`.

### Reporting work without creating a row

The bridge reports cron progress as activity only. From `cron_run_events` in `bridge/mc-bridge-sync.py`:

```json
{ "type": "run.running", "payload": { "name": "Morning Brief", "job": "job-id", "agent": "forge" } }
```

```json
{ "type": "run.completed", "payload": { "name": "Morning Brief", "job": "job-id", "status": "ok", "agent": "forge" } }
```

```json
{ "type": "run.failed", "payload": { "name": "Morning Brief", "job": "job-id", "status": "error", "agent": "forge" } }
```

The ingest test uses a smaller payload that is also accepted:

```json
{ "type": "run.started", "payload": { "name": "Morning Brief" } }
```

Also accepted as activity only: `run.queued`, `run.progress`, `run.done`. `run.running` is the alias of a job that has started. `run.done` is the alias of a job that finished. Prefer those names if you are matching the bridge. `run.started` and `run.completed` remain accepted.

## Calendar

`calendar.snapshot` replaces the whole CronJob table. Send every job. An empty `jobs` array clears the calendar.

Fields from `applyCalendar`:

| Field | Notes |
| --- | --- |
| `name` | Defaults to `job` |
| `schedule` | Display string, often a 5 field cron expression |
| `day` | `0` Monday through `6` Sunday. `null` means every day |
| `time` | `"HH:MM"` in 24 hour form. `null` places the job on the all day strip |
| `color` | Optional |
| `enabled` | Omitted or true stays enabled. `false` disables it |

```bash
curl -sS -X POST "<MISSION_CONTROL_URL>/events" \
  -H "content-type: application/json" \
  -H "x-ingest-token: <INGEST_TOKEN>" \
  -d '{
    "type": "calendar.snapshot",
    "payload": {
      "jobs": [
        {
          "name": "Morning Brief",
          "schedule": "0 7 * * *",
          "day": null,
          "time": "07:00",
          "enabled": true
        },
        {
          "name": "Weekly Review",
          "schedule": "30 16 * * 5",
          "day": 4,
          "time": "16:30",
          "enabled": true
        }
      ]
    }
  }'
```

`day: 4` is Friday because the grid starts on Monday. There is no separate calendar event type. Cron jobs are this snapshot.

## Office

There is no office endpoint and no office event type. The Office page reads:

* agents from `GET /agents` (your `agents.snapshot`)
* tickets from `GET /tickets`
* pending approvals from `GET /approvals`
* recent activity from `GET /activity` (your `run.*` events)

Desk from `role` text (`apps/web/src/lib/office.ts`):

| Role text contains | Room |
| --- | --- |
| chief, research, support, scout, trend | Commons |
| qa, quality, security, alert | QA |
| writer, summary, scribe, product | Ship |
| ops, data, deploy | Deploy |
| engineer, developer, development, dev, design | Build |

Anything else sits in Build when `status` is `working`, and in Commons otherwise. `currentTask` is the line on the desk. `status: "working"` keeps the agent on the clock. `status: "idle"` is treated as a break in the Break filter.

To move someone on the floor, POST a new `agents.snapshot` with the updated `status`, `role`, and `currentTask`. To add a line to the activity strip, POST a `run.*` event. Neither call has its own office route.

## Sessions, usage, approvals, and memory

These are the other snapshots the ingest controller routes to a table. Each body is `{ "type", "payload" }` with the same auth header.

### sessions.snapshot

Replaces the Session table. Empty `sessions` clears it. The System sessions panel reads this table. Demo seed does not fill it.

```json
{
  "type": "sessions.snapshot",
  "payload": {
    "sessions": [
      {
        "name": "main",
        "agent": "Nova",
        "model": "openai/gpt-5",
        "ctx": 40,
        "lastActivity": "2m ago",
        "hot": true
      }
    ]
  }
}
```

`ctx` is a 0 to 100 context fill. `hot` is boolean.

### usage.snapshot

Upserts one row per `period`. Accepted period strings in the bridge are `24h`, `7d`, and `month`. The service also stores whatever `period` string you send (it defaults to `24h`). The System page reads `24h`, `7d`, and `month`.

```json
{
  "type": "usage.snapshot",
  "payload": {
    "period": "24h",
    "totalCost": 1.25,
    "tokensIn": 1000,
    "tokensOut": 400,
    "providers": [
      {
        "name": "openai",
        "model": "openai/gpt-5",
        "cost": 1.25,
        "tokensIn": 1000,
        "tokensOut": 400
      }
    ]
  }
}
```

That provider object is the shape `usage_from_sessions` in `bridge/mc-bridge-sync.py` builds.

### approvals.snapshot

Replaces pending approval rows. Decided rows stay. A new row is skipped when its `tag` already has a decided row.

```json
{
  "type": "approvals.snapshot",
  "payload": {
    "approvals": [
      {
        "kind": "exec",
        "tag": "DEMO-4",
        "desc": "Aegis wants to run the preview deploy script for DEMO-4.",
        "status": "pending"
      }
    ]
  }
}
```

`kind` defaults to `exec`. `tag` defaults to `Request`. `desc` defaults to an empty string. `status` defaults to `pending`. Optional `meta` is stored as JSON. For a GitHub pull request approval the UI expects `meta.repo`, `meta.number`, and `meta.branch`. Approving that kind calls GitHub only when `GITHUB_TOKEN` is set.

`approval.new` and `approval.decided` are accepted event types. They are activity plus a socket broadcast. They do not insert or update the Approvals list. Use `approvals.snapshot` for the list.

### memory.snapshot

Upserts notes. From `normalizeMemory` in `snapshots.service.ts`, each entry needs a string `id`, a non empty `title`, a non empty `body`, and a `createdAt` that parses as a date. `kind` is `long-term`, `daily`, or `other` (anything else is stored as `other`). `agent` defaults to `agent`. `ref` is optional.

Ids starting with `mem-` or `bridge-` are kept. Any other id is stored as `bridge-<id>`. Ids starting with `demo-` are dropped so a live post cannot overwrite seed rows. The server forces `source` to `bridge`.

A payload with no `entries` array is ignored. An `entries` array that stores nothing is also ignored. It does not delete existing notes.

```json
{
  "type": "memory.snapshot",
  "payload": {
    "entries": [
      {
        "id": "mem-1",
        "title": "Title mem-1",
        "body": "first",
        "agent": "Forge",
        "createdAt": "2026-10-05T15:00:00.000Z",
        "kind": "daily",
        "ref": "memory/2026-10-05.md"
      }
    ]
  }
}
```

That entry is the shape in `apps/api/src/snapshots/memory-snapshot.spec.ts`. The bridge builds the same fields from `MEMORY.md` and from `memory/YYYY-MM-DD.md` files. You can POST the snapshot yourself if you already have the note text. Do not expect the API to read your workspace disk.

## Accepted event types

This is the full list from `KNOWN_TYPES` in `apps/api/src/ingest/ingest.controller.ts`.

| Type | What the server does with it |
| --- | --- |
| `agents.snapshot` | Replaces the roster |
| `sessions.snapshot` | Replaces sessions |
| `calendar.snapshot` | Replaces cron jobs |
| `usage.snapshot` | Upserts one usage period |
| `approvals.snapshot` | Syncs pending approvals, keeps decided history |
| `memory.snapshot` | Upserts bridge memory rows |
| `run.queued` `run.started` `run.running` `run.progress` `run.completed` `run.done` `run.failed` | Activity row and socket broadcast only |
| `health.tick` `hello` | Activity row and socket broadcast only |
| `message.sent` `message.received` `session.patch` `command.new` | Activity row and socket broadcast only |
| `approval.new` `approval.decided` | Activity row and socket broadcast only |

Every accepted event is stored as an `ActivityEvent` with `source` `openclaw` and then broadcast on Socket.IO.

## Rules

* Send the token only in `x-ingest-token`. Never put it in the JSON body, a log line, or a chat reply.
* Snapshot routes replace or sync whole tables. Send complete lists.
* Do not claim a feature that is not in the tables above. Docs files are not posted here. The docs library is a folder on the Mission Control host (`DOCS_ROOT`), written by `npm run seed:demo` or by a person. Gateway logs are files under `/tmp/openclaw`, read by `GET /logs`. You do not upload those through `/events`.
* The vendored sync script is `python3 bridge/mc-bridge-sync.py`. It posts these same events. `--dry-run` prints them and posts nothing. With no `openclaw` binary it prints that it is skipping and exits 0, leaving dashboard data in place.
* Loopback is the default. From another machine, the operator opens an SSH tunnel to ports 5173 and 3000. Do not bind the API to a public interface on their behalf.
