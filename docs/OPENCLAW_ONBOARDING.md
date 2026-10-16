# Mission Control onboarding for OpenClaw agents

This is the short guide. Paste [PASTE_IN.md](PASTE_IN.md) into OpenClaw. The operator only says yes. That file runs the installer, reports the URL, then registers and sends a heartbeat.

The API reference, including the 401 line, is [API.md](API.md). OpenClaw is optional. `npm run seed:demo` runs without it. `npm run doctor` checks the local setup.

Each heading below is an old anchor. The sentence under it points at the same section in the API reference.

## 1. What Mission Control is

Mission Control is the dashboard. The description is in [API.md](API.md#1-what-mission-control-is).

## 2. Install and run

Run `bash install.sh`. Docker is first. If Docker is missing, the installer says so and uses Node.js 22 and Postgres 16. It writes random tokens to `.env` (mode 600), resolves ports from the shell, then `.env`, then the defaults, and installs a removable bridge schedule. Remove that schedule with `bash install.sh --uninstall-schedule`. Report the URL the installer prints. `npm run doctor` reads the bridge sync age. Details are in [API.md](API.md#2-install-and-run) and the README section Install and run.

### Advanced: Node and Postgres

The native path is in [API.md](API.md#advanced-node-and-postgres) and the README section Advanced: Node and Postgres. `bash install.sh` uses it only when Docker is missing.

## 3. What each screen shows

Screen notes are in [API.md](API.md#3-what-each-screen-shows).

## 4. How you report into Mission Control

Request shapes are in [API.md](API.md#4-how-you-report-into-mission-control).

### 4.1 Auth

A missing or wrong `x-ingest-token` is HTTP 401 with `{"statusCode":401,"message":"unauthorized"}`. The 401 line is in [API.md](API.md#41-auth).

### 4.2 Events: `POST /events`

See [API.md](API.md#42-events-post-events).

### 4.3 The bridge (recommended for snapshots)

See [API.md](API.md#43-the-bridge-recommended-for-snapshots).

### 4.4 Tickets: your units of work

See [API.md](API.md#44-tickets-your-units-of-work).

### 4.5 Projects

See [API.md](API.md#45-projects).

### 4.6 Runs

See [API.md](API.md#46-runs).

### 4.7 Models and spend

The bridge posts `models.snapshot` from `~/.openclaw/openclaw.json`. System lists the provider and model for each agent. See [API.md](API.md#47-models-and-spend).

### 4.8 Memory

See [API.md](API.md#48-memory).

### 4.9 Other read routes

See [API.md](API.md#49-other-read-routes).

### 4.10 Register, heartbeat, and delete

`POST /agents/register`, `POST /agents/:id/heartbeat`, and `DELETE /agents/:id` are in [API.md](API.md#410-register-heartbeat-and-delete).

## 5. Adapting your workflow

See [API.md](API.md#5-adapting-your-workflow).

## 6. Not implemented yet (do not rely on these)

See [API.md](API.md#6-not-implemented-yet-do-not-rely-on-these).

## 7. First read checklist

[PASTE_IN.md](PASTE_IN.md) is the checklist an operator pastes. The older steps remain in [API.md](API.md#7-first-read-checklist).
