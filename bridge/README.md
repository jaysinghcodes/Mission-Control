# bridge/: OpenClaw to Mission Control

A minimal, vendored bridge that pushes **real OpenClaw state** into Mission
Control. It replaces the private, per-machine `~/.openclaw/.mc-bridge-sync.py`
the root README used to point at, so a fresh clone ships with the integration.

- **One file:** `mc-bridge-sync.py`. Python 3.8+, **stdlib only** (no pip install).
- **One run = one sync.** Collect once, POST, exit. The default interval is 300 seconds.
- **Optional.** Without OpenClaw, use `npm run seed:demo` for sample data instead.

## Quick start

`bash install.sh` installs the schedule when the `openclaw` command is on PATH.
Linux uses a systemd user timer, or cron when that user timer is not available.
macOS uses launchd. The installer names the scheduler it used. The interval is
`MC_BRIDGE_INTERVAL_SECONDS` (default 300). The job sets `MC_BRIDGE_REGISTER`
(default 1). Its PATH includes the `openclaw` directory, the `python3` directory,
and the PATH from install time. Cron rounds an interval up to whole minutes.
Remove the schedule with:

```bash
bash install.sh --uninstall-schedule
```

That flag removes only this schedule and the sync timestamp. Other cron lines and other service units stay.
If `openclaw` is not on PATH, the installer prints a skip line and continues.
A second install replaces the same unit or cron block. It does not add another one.

A manual run is the same script the schedule starts. The script finds the repo root
`.env` relative to itself:

```bash
python3 bridge/mc-bridge-sync.py --dry-run
python3 bridge/mc-bridge-sync.py
```

A successful run writes a unix timestamp to `MC_BRIDGE_STAMP_FILE` (default
`bridge/.state/last-sync`). A run where every OpenClaw source is unavailable
does not write that file. `npm run doctor` fails when a schedule is installed
and that file is older than `MC_BRIDGE_STALE_SECONDS` (default 600). A missing
file is an info line. A stale file is an info line when no schedule is installed.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `INGEST_TOKEN` | required | Must equal the api's `INGEST_TOKEN`. Read from the env, else the **repo-root `.env`** (the same file docker compose reads). |
| `MC_API_URL` | `http://127.0.0.1:3000` | Mission Control api base URL. Loopback by default. Change only deliberately. When this is unset the bridge uses `MC_API_PORT` if that is set, then `PORT`, then port 3000. The installer resolves the shell, then `.env`, then the API port, and sets `MC_API_URL` on the schedule. |
| `MC_BRIDGE_REGISTER` | `1` on the installed schedule | Also `POST /agents/register` for each mapped agent when this is `1`, `true`, or `yes`. `0` posts snapshots only. |
| `MC_BRIDGE_INTERVAL_SECONDS` | `300` | Schedule interval in seconds. Cron rounds up to whole minutes. |
| `MC_BRIDGE_STALE_SECONDS` | `600` | Doctor fails when a schedule is installed and the last successful sync is older than this. With no schedule, that age is an info line. |
| `MC_BRIDGE_STAMP_FILE` | `bridge/.state/last-sync` | Unix timestamp written after a successful sync. |
| `MC_BRIDGE_APPROVALS_CMD` | unset | Optional command printing pending approvals as JSON (see below). Unset means approvals stay untouched. |
| `MC_BRIDGE_STATE_FILE` | `bridge/.state/last-run.json` | Where run-diff state is kept (git-ignored). |

> **Token gotcha:** if `INGEST_TOKEN` is blank in `.env`, compose leaves it
> blank. In production the api then returns 401 on ingest, and the bridge
> refuses to guess and exits 2. Set the value explicitly in `.env` and both
> sides agree.

Flags: `--dry-run` (print events as JSON lines, post nothing, write no state),
`--from-dir DIR` (read `DIR/{agents,sessions,cron,approvals,devices,nodes}.json` instead of the
CLI. `bridge/examples/` holds illustrative inputs for testing the mapping. `bridge/examples/fresh-install/` is the fixture the installer CI posts to a running API), and
`--memory-dir DIR` (read an OpenClaw memory tree: one workspace, or one
subdirectory per agent). `bridge/examples/openclaw-memory/` is a sample.

```bash
python3 bridge/mc-bridge-sync.py --dry-run --memory-dir bridge/examples/openclaw-memory
```

## Event contract

Transport: `POST {MC_API_URL}/events`, headers `content-type: application/json`
and `x-ingest-token: <INGEST_TOKEN>`, body `{ "type": <event>, "payload": {…} }`.
The api answers `202 {accepted:true}`. When `INGEST_TOKEN` is set, a missing or wrong `x-ingest-token` is `401` with JSON `{"statusCode":401,"message":"unauthorized"}`. That header is for ingest, not for dashboard routes. `400` means an unknown type or a non object payload. The allowed types are the
`KNOWN_TYPES` union in `apps/api/src/ingest/ingest.controller.ts`; snapshot
handling lives in `apps/api/src/snapshots/snapshots.service.ts`. **Every event is
also persisted to `ActivityEvent` and broadcast on the socket.**

