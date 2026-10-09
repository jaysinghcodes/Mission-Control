# bridge/ — OpenClaw → Mission Control

A minimal, vendored bridge that pushes **real OpenClaw state** into Mission
Control. It replaces the private, per-machine `~/.openclaw/.mc-bridge-sync.py`
the root README used to point at, so a fresh clone ships with the integration.

- **One file:** `mc-bridge-sync.py` — Python 3.8+, **stdlib only** (no pip install).
- **One run = one sync.** Collect once, POST, exit. Schedule it every ~5 min.
- **Optional.** Without OpenClaw, use `npm run seed:demo` for sample data instead.

## Quick start

```bash
# Mission Control running (docker compose up / npm run dev), root .env has INGEST_TOKEN.
python3 bridge/mc-bridge-sync.py --dry-run   # see what would be sent (token never printed)
python3 bridge/mc-bridge-sync.py             # post it
```

Every 5 minutes via system cron (absolute paths; the script finds the repo-root
`.env` relative to itself, so no `cd` is needed):

```cron
*/5 * * * * /usr/bin/python3 /path/to/mission-control/bridge/mc-bridge-sync.py >> /tmp/mc-bridge.log 2>&1
```

…or create an OpenClaw cron job that runs the same command.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `INGEST_TOKEN` | — (**required**) | Must equal the api's `INGEST_TOKEN`. Read from the env, else the **repo-root `.env`** (the same file docker compose reads). |
| `MC_API_URL` | `http://127.0.0.1:3000` | Mission Control api base URL. Loopback by default — change only deliberately. |
| `MC_BRIDGE_APPROVALS_CMD` | unset | Optional command printing pending approvals as JSON (see below). Unset ⇒ approvals untouched. |
| `MC_BRIDGE_STATE_FILE` | `bridge/.state/last-run.json` | Where run-diff state is kept (git-ignored). |

> **Token gotcha:** if `INGEST_TOKEN` is blank in `.env`, compose silently falls
> back to `dev-ingest-token` for the api, but the bridge refuses to guess and
> exits 2. Set the value explicitly in `.env` and both sides agree.

Flags: `--dry-run` (print events as JSON lines, post nothing, write no state),
`--from-dir DIR` (read `DIR/{agents,sessions,cron,approvals}.json` instead of the
CLI — `bridge/examples/` holds illustrative inputs for testing the mapping), and
`--memory-dir DIR` (read an OpenClaw memory tree: one workspace, or one
subdirectory per agent). `bridge/examples/openclaw-memory/` is a sample.

```bash
python3 bridge/mc-bridge-sync.py --dry-run --memory-dir bridge/examples/openclaw-memory
```

## Event contract

Transport: `POST {MC_API_URL}/events`, headers `content-type: application/json`
and `x-ingest-token: <INGEST_TOKEN>`, body `{ "type": <event>, "payload": {…} }`.
The api answers `202 {accepted:true}`. When `INGEST_TOKEN` is set, a missing or wrong `x-ingest-token` is `401` with JSON `{"statusCode":401,"message":"unauthorized"}`. The same header is required on every other write route. `400` means an unknown type or a non object payload. The allowed types are the
`KNOWN_TYPES` union in `apps/api/src/ingest/ingest.controller.ts`; snapshot
handling lives in `apps/api/src/snapshots/snapshots.service.ts`. **Every event is
also persisted to `ActivityEvent` and broadcast on the socket.**

