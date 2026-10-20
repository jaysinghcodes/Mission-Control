/**
 * docker compose is not executed here. These checks read the compose file,
 * the nginx template, and the Dockerfiles.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

function parseCompose() {
  const result = spawnSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))'], {
    input: read('docker-compose.yml'),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('compose yaml lists db, api, and web on loopback', () => {
  const compose = parseCompose()
  assert.ok(compose.services.db)
  assert.ok(compose.services.api)
  assert.ok(compose.services.web)
  assert.equal(compose.services.db.image, 'postgres:16-alpine')
  assert.deepEqual(compose.services.db.volumes, ['mc-db:/var/lib/postgresql/data'])
  assert.equal(compose.volumes['mc-db'], null)
  assert.match(compose.services.api.environment.DATABASE_URL, /@db:5432\/mission_control$/)
  assert.equal(compose.services.api.environment.HOST, '0.0.0.0')
  assert.equal(compose.services.api.environment.INGEST_TOKEN, '${INGEST_TOKEN:-}')
  assert.equal(compose.services.api.environment.DASHBOARD_PASSWORD_HASH, '${DASHBOARD_PASSWORD_HASH:-}')
  assert.equal(compose.services.api.environment.SESSION_SECRET, '${SESSION_SECRET:-}')
  assert.equal(compose.services.api.environment.SESSION_STATE_PATH, '/data/auth/session-state.json')
  assert.equal(compose.services.api.environment.LOGIN_FAIL_LIMIT, '${LOGIN_FAIL_LIMIT:-5}')
  assert.equal(compose.services.api.environment.LOGIN_WINDOW_SECONDS, '${LOGIN_WINDOW_SECONDS:-60}')
  assert.equal(compose.services.api.environment.LOGIN_BACKOFF_MAX_SECONDS, '${LOGIN_BACKOFF_MAX_SECONDS:-900}')
  assert.equal(compose.services.api.environment.BUNDLED_PROXY, '${BUNDLED_PROXY:-web}')
  assert.equal(compose.services.api.environment.TRUSTED_PROXY, '${TRUSTED_PROXY:-}')
  assert.equal(compose.volumes['mc-auth'], null)
  assert.equal(compose.services.api.environment.SOCKET_TOKEN, undefined)
  assert.equal(compose.services.web.build.args.VITE_API_URL, '${VITE_API_URL:-}')
  assert.equal(compose.services.web.build.args.VITE_SOCKET_TOKEN, undefined)
  assert.equal(compose.services.web.environment, undefined)
  assert.deepEqual(compose.services.web.depends_on, ['api'])
  assert.deepEqual(compose.services.web.ports, [
    '127.0.0.1:${MC_WEB_PORT:-5173}:5173',
    '127.0.0.1:${MC_REMOTE_PORT:-3011}:3011',
  ])
  for (const spec of [
    compose.services.db.ports[0],
    compose.services.api.ports[0],
    ...compose.services.web.ports,
  ]) {
    assert.match(spec, /^127\.0\.0\.1:/)
  }
  assert.equal(compose.services.api.build.dockerfile, 'apps/api/Dockerfile')
  assert.equal(compose.services.api.build.args.GIT_SHA, '${GIT_SHA:-}')
  assert.equal(compose.services.api.environment.MC_COMPOSE, '1')
  assert.equal(compose.services.api.environment.OPENCLAW_GATEWAY_HOST, '${OPENCLAW_GATEWAY_HOST:-}')
  assert.equal(compose.services.api.environment.OPENCLAW_GATEWAY_PORT, '${OPENCLAW_GATEWAY_PORT:-}')
  assert.equal(compose.services.api.environment.GATEWAY_STATUS_MAX_AGE_MS, '${GATEWAY_STATUS_MAX_AGE_MS:-600000}')
  assert.deepEqual(compose.services.api.extra_hosts, ['host.docker.internal:host-gateway'])
  assert.equal(compose.services.api.environment.OPENCLAW_LOG_DIR, '${OPENCLAW_LOG_DIR:-/tmp/openclaw}')
  assert.equal(compose.services.web.build.dockerfile, 'apps/web/Dockerfile')
})

test('nginx proxies /api and /socket.io and does not inject a write token', () => {
  const nginx = read('apps/web/nginx.conf.template')
  assert.match(nginx, /location \/api\/ \{/)
  assert.match(nginx, /proxy_pass http:\/\/api:3000\/;/)
  assert.doesNotMatch(nginx, /x-ingest-token/)
  assert.doesNotMatch(nginx, /INGEST_TOKEN/)
  assert.match(nginx, /location \/socket\.io\/ \{/)
  assert.match(nginx, /proxy_pass http:\/\/api:3000;/)
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade;/)
  assert.match(nginx, /proxy_set_header Connection "upgrade";/)
  assert.doesNotMatch(nginx, /VITE_API_URL/)
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/)
  assert.doesNotMatch(nginx, /\$http_x_real_ip/)
  assert.doesNotMatch(nginx, /\$http_x_forwarded_proto/)
  const servers = [...nginx.matchAll(/server \{([\s\S]*?)\n\}/g)].map((match) => match[1])
  assert.equal(servers.length, 2)
  const local = servers.find((block) => block.includes('listen 5173;'))
  const remote = servers.find((block) => block.includes('listen 3011;'))
  assert.ok(local)
  assert.ok(remote)
  assert.doesNotMatch(local, /\$http_x_forwarded_for/)
  for (const block of [locationBlock(local, '/api/'), locationBlock(local, '/socket\\.io/')]) {
    assert.match(block, /proxy_set_header X-MC-Remote "";/)
    assert.match(block, /proxy_set_header X-Real-IP \$remote_addr;/)
    assert.match(block, /proxy_set_header X-Forwarded-For \$remote_addr;/)
    assert.match(block, /proxy_set_header X-Forwarded-Proto \$scheme;/)
  }
  for (const block of [locationBlock(remote, '/api/'), locationBlock(remote, '/socket\\.io/')]) {
    assert.match(block, /proxy_set_header X-MC-Remote 1;/)
    assert.match(block, /proxy_set_header CF-Connecting-IP \$http_cf_connecting_ip;/)
    assert.match(block, /proxy_set_header X-Forwarded-For \$http_x_forwarded_for;/)
  }
})

function locationBlock(src, name) {
  const match = new RegExp(`location ${name} \\{([\\s\\S]*?)\\n    \\}`).exec(src)
  assert.ok(match, `missing location ${name}`)
  return match[1]
}

test('Dockerfiles copy files that exist and the web API url defaults to blank', () => {
  const api = read('apps/api/Dockerfile')
  const web = read('apps/web/Dockerfile')
  assert.match(api, /COPY --from=build \/app\/apps\/api\/prisma\.config\.ts/)
  assert.match(api, /ARG GIT_SHA=/)
  assert.match(api, /git-sha\.txt/)
  assert.match(api, /CMD \["node", "dist\/main\.js"\]/)
  assert.match(web, /ARG VITE_API_URL=/)
  assert.doesNotMatch(web, /ARG VITE_API_URL=http/)
  assert.match(web, /COPY apps\/web\/nginx\.conf\.template/)
  for (const rel of [
    'package.json',
    'package-lock.json',
    'turbo.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'apps/api/Dockerfile',
    'apps/web/Dockerfile',
    'apps/web/nginx.conf.template',
    'apps/api/prisma.config.ts',
    'apps/api/prisma/schema.prisma',
  ]) {
    assert.equal(existsSync(path.join(root, rel)), true, rel)
  }
})

test('the runtime image copies crew.json with the default config', () => {
  const api = read('apps/api/Dockerfile')
  assert.match(api, /COPY --from=build \/app\/config\/crew\.json \/app\/config\/crew\.json/)
  assert.match(api, /COPY --from=build \/app\/config\/prices\.json \/app\/config\/prices\.json/)
  assert.match(api, /COPY --from=build \/app\/config\/timezones\.json \/app\/config\/timezones\.json/)
  for (const rel of ['config/crew.json', 'config/prices.json', 'config/timezones.json']) {
    assert.equal(existsSync(path.join(root, rel)), true, rel)
  }
  const compose = parseCompose()
  const configMounts = compose.services.api.volumes.filter((spec) => String(spec).includes('/app/config'))
  assert.deepEqual(configMounts, ['./config:/app/config:ro'])
})

test('same origin is the web default and cors origins are unchanged', () => {
  const apiBase = read('apps/web/src/lib/apiBase.ts')
  assert.match(apiBase, /EXPLICIT_ORIGIN \|\| '\/api'/)
  assert.doesNotMatch(apiBase, /localhost:3000/)
  const cors = read('apps/api/src/cors-origins.ts')
  assert.match(cors, /DEFAULT_WEB_PORT = '5173'/)
  assert.match(cors, /http:\/\/localhost:\$\{port\}/)
  assert.match(cors, /http:\/\/127\.0\.0\.1:\$\{port\}/)
  assert.match(cors, /MC_WEB_PORT/)
  const main = read('apps/api/src/main.ts')
  assert.match(main, /bootApi\(\)/)
  const boot = read('apps/api/src/boot.ts')
  assert.match(boot, /prisma', 'migrate', 'deploy'/)
})

test('compose, nginx, and the install docs have no dash punctuation or arrows', () => {
  const dash = /[\u2012\u2013\u2014\u2015→←⇒]/
  for (const rel of [
    'docker-compose.yml',
    'apps/web/nginx.conf.template',
    'apps/web/src/lib/apiBase.ts',
    'apps/web/src/components/ConnectSteps.tsx',
  ]) {
    const text = read(rel)
    assert.equal(dash.test(text), false, rel)
  }
  const readme = read('README.md')
  const install = readme.split(/^## Install and run\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  assert.equal(dash.test(install), false, 'README install section')
  const onboarding = read('docs/OPENCLAW_ONBOARDING.md')
  const section = onboarding.split(/^## 2\. Install and run\s*$/m)[1]?.split(/^## 3\./m)[0] ?? ''
  assert.equal(dash.test(section), false, 'onboarding install section')
  for (const rel of [
    'docs/OPENCLAW_ONBOARDING.md',
    'docs/PASTE_IN.md',
    'docs/API.md',
    'docs/REMOTE.md',
    'ONBOARDING.md',
  ]) {
    assert.equal(dash.test(read(rel)), false, rel)
    assert.equal(read(rel).includes('->'), false, rel)
  }
})

test('compose password reset is docker compose exec and does not call host node', () => {
  const command = 'docker compose exec api npm run password:reset'
  const dockerfile = read('apps/api/Dockerfile')
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/api\/scripts\/password-reset\.mjs/)
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/api\/src\/load-env\.js/)
  const nestCli = JSON.parse(read('apps/api/nest-cli.json'))
  const assets = nestCli.compilerOptions?.assets ?? []
  assert.ok(assets.includes('load-env.js'), 'nest build must copy load-env.js next to dist/boot.js')
  assert.equal(existsSync(path.join(root, 'apps/api/scripts/password-reset.mjs')), true)
  const resetScript = read('apps/api/scripts/password-reset.mjs')
  assert.match(resetScript, /loadEnvFiles/)
  assert.doesNotMatch(resetScript, /\/auth\/password-reset/)
  assert.doesNotMatch(resetScript, /node:http/)
  assert.doesNotMatch(read('apps/api/src/auth/auth.controller.ts'), /password-reset/)
  for (const rel of ['README.md', 'docs/REMOTE.md', 'docs/API.md', 'install.sh']) {
    assert.match(read(rel), new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(command, /^docker compose exec /)
  assert.equal(/^(node|npm|npx)\b/.test(command), false)
  const install = read('install.sh')
  const resetLines = install.split('\n').filter((line) => line.includes('password:reset'))
  assert.ok(resetLines.length > 0)
  for (const line of resetLines) {
    assert.match(line, /echo |reset=/)
    assert.doesNotMatch(line.trim(), /^(node|npm|npx)\b/)
  }
  const marked = install.split('# compose-host-free:start').slice(1).map((part) => part.split('# compose-host-free:end')[0]).join('\n')
  assert.doesNotMatch(marked, /password:reset/)
  assert.doesNotMatch(marked, /\b(npm|npx)\b/)
})

test('the remote access guide matches the shipped tunnel listener', () => {
  const text = read('docs/REMOTE.md')
  const guides = text.split(/^## /m).filter((part) => /^(SSH tunnel|Tailscale Serve|Cloudflare Tunnel)\n/.test(part))
  assert.equal(guides.length, 3)
  for (const guide of guides) {
    assert.match(guide, /Login is required/)
  }
  assert.match(text, /ssh -L 5173:127\.0\.0\.1:5173 /)
  assert.match(text, /tailscale serve http:\/\/127\.0\.0\.1:\$\{MC_REMOTE_PORT:-3011\}/)
  assert.match(text, /cloudflared tunnel --url http:\/\/127\.0\.0\.1:\$\{MC_REMOTE_PORT:-3011\}/)
  assert.match(text, /X-MC-Remote/)
  assert.match(text, /CF-Connecting-IP/)
  assert.match(text, /X-Forwarded-For/)
  assert.match(text, /owner bucket/)
  assert.match(text, /5 failures in 60 seconds|Five failures in 60 seconds/)
  assert.match(text, /429/)
  assert.match(text, /Retry-After/)
  assert.match(text, /15 minutes/)
  assert.match(text, /docker compose exec api npm run login:reset/)
  assert.match(text, /MC_COMPOSE/)
  assert.match(text, /GATEWAY_STATUS_MAX_AGE_MS/)
  assert.match(text, /10 minutes/)
  assert.match(text, /Leave `TRUSTED_PROXY` unset/)
  assert.doesNotMatch(text, /TRUSTED_PROXY=/)
  assert.match(text, /spoofed `CF-Connecting-IP`/)
  assert.match(text, /Cloudflare Tunnel, or a long password/)
  assert.equal(text.includes('->'), false)
  assert.equal(/[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/.test(text), false)
})
