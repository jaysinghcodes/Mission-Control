# Paste this into OpenClaw

You are the OpenClaw agent. Your operator pasted this file so the Mission Control dashboard comes up. In one message, show the plan: run the installer, report the URL, register, and send a heartbeat. Wait for one yes. Then do those steps. Do not ask the operator to type commands, tokens, or ports. Do not invent secrets. Do not print token values. If a command fails, stop and report the error before any different command.

## Run the installer

From this repository, run `bash install.sh`. If you are not in a checkout, use the curl command in the README section Install and run. That command runs the same script.

The script is Docker first. If Docker is missing, it says so and uses Node.js 22 and Postgres 16. It writes a random ingest token, a dashboard password hash, and a session secret to `.env` and sets that file to mode 600, only when `.env` is missing. The password is printed once. A plain second run leaves `.env` unchanged. It fills a missing password hash or session secret without changing other keys. It resolves ports from the shell, then `.env`, then the defaults, and writes `DATABASE_URL` with that `MC_DB_PORT` on a new file. A later run updates that URL only when a new `MC_DB_PORT` is passed and the URL is still the stock localhost port. A custom URL is left as is. It runs doctor and prints the dashboard URL. Use that URL. Do not choose another one.

When the `openclaw` command is on PATH, the same command installs the bridge schedule. It does not start the OpenClaw gateway. Remove the schedule later with `bash install.sh --uninstall-schedule`. If `openclaw` is not on PATH, the installer skips that step and still finishes. `npm run seed:demo` fills sample data and does not need OpenClaw. `npm run doctor` is the same check the installer runs at the end.

The gateway check is optional. Under Compose the bridge checks 127.0.0.1 and posts `gateway.snapshot` with `x-ingest-token`. System shows Unknown when that report is missing or older than `GATEWAY_STATUS_MAX_AGE_MS` (default 600000). A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host on `OPENCLAW_GATEWAY_PORT` (default 18789). Do not start the gateway unless the operator asked.

The bridge posts each agent provider and model from `~/.openclaw/openclaw.json`. When that file has no model, it runs `openclaw models list`. System shows those rows. With no bridge, the page says "No providers found yet. Run the bridge to detect them."

Usage prices session tokens from `config/prices.json`. Copy a model into `config/prices.local.json` to change that price without a rebuild. A provider `costUsd` wins when OpenClaw reports one. Ollama costs $0.00. A model with no price shows `Price not set`.

## Report the URL

Tell your operator the URL the installer printed. Say that `INGEST_TOKEN` lives in `.env` and that the dashboard password was printed once. Do not print the token or the password hash. If doctor prints a failing line, include that line. A missing OpenClaw command is an info line. When a schedule is installed, a sync older than `MC_BRIDGE_STALE_SECONDS` fails doctor. On Compose the dashboard asks for that password, because the API sees the Docker network and not loopback. nginx passes the client address, so the host and a remote client do not share a login lock. Log out ends every session, so a copied cookie stops working after a restart. Too many wrong passwords ask the operator to wait. `npm run login:reset` clears that lock. Under Compose run `docker compose exec api npm run login:reset`. Loopback stays open. Agent ingest with `x-ingest-token` is not part of that wait.

## Register and heartbeat

Read `INGEST_TOKEN` from `.env`. Send it as the header `x-ingest-token`. Do not print it. Call the API on the port this run already chose. On Docker the installer prints `Waiting for the API health check on port`. On the native path doctor prints `pass ports: Port`. Use `127.0.0.1` and that port. POST `/agents/register` with your own id and name, then POST `/agents/<id>/heartbeat`. The request shapes are in [API.md](API.md#410-register-heartbeat-and-delete). A 401 means the header does not match the token. That line is in [API.md](API.md#41-auth). Do not choose a timezone, crew names, or a provider for the operator. The dashboard asks for a timezone, then the Mission Control crew or their own names, then confirms the detected provider. Skip finishes that open.

## Stop

Tell your operator the dashboard URL, whether the bridge schedule was installed or skipped, and the register and heartbeat status codes. The short guide is [OPENCLAW_ONBOARDING.md](OPENCLAW_ONBOARDING.md). Do not add another schedule.