| Type | Payload | Server effect | Bridge source |
| --- | --- | --- | --- |
| `agents.snapshot` | `{ agents: [{ name, role?, color?, status?: "working"\|"idle", parent?: <name>, emoji?, personalityTags?, currentTask?, tasksCompleted?, totalCost?, recentActivity?, channel? }] }` | **Replaces** the Agent table; `parent` is resolved by name | `openclaw agents list --json` (default agent = root; `working` if it has a session updated in the last 10 min) |
| `sessions.snapshot` | `{ sessions: [{ name, agent, model?, ctx?: 0-100, lastActivity?: string, hot?: bool }] }` | **Replaces** the Session table | `openclaw sessions --all-agents --json` |
| `calendar.snapshot` | `{ jobs: [{ name, schedule?, day?: 0=Mon…6=Sun\|null, time?: "HH:MM"\|null, color?, enabled? }] }` | **Replaces** the CronJob table | `openclaw cron list --all --json` (`day=null` ⇒ daily, `time=null` ⇒ all-day strip) |
| `usage.snapshot` | `{ period: "24h"\|"7d"\|"30d"\|"month", totalCost?, tokensIn?, tokensOut?, providers?: [{ name?, model?, cost?, tokensIn?, tokensOut? }] }` | Upserts one row per `period` | 24h rollup of session token/cost counters (fields absent ⇒ 0) |
| `approvals.snapshot` | `{ approvals: [{ kind, tag, desc, status?, meta? }] }` | Drops stale **pending** rows, keeps decided history, inserts new | `MC_BRIDGE_APPROVALS_CMD` (opt-in) |
| `memory.snapshot` | `{ entries: [{ id, title, body, agent, createdAt, kind: "long-term"\|"daily"\|"other", source?, ref? }] }` | Upserts by stable `id`. Deletes only rows with `source=bridge` (and legacy `openclaw`) for agents present in the payload. Demo rows are left alone. A payload with no `entries` array is ignored. An empty `entries` array clears bridge rows only | Each agent's workspace: `MEMORY.md` (long-term, `createdAt` is the file mtime) and `memory/YYYY-MM-DD.md` plus `memory/YYYY-MM-DD-<slug>.md` (daily). The daily calendar day is the filename in America/Chicago. The clock is the file mtime when that mtime falls on the same Chicago date; otherwise a standalone `Time: HH:MM CT` line, otherwise 12:00 CT. `id` is a hash of agent id + relative path. `source` is `bridge` |
| `run.queued` · `run.started` · `run.running` · `run.progress` · `run.completed` · `run.done` · `run.failed` | `{ name, …free-form (agent, job, status, progress, summary) }` | Persisted + broadcast (Live Activity, Office movement, Tickets refetch) | Cron job state changes between bridge runs |

Other accepted types (not sent by this bridge): `health.tick`, `hello`,
`message.sent`, `message.received`, `session.patch`, `command.new`,
`approval.new`, `approval.decided`.

### Safety rules the bridge follows

1. **Never wipe on failure.** Snapshots are replace-semantics server-side, so an
   unavailable source (no `openclaw` on PATH, non-zero exit, unrecognized JSON,
   a memory workspace path that cannot be read, or a `--memory-dir` that
   contains no agent workspaces) is **skipped**, not posted empty. With no
   OpenClaw at all, the bridge posts nothing and exits 0 — demo-seed data
   stays intact. A real workspace that was readable and has zero notes still
   posts `[]`, and the API clears bridge rows only.
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
If a future OpenClaw changes shapes, fix the `map_*` functions — the event
contract above is what Mission Control depends on, not the CLI output.

## Starter OpenClaw defaults

Mission Control ships a small starter for a fresh OpenClaw config. Merge
[`openclaw.starter.json`](openclaw.starter.json) into `~/.openclaw/openclaw.json`
(do not replace the rest of that file — this block only sets sub-agent limits):

| Key | Value | Why |
| --- | --- | --- |
| `agents.defaults.subagents.maxChildrenPerAgent` | **3** | Each agent session may keep at most 3 active children. The dashboard draws agents past the 12 robot designs as a small numbered copy of the parent; 3 keeps that badge a single digit. |
| `agents.defaults.subagents.maxConcurrent` | **4** | At most 4 child runs execute at once for a spawning session (OpenClaw's own default is 8). |

OpenClaw's defaults are 5 children and 8 concurrent. These two are the Mission
Control starter — gentler fan-out for a local dashboard. They are not read by
the api; they belong in the operator's OpenClaw config.
