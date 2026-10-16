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
  assert.equal(compose.services.api.environment.INGEST_TOKEN, '${INGEST_TOKEN:-dev-ingest-token}')
  assert.equal(compose.services.api.environment.SOCKET_TOKEN, '${SOCKET_TOKEN:-dev-socket-token}')
  assert.equal(compose.services.web.build.args.VITE_API_URL, '${VITE_API_URL:-}')
  assert.equal(compose.services.web.build.args.VITE_SOCKET_TOKEN, '${SOCKET_TOKEN:-dev-socket-token}')
  assert.equal(compose.services.web.environment.INGEST_TOKEN, '${INGEST_TOKEN:-dev-ingest-token}')
  assert.deepEqual(compose.services.web.depends_on, ['api'])
  for (const spec of [
    compose.services.db.ports[0],
    compose.services.api.ports[0],
    compose.services.web.ports[0],
  ]) {
    assert.match(spec, /^127\.0\.0\.1:/)
  }
  assert.equal(compose.services.api.build.dockerfile, 'apps/api/Dockerfile')
  assert.equal(compose.services.web.build.dockerfile, 'apps/web/Dockerfile')
})

test('nginx proxies /api and /socket.io and still injects the write token', () => {
  const nginx = read('apps/web/nginx.conf.template')
  assert.match(nginx, /location \/api\/ \{/)
  assert.match(nginx, /proxy_pass http:\/\/api:3000\/;/)
  assert.match(nginx, /proxy_set_header x-ingest-token "\$\{INGEST_TOKEN\}";/)
  assert.match(nginx, /location \/socket\.io\/ \{/)
  assert.match(nginx, /proxy_pass http:\/\/api:3000;/)
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade;/)
  assert.match(nginx, /proxy_set_header Connection "upgrade";/)
  assert.doesNotMatch(nginx, /VITE_API_URL/)
})

test('Dockerfiles copy files that exist and the web API url defaults to blank', () => {
  const api = read('apps/api/Dockerfile')
  const web = read('apps/web/Dockerfile')
  assert.match(api, /COPY --from=build \/app\/apps\/api\/prisma\.config\.ts/)
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

test('same origin is the web default and cors origins are unchanged', () => {
  const apiBase = read('apps/web/src/lib/apiBase.ts')
  assert.match(apiBase, /EXPLICIT_ORIGIN \|\| '\/api'/)
  assert.doesNotMatch(apiBase, /localhost:3000/)
  const cors = read('apps/api/src/cors-origins.ts')
  assert.match(cors, /http:\/\/localhost:5173/)
  assert.match(cors, /http:\/\/127\.0\.0\.1:5173/)
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
})
