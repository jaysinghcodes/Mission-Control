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

Flags: `--dry-run` (print events as JSON lines, post nothing, write no state) and
`--from-dir DIR` (read `DIR/{agents,sessions,cron,approvals}.json` instead of the
CLI — `bridge/examples/` holds illustrative inputs for testing the mapping).

## Event contract

Transport: `POST {MC_API_URL}/events`, headers `content-type: application/json`
and `x-ingest-token: <INGEST_TOKEN>`, body `{ "type": <event>, "payload": {…} }`.
The api answers `202 {accepted:true}`; `401` = token mismatch (production fails
closed); `400` = unknown type / non-object payload. The allowed types are the
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
| `run.queued` · `run.started` · `run.running` · `run.progress` · `run.completed` · `run.done` · `run.failed` | `{ name, …free-form (agent, job, status, progress, summary) }` | Persisted + broadcast (Live Activity, Office movement, Tickets refetch) | Cron job state changes between bridge runs |

Other accepted types (not sent by this bridge): `health.tick`, `hello`,
`message.sent`, `message.received`, `session.patch`, `command.new`,
`approval.new`, `approval.decided`.

### Safety rules the bridge follows

1. **Never wipe on failure.** Snapshots are replace-semantics server-side, so an
   unavailable source (no `openclaw` on PATH, non-zero exit, unrecognized JSON) is
   **skipped**, not posted empty. With no OpenClaw at all, the bridge posts
   nothing and exits 0 — demo-seed data stays intact. A real instance with zero
   items still posts `[]`.
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