| Type | Payload | Server effect | Bridge source |
| --- | --- | --- | --- |
| `agents.snapshot` | `{ agents: [{ id?, name, role?, color?, status?: "working"\|"idle", parent?: <name>, emoji?, personalityTags?, currentTask?, tasksCompleted?, totalCost?, recentActivity?, channel? }] }` | Merges by id. An entry with no id uses the slug of its name. Creates, updates, or removes snapshot rows only. A default or registered id changes status fields only, not parent. `parent` on a snapshot row is resolved by name | `openclaw agents list --json` (default agent = root; `working` if it has a session updated in the last 10 min). Set `MC_BRIDGE_REGISTER=1` to also `POST /agents/register` for each mapped agent. OpenClaw stays optional either way |
| `sessions.snapshot` | `{ sessions: [{ name, agent, model?, ctx?: 0-100, lastActivity?: string, hot?: bool }] }` | **Replaces** the Session table | `openclaw sessions --all-agents --json` |
| `calendar.snapshot` | `{ jobs: [{ name, schedule?, day?: 0=Mon…6=Sun\|null, time?: "HH:MM"\|null, color?, enabled? }] }` | **Replaces** the CronJob table | `openclaw cron list --all --json` (`day=null` means daily, `time=null` means the all day strip) |
| `usage.snapshot` | `{ points: [{ at: ISO timestamp, totalCost?, tokensIn?, tokensOut?, providers?: [{ bot?, provider?, model?, tokensIn?, tokensOut?, costUsd?, local? }] }] }` | Upserts one row per calendar day of `at` in the timezone saved in Settings (the server timezone when none is saved). The window is `USAGE_RETENTION_DAYS` through today (default 30). A future timestamp is dropped. Other days stay. A payload with no timestamp is ignored. `costUsd` is omitted when the session did not report a cost. | Daily points from session token counters. The bridge reads that timezone from `GET /settings`, then `MC_TIMEZONE`, then `TZ`, then the host zone named by the `/etc/localtime` symlink. Names come from `config/timezones.json`, and a legacy name is converted to the current one. First connect backfills up to `USAGE_RETENTION_DAYS` when sessions have timestamps. Later runs add the increase for that sync day. No separate 7 day or month total. The bridge names each usage line `provider/model` from the OpenClaw `modelProvider` and `model`. A bare model gets its provider in front, so `deepseek` with `deepseek-v4-flash` is `deepseek/deepseek-v4-flash`. A run through OpenRouter keeps `openrouter` in front, so it is charged the OpenRouter row and not the direct provider rate. A name that already starts with its provider is kept as is. The API prices tokens from `config/prices.json`. A reported `costUsd` wins. Ollama and a provider marked local are $0.00. A model with no price adds `Price not set for some models` next to the known total on System and Usage. |
| `approvals.snapshot` | `{ approvals: [{ kind, tag, desc, status?, meta? }] }` | Drops stale **pending** rows, keeps decided history, inserts new | `MC_BRIDGE_APPROVALS_CMD` (opt-in) |
| `memory.snapshot` | `{ entries: [{ id, title, body, agent, createdAt, kind: "long-term"\|"daily"\|"other", source?, ref? }] }` | Upserts by stable `id`. Deletes only rows with `source=bridge` (and legacy `openclaw`) for agents present in the payload. Demo rows are left alone. A payload with no `entries` array is ignored. An empty `entries` array clears bridge rows only | Each agent's workspace: `MEMORY.md` (long-term, `createdAt` is the file mtime) and `memory/YYYY-MM-DD.md` plus `memory/YYYY-MM-DD-<slug>.md` (daily). The daily calendar day is the filename in the timezone from `GET /settings`, then `MC_TIMEZONE`, then `TZ`, then the host zone named by the `/etc/localtime` symlink. The clock is the file mtime when that mtime falls on the filename date; otherwise a standalone `Time: HH:MM` line, otherwise 12:00 in that timezone. `id` is a hash of agent id + relative path. `source` is `bridge` |
| `models.snapshot` | `{ agents: [{ id, name, provider, model, local? }], models?: [{ provider, model, local? }], openclawVersion? }` | Replaces every model row. Stores `openclawVersion` on the settings row when the string is non empty. `local` true marks a provider whose usage is $0.00. A payload with neither array is ignored | `~/.openclaw/openclaw.json`, or `OPENCLAW_CONFIG_PATH`. Fallback is `openclaw models list` when that file has no agent model. Ollama is always local. A provider with `local: true` or `api: ollama` is local too. `--from-dir` reads `<dir>/openclaw.json` and does not shell out |
| `devices.snapshot` | `{ devices?: [{ id, name, type, online, lastSeenAt?, pairedAt?, requestedAt? }], nodes?: [{ id, name, type, online, lastSeenAt?, pairedAt?, requestedAt? }] }` | Replaces bridge rows for each array that is present and removes sample devices. A node with the same id replaces that device row. A payload with neither array is ignored. An empty array clears that kind only. `online` is a live connection. `pairedAt` is the pairing time. `requestedAt` is a pending request. A paired device with no connection and no last seen time is not online | `openclaw devices list --json` and `openclaw nodes list --json`. When paired nodes omit `connected`, the bridge also reads `openclaw nodes status --json`. `--from-dir` reads `<dir>/devices.json` and `<dir>/nodes.json` and does not shell out |
| `gateway.snapshot` | `{ up, host, port, checkedAt, latencyMs, version? }` | Stored. Under Compose, `GET /system` uses the newest row. `up` must be a boolean and `checkedAt` a number | TCP connect to `127.0.0.1` on `OPENCLAW_GATEWAY_PORT` (default 18789). Posted on every run, including when no OpenClaw source was readable. A version is `openclaw --version` when that prints a line. This event does not refresh the sync stamp by itself |
| `run.queued` · `run.started` · `run.running` · `run.progress` · `run.completed` · `run.done` · `run.failed` | `{ name, …free-form (agent, job, status, progress, summary, ticketId?) }` | Persisted + broadcast (Live Activity, Office movement, Tickets refetch). When the cron job carries a string `ticketId` (or `meta.ticketId`), the bridge also calls `POST /runs` and `PATCH /runs/:id` with that id. Create success is 201. Update success is 200. A 404 for an unknown ticketId is retried once without ticketId, a warning is logged, and the run is still recorded so the job is not left running. Name is clipped to 200 characters and agent to 100 before POST, counting Unicode code points. One failed run does not block saving state for the runs that succeeded. Any other 400 or 404 is logged without the token and that job is retried next sync | Cron job state changes between bridge runs |

