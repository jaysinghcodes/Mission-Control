# Remote access

## Pick your setup

Two setups work. Pick the one that fits you. Default ports are 3000 for the API (`MC_API_PORT`), 5173 for the web app (`MC_WEB_PORT`), and 3011 for the tunnel (`MC_REMOTE_PORT`). Set any of them in `.env` to change it, and use your values in the commands below.

| Setup | Mission Control runs on | OpenClaw and the bridge run on | You open it from |
| --- | --- | --- | --- |
| A | the VPS | the VPS | a laptop or phone, through a tunnel |
| B | the laptop | the VPS | the laptop browser |

### A. OpenClaw and Mission Control on the VPS

Everything is on one host. The bridge posts to the API on loopback.

1. On the VPS, install OpenClaw first so the `openclaw` command is on PATH.
2. On the VPS, install Mission Control. Save the password it prints.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash
   ```

3. The installer sees `openclaw`, installs the bridge schedule, and runs the bridge once. The schedule then posts every 300 seconds (`MC_BRIDGE_INTERVAL_SECONDS`) to `http://127.0.0.1` on `MC_API_PORT`. To run it now, use this in the checkout:

   ```bash
   python3 bridge/mc-bridge-sync.py
   ```

4. From the laptop, open an SSH tunnel to the web port and keep it open:

   ```bash
   ssh -L 5173:127.0.0.1:5173 ubuntu@your-vps
   ```

