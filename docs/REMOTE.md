# Remote access

A laptop reaches a VPS install in three ways. All three are free. OpenClaw is optional and is not required for any of them.

Run the tunnel program on the VPS. Compose publishes the owner port and the tunnel port on `127.0.0.1` only. Point each program at that address. Do not publish port 3011 on a public interface.

`bash install.sh` prints the owner URL and the tunnel port. The owner port is `MC_WEB_PORT` (default 5173). The tunnel port is `MC_REMOTE_PORT` (default 3011). Use `127.0.0.1`, not a name that might resolve to another address. The published sockets are IPv4 loopback only.

Leave `TRUSTED_PROXY` unset. These paths do not set it. The tunnel listener does not read it.

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

Under Compose the session file is on the mc-auth volume inside the api container. Run the command there. That does not call Node on the host:

```bash
docker compose exec api npm run password:reset
```

The installer prints that command in its last lines. The password itself is printed only on the first install.

## Gateway status

Under Compose the bridge runs on the host. It checks the OpenClaw gateway at `127.0.0.1` on `OPENCLAW_GATEWAY_PORT` (default 18789) and posts `gateway.snapshot` with `x-ingest-token`. System shows that report. A missing report, or a report older than `GATEWAY_STATUS_MAX_AGE_MS`, counts as stale and shows Unknown. A future checkedAt is counted from the time the API stored the report. The default is 600000 milliseconds, which is 10 minutes. Blank, 0, or an invalid number uses that default. Unknown is not the same as down. Down is a real check.

A native install, or an explicit `OPENCLAW_GATEWAY_HOST`, probes that host instead of reading the bridge report. OpenClaw does not have to be running. A down or unknown gateway does not block sign in, and `npm run seed:demo` does not need it.