Other accepted types (not sent by this bridge): `health.tick`, `hello`,
`message.sent`, `message.received`, `session.patch`, `command.new`,
`approval.new`, `approval.decided`.

### Safety rules the bridge follows

1. **Never wipe on failure.** Most snapshots are replace-semantics server-side.
   `usage.snapshot` is not: it upserts the days in the payload and leaves
   every other day in place. An unavailable source (no `openclaw` on PATH,
   non-zero exit, unrecognized JSON, a memory workspace path that cannot be
   read, or a `--memory-dir` that contains no agent workspaces) is
   **skipped**, not posted empty. With no OpenClaw at all, the bridge posts
   nothing and exits 0. Demo seed data stays intact. A real workspace that
   was readable and has zero notes still posts `[]`, and the API clears
   bridge rows only.
   Memory files follow [OpenClaw's layout](https://docs.openclaw.ai/concepts/memory):
   `MEMORY.md` at the agent workspace root, daily notes in `memory/YYYY-MM-DD.md`
   (and slugged `memory/YYYY-MM-DD-<name>.md`). `openclaw agents list --json`
   supplies each `workspace`. The web app does not read those files.
2. **run.\* only on change.** The first run records each job's state; later runs
   emit `run.running` when a job starts and `run.completed` / `run.failed` when
   `lastRunAtMs` advances. State is saved only after every post succeeded.
3. **Secrets.** The token is sent only as the header and is never logged or
   written to disk. Diagnostics go to stderr.
4. **Approvals are opt-in.** OpenClaw has no stable "pending approvals" list
   command yet; set `MC_BRIDGE_APPROVALS_CMD` to any command that prints a JSON
   array (or `{approvals: […]}`) of `{kind, tag, desc, meta?}`.

### OpenClaw CLI shapes

`--json` envelopes differ per command (bare array vs `{sessions:[…]}` vs
`{jobs:[…]}`; see openclaw/openclaw#77943). The bridge accepts all of them, and
reads field names defensively (`identityName`/`name`/`id`, `key`/`id`, cron
`schedule` as `{kind:"cron",expr}` / `{kind:"every",everyMs}` / a plain string).
If a future OpenClaw changes shapes, fix the `map_*` functions. The event
contract above is what Mission Control depends on, not the CLI output.

## Starter OpenClaw defaults

Mission Control ships a small starter for a fresh OpenClaw config. Merge
[`openclaw.starter.json`](openclaw.starter.json) into `~/.openclaw/openclaw.json`
(do not replace the rest of that file. This block only sets sub-agent limits):

| Key | Value | Why |
| --- | --- | --- |
| `agents.defaults.subagents.maxChildrenPerAgent` | **3** | Each agent session may keep at most 3 active children. The dashboard draws agents past the 12 robot designs as a small numbered copy of the parent; 3 keeps that badge a single digit. |
| `agents.defaults.subagents.maxConcurrent` | **4** | At most 4 child runs execute at once for a spawning session (OpenClaw's own default is 8). |

OpenClaw's defaults are 5 children and 8 concurrent. These two are the Mission
Control starter. Gentler fan-out for a local dashboard. They are not read by
the api; they belong in the operator's OpenClaw config. `bash install.sh` offers
this merge and does not edit `~/.openclaw/openclaw.json`.