5. On the laptop, open `http://127.0.0.1:5173/#/tasks` and sign in. Agents shows your OpenClaw agents.
6. From a phone, use Tailscale Serve or a Cloudflare quick tunnel on the VPS, as [From a phone](#from-a-phone) says.

The [SSH tunnel](#ssh-tunnel), [Tailscale Serve](#tailscale-serve), and [Cloudflare Tunnel](#cloudflare-tunnel) sections below have the details.

### B. Mission Control on the laptop, OpenClaw on the VPS

The laptop is the dashboard. The bridge has to run where OpenClaw runs, so it runs on the VPS and posts to the laptop API over Tailscale. The laptop must stay awake and online for new data to arrive.

Setup B needs the Docker install on the laptop. The installer picks Docker when `docker compose` works, and the native path only when it does not.

1. On the laptop, install Docker Desktop and start it, so `docker compose version` works. Then install Mission Control with the same command as A step 2, and check the install mode in the checkout:

   ```bash
   grep '^MC_INSTALL_MODE=' .env
   ```

   It must print `MC_INSTALL_MODE=compose`. If it prints `native`, stop here and do not serve the API on the tailnet. Open `http://localhost:5173/#/tasks` and sign in.
2. Install Tailscale on both the laptop and the VPS, and sign in to the same tailnet on both. Turn on MagicDNS so the laptop has a name such as `your-mac.tailnet.ts.net`.
3. On the laptop, serve the API port on the tailnet and leave it running:

   ```bash
   tailscale serve --bg --http 3000 http://127.0.0.1:3000
   ```

   3000 is the default laptop `MC_API_PORT`, the Compose host port for the API. If you set another `MC_API_PORT` in `.env`, use that value in place of both 3000s here and in the bridge URL in step 5.

   The bridge URL is then `http://your-mac.tailnet.ts.net:3000`. Use the MagicDNS name. The raw 100.x address of the laptop returns 404 here.

   Run this step only on a Compose install. Serve reaches the API from `127.0.0.1`. Compose still sees that call off loopback, so login holds. A native install would treat it as loopback, and anyone on the tailnet would get the dashboard with no login.

4. On the laptop, read the ingest token from `.env` in the checkout. Keep it private. It stays in the laptop `.env`.

   ```bash
   grep '^INGEST_TOKEN=' .env
   ```

5. On the VPS, in a Mission Control checkout, run the bridge once with the laptop URL and token set for that run only:

   ```bash
   INGEST_TOKEN=paste-the-laptop-value MC_API_URL=http://your-mac.tailnet.ts.net:3000 MC_BRIDGE_REGISTER=1 python3 bridge/mc-bridge-sync.py
   ```

   These values win over the VPS `.env` for this run and do not change it, so a VPS install from setup A keeps working.

6. On the laptop, open Agents. Your OpenClaw agents are there.
7. Keep the laptop fed. Step 5 runs once. The VPS bridge schedule, the user systemd unit `mission-control-bridge.service` with its timer, still posts to the VPS API every 300 seconds, so laptop agents go stale. Point the unit at the laptop with a drop in file:

   ```bash
   mkdir -p ~/.config/systemd/user/mission-control-bridge.service.d
   nano ~/.config/systemd/user/mission-control-bridge.service.d/split.conf
   ```

   Put this in `split.conf`, with the laptop MagicDNS name and the laptop token:

   ```ini
   [Service]
   Environment="MC_API_URL=http://your-mac.tailnet.ts.net:3000"
   Environment="INGEST_TOKEN=paste-the-laptop-value"
   Environment="MC_BRIDGE_REGISTER=1"
   ```

8. Reload systemd, run the bridge once, and restart the timer:

   ```bash
   systemctl --user daemon-reload
   systemctl --user start mission-control-bridge.service
   systemctl --user restart mission-control-bridge.timer
   ```

   Every timer run now posts to the laptop. Agents on the laptop show a fresh last seen within 5 minutes.

Notes for the schedule:

* The drop in overrides the unit only. Leave the VPS `.env` as it is, unless you want split as your default for good.
* While the drop in is there, the VPS board gets no new bridge data. To go back to setup A, delete `split.conf`, then run `systemctl --user daemon-reload` and restart the timer.
* If you set `MC_BRIDGE_UNIT_NAME` at install, use that name in place of `mission-control-bridge`.

Notes for setup B:

* On the Compose install, `/health` and dashboard reads through the MagicDNS URL return 401 without a session cookie, so a 401 from a quick curl still means the laptop is reachable. The bridge signs in on `/events` with `x-ingest-token`.
* A 401 in the bridge output means the token is not the laptop value.
* A 404 on a run update for a run id that exists only in the VPS database is expected, because the two databases are separate.
* `npm run seed:demo` on the laptop still works and does not need OpenClaw.
* Always set `MC_API_URL` to the MagicDNS name, such as `http://your-mac.tailnet.ts.net:3000`. Do not use the raw 100.x address.
* Agents posting tickets from the VPS use that same MagicDNS URL and the laptop token, as [How agents move tickets](#how-agents-move-tickets) says. Those calls are off loopback, so each ticket write needs `x-actor-id` too.

### FAQ

**Does the install connect OpenClaw?** No. `bash install.sh` does not start OpenClaw or connect to it. When `openclaw` is on PATH on the same machine, the installer adds the bridge schedule, and the bridge is the link. When it is not, the installer prints a skip line and finishes. In setup B the laptop install never sees OpenClaw, so the bridge run from the VPS makes that link.

**Why is Agents empty?** A fresh install has no agents and no sample data. Agents fills when the bridge runs, or after you load sample data from the checkout. On Compose this needs Node.js 20.17 or later on the host.

```bash
npm ci
npm run seed:demo
```

**Why does Show sample bots show nothing?** That switch only reveals rows that `npm run seed:demo` wrote. It does not create them. Run the seed first. Once a registered bot exists, sample bots stay hidden until you turn the switch on. `npm run seed:clear` removes them.

## How agents move tickets

Each OpenClaw agent reports as itself. Run these from the machine where the agent runs. Set `MC_API` to the API address, for example `export MC_API=http://127.0.0.1:3000` on the same host, or `export MC_API=http://your-mac.tailnet.ts.net:3000` in setup B. Use your `MC_API_PORT` if it is not 3000, or `PORT` on a native install. Full request shapes are in [API.md](API.md#44-tickets-your-units-of-work) and [PASTE_IN.md](PASTE_IN.md#tickets-and-runs).

1. Read the token from `.env` in the Mission Control checkout. Keep it private. In setup B, use the laptop value.

   ```bash
   export MC_TOKEN="$(grep '^INGEST_TOKEN=' .env | cut -d= -f2-)"
   ```

2. Register the agent once. Use its OpenClaw agent id as `id`. A new id answers 201. The same id again answers 200.

   ```bash
   curl -sS -X POST "$MC_API/agents/register" \
     -H 'content-type: application/json' -H "x-ingest-token: $MC_TOKEN" \
     -d '{"id":"forge","name":"Forge"}'
   ```

3. Send a heartbeat when work starts, and at least every 10 minutes while it runs. It answers 204. An agent with no heartbeat for 10 minutes shows as offline.

   ```bash
   curl -sS -X POST "$MC_API/agents/forge/heartbeat" \
     -H 'content-type: application/json' -H "x-ingest-token: $MC_TOKEN" \
     -d '{"status":"working","currentTask":"Build the login fix"}'
   ```

4. Create the ticket. Send `x-actor-id` with the id of the agent doing the write. Set `assignee` to an agent id. A new ticket starts in `backlog` or `todo` and answers 201. Keep `ticket.id` from the reply.

   ```bash
   curl -sS -X POST "$MC_API/tickets" \
     -H 'content-type: application/json' -H "x-ingest-token: $MC_TOKEN" -H 'x-actor-id: forge' \
     -d '{"title":"Login fix","status":"todo","assignee":"forge"}'
   ```

5. Move the ticket with PATCH and the same two headers. The order is `todo`, then `build`, then `qa`, then `review`, then `done`. Pipeline shows `build`, `qa`, `review`, and `done` as Build, QA, Ship, and Deploy.

   ```bash
   curl -sS -X PATCH "$MC_API/tickets/TICKET_ID" \
     -H 'content-type: application/json' -H "x-ingest-token: $MC_TOKEN" -H 'x-actor-id: forge' \
     -d '{"status":"build"}'
   ```

6. To hand off, PATCH the next status and the next agent as `assignee` in one call, for example `{"status":"qa","assignee":"sentinel"}`. From then on the next agent sends its own id in `x-actor-id`.
7. When the work ships, PATCH `{"status":"done"}`, then send a heartbeat with `{"status":"idle"}`. The agent returns to Commons.

Tips:

* `x-actor-id` must be a registered agent id, and it must be the agent that is acting, not the one that filed the ticket.
* Off loopback, a missing or unknown id answers 400. That covers every Compose install and setup B. On a native install called from the same machine, the call is loopback, the headers are not checked, and no 400 fires. Send both headers anyway, so the same commands work on every setup.
* Use agent ids for `assignee`. A display name works only when exactly one visible agent has it.
* A token may change `status`, `assignee`, `title`, and `description`. There is no ticket delete route.

## Turn on agent handoffs in OpenClaw

Agents hand work to each other with the OpenClaw `sessions_send` tool. Turn it on once per gateway, and prove it before a board run.

1. Back up the config.

   ```bash
   cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak
   ```

2. In `~/.openclaw/openclaw.json`, set `tools.agentToAgent.enabled` to `true` and `tools.sessions.visibility` to `"all"`. Keep the other keys in `tools` as they are.

   ```json
   {
     "tools": {
       "agentToAgent": { "enabled": true },
       "sessions": { "visibility": "all" }
     }
   }
   ```

   If `tools.agentToAgent.allow` is set, list every agent that takes part, both sender and target.

3. Restart the gateway.

   ```bash
   openclaw gateway restart
   ```

4. Prove it. Ask the main agent to use `sessions_send` to send a short ping to the forge agent, and check that forge answers in its own session. Do this before you start a board run.
5. Run the board. Each agent moves its ticket as [How agents move tickets](#how-agents-move-tickets) says, then sends the next agent a `sessions_send` message with the ticket key.

Notes:

* `sessions_send` is enough for handoffs. Each agent keeps its own session.
* `sessions_spawn` may still only allow agentId `main`. Changing that is a separate OpenClaw setting. Handoffs do not need it.
* To undo, copy `openclaw.json.bak` back and restart the gateway.

## Auth at a glance

1. Dashboard reads, such as `/health`, `/agents`, and `/tickets`, need the session cookie from signing in when the caller is off loopback. On Compose every caller is off loopback, including the host, the tunnel port, and setup B through Tailscale Serve, so they answer 401 without it. A 401 there still means the API is reachable.
2. On a native install, a call from `127.0.0.1` is loopback and stays open with no cookie. Tailscale Serve to the API port arrives from `127.0.0.1` too, so a native install must not serve the API port on the tailnet. That is why setup B needs Compose.
3. Bridge and agent writes send `x-ingest-token` with the `INGEST_TOKEN` value from the `.env` of the Mission Control they post to. That covers `/events`, register, heartbeat, and runs.
4. Ticket writes, `POST /tickets` and `PATCH /tickets/:id`, send `x-ingest-token` and also `x-actor-id` with the id of the agent that is acting.
5. A 401 on a write means the token is wrong or the route is for the dashboard only. Off loopback, a 400 `actor must be a registered agent id` means `x-actor-id` is missing or not a registered agent. Register first. On true loopback the API does not check `x-actor-id`, as [API.md](API.md#41-auth) says.

The full auth table is in [API.md](API.md#41-auth).

## Open it from a laptop or phone

A laptop reaches a VPS install in three ways. All three are free. OpenClaw is optional and is not required for any of them.

Run the tunnel program on the VPS. Compose publishes the owner port and the tunnel port on `127.0.0.1` only. Point each program at that address. Do not publish port 3011 on a public interface.

On Compose, `bash install.sh` prints the owner URL and the tunnel port. On the native path it prints the owner URL and a pointer to this file, because that path does not listen on the tunnel port. The native install prints that URL only after the web app answers on it. The owner port is `MC_WEB_PORT` (default 5173). The Compose tunnel port is `MC_REMOTE_PORT` (default 3011). Use `127.0.0.1`, not a name that might resolve to another address. The published sockets are IPv4 loopback only.

Leave `TRUSTED_PROXY` unset. These paths do not set it. The tunnel listener does not read it.

## From the Connect page

Step 7 of `/#/connect` is this guide in one line: forward the owner port over SSH and keep the session open. Login is required on a Compose install. The owner port is `MC_WEB_PORT`, and the command on the page already uses the configured web port. The page calls the API on that same origin.

Pick the OS you are on. Every OS gets the same command. On macOS, open Terminal. On Windows, open PowerShell, which has OpenSSH built in. On Linux or any other system, open a terminal. Replace `your-server-ip` with your host.

If the page check fails, keep the SSH session open, run the tunnel again, then retry. If the stack is not up, finish steps 1 to 4 on the host first. Tailscale Serve and Cloudflare Tunnel point at `127.0.0.1` on the tunnel port, `MC_REMOTE_PORT` (default 3011), as the sections below say. Leave `TRUSTED_PROXY` unset.

## From a phone

A phone opens Mission Control in its browser. SSH, the Connect page step 7 method, is not practical on a phone, so use Tailscale Serve or a Cloudflare quick tunnel instead. Run the tunnel program on the machine that runs Mission Control: the VPS, or your laptop when Mission Control runs there. A laptop host must stay awake and online while the phone uses it.

Tailscale: install the Tailscale app on the phone and sign in to the same tailnet as the host. On the host, serve the tunnel port, then open the `https` name it prints in the phone browser.

```bash
tailscale serve http://127.0.0.1:${MC_REMOTE_PORT:-3011}
```

Cloudflare quick tunnel: no app is needed on the phone. On the host, run the command below, then open the `trycloudflare.com` link it prints in the phone browser. The link changes every run, and anyone with it reaches the sign in page, so the password matters.

```bash
cloudflared tunnel --url http://127.0.0.1:${MC_REMOTE_PORT:-3011}
```

Sign in with the dashboard password. Both paths use the tunnel port, `MC_REMOTE_PORT` (default 3011), and always require login. The sections below have the details.

## SSH tunnel

Login is required on the Compose install this guide is for.

On the laptop, forward only the owner web port. Replace the user and host. If the installer printed a web port other than 5173, use that port in both places and in the browser URL.

```bash
ssh -L 5173:127.0.0.1:5173 ubuntu@your-vps
```

Keep that session open. On the laptop, open `http://127.0.0.1:5173/#/tasks`. The page calls the API on the same origin. Port 3000 stays on the VPS for curl and the bridge. It does not need a forward.

This path uses the local nginx listener. That listener clears `X-MC-Remote` and `CF-Connecting-IP`. It sets `X-Forwarded-For` from the address it accepted. An SSH tunnel and a browser on the VPS share the owner bucket. They still sign in. Loopback is the socket address only. The API sees the web container on the Docker network, so a forwarded `127.0.0.1` does not open the dashboard.

Wrong passwords on that owner bucket follow the login floor below. A tunnel client on port 3011 does not share this count.

`npm run dev` is different. Vite proxies from `127.0.0.1`, the socket is loopback, and the dashboard stays open. A VPS install uses Compose, not that path.

## Tailscale Serve

Login is required.

Install Tailscale on the VPS and join the tailnet. The personal plan includes Serve. Serve stays on the tailnet. This guide does not use Funnel.

On the VPS, proxy the tunnel port. The command below targets `127.0.0.1` on `MC_REMOTE_PORT`, which defaults to 3011. Leave the process running. The client prints an `https` name on your tailnet. Open that name on the laptop.

```bash
tailscale serve http://127.0.0.1:${MC_REMOTE_PORT:-3011}
```

Port 3011 always sets `X-MC-Remote` to `1` and always requires login. Nobody on that port is loopback and nobody is the owner. Tailscale Serve puts the client in the first `X-Forwarded-For` hop. It does not set `CF-Connecting-IP`. The login bucket is that first hop.

This listener copies `CF-Connecting-IP` when a client sends one. A new spoofed value on each try is a new bucket, so the lockout does not hold. Use Cloudflare Tunnel, or a long password.

Wrong passwords follow the login floor below. The owner bucket is a separate count.

## Cloudflare Tunnel

Login is required.

Install `cloudflared` on the VPS. Both commands below are on the free plan. Both target `127.0.0.1` on `MC_REMOTE_PORT`, which defaults to 3011.

A Quick Tunnel needs no account and no domain. It prints a `trycloudflare.com` URL. Anyone with that URL can open the site, so the password matters. The URL stops when the process stops, and the next run prints a new one.

```bash
cloudflared tunnel --url http://127.0.0.1:${MC_REMOTE_PORT:-3011}
```

A named tunnel stays on one hostname. Create it with a free Cloudflare account, then point the ingress at the same address. `mc.example.com` below is the hostname you added. It is not a built in name.

```yaml
ingress:
  - hostname: mc.example.com
    service: http://127.0.0.1:3011
  - service: http_status:404
```

If `MC_REMOTE_PORT` is not 3011, use that port in `service`. Run `cloudflared tunnel run` with the tunnel you created.

Port 3011 always sets `X-MC-Remote` to `1` and always requires login. Nobody on that port is loopback and nobody is the owner. Cloudflare sets `CF-Connecting-IP` to the visitor. This listener copies that header, and the login bucket is that address. A value the client invented does not replace the address Cloudflare set.

Wrong passwords follow the login floor below. The owner bucket is a separate count.

## Login floor

This is the behavior in the tree now. Loopback is decided from the socket only. A forwarded header never counts as loopback, including `X-Forwarded-For: 127.0.0.1`.

Port 3011 always sets `X-MC-Remote: 1`. The API honors that tag only when the socket peer is the bundled nginx. On that port every dashboard read and write needs a session. `POST /auth/login` is open so the browser can sign in.

Login failures are bucketed per visitor. `CF-Connecting-IP` wins when it is an IP. Otherwise the first `X-Forwarded-For` hop is the bucket. With neither header, every such request shares one remote bucket. That bucket is not the owner bucket. An SSH tunnel uses the owner port and shares the owner bucket.

Five failures in 60 seconds lock that bucket. The next try is HTTP 429 with `Retry-After`, even when the password is right. The wait starts at 60 seconds and doubles on each later lockout, up to 15 minutes. The three numbers are `LOGIN_FAIL_LIMIT`, `LOGIN_WINDOW_SECONDS`, and `LOGIN_BACKOFF_MAX_SECONDS`. A blank or invalid value uses those defaults. Loopback is not counted. Agent ingest with `x-ingest-token` is not counted.

The sign in page shows the message from the API. Off Compose that message names `npm run login:reset`. When `MC_COMPOSE` is `1` the message names `docker compose exec api npm run login:reset`. Under Compose the counters live in the api container, so the reset is:

```bash
docker compose exec api npm run login:reset
```

That command clears every bucket. It does not restore a revoked session. Restarting the API clears the wait too.

On a tunnel other than Cloudflare, a client that sends a new spoofed `CF-Connecting-IP` on each try gets a new bucket and avoids the lockout. Use Cloudflare Tunnel, or a long password.

## Password reset

`npm run password:reset` writes a new scrypt hash to the session file, prints the password once, and revokes every session. Old cookies stop working, including after a restart. There is no HTTP route for this reset. Run it from the checkout on a native install:

```bash
npm run password:reset
```

Under Compose the session file is on the mc-auth volume inside the api container. `bash install.sh` sets `MC_INSTALL_MODE=compose` in `.env`. A host `npm run password:reset` then runs only inside the api container:

```bash
docker compose exec api npm run password:reset
```

That does not call Node on the host and it does not write a host file. If the api is not running, or Docker cannot run that command, the host command exits nonzero and tells you to run `docker compose up -d` first. With no `MC_INSTALL_MODE` in `.env`, a host `npm run password:reset` asks Docker for this checkout's Compose containers and its mc-auth volume. If it finds either, or Docker cannot answer, it refuses, writes nothing, and asks you to run `bash install.sh` again. When Docker did not answer, the message also says to start Docker. A machine with no docker command, or with no Compose trace, keeps the native reset. If the new hash cannot be read back, the command exits 3 and says the password may have changed. Run the reset again to set a new one. The new password is printed only after the new hash is read back and every session is revoked. The installer prints the reset command in its last lines. The password itself is printed only on the first install.

## Gateway status

Under Compose the bridge runs on the host. It checks the OpenClaw gateway at `127.0.0.1` on `OPENCLAW_GATEWAY_PORT` (default 18789) and posts `gateway.snapshot` with `x-ingest-token`. System shows that report. A missing report, or a report older than `GATEWAY_STATUS_MAX_AGE_MS`, counts as stale and shows Unknown. A report stored before the API process started is Unknown too, so a recreated API container shows Unknown until the next bridge report. A future checkedAt is counted from the time the API stored the report. The default is 600000 milliseconds, which is 10 minutes. Blank, 0, or an invalid number uses that default. Unknown is not the same as down. Down is a real check.

A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host instead of reading the bridge report. OpenClaw does not have to be running. A down or unknown gateway does not block sign in, and `npm run seed:demo` does not need it.
