import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  FIX_DATABASE,
  FIX_ENV,
  FIX_HEALTH,
  FIX_MIGRATIONS,
  FIX_NODE,
  FIX_TOKEN,
  apiListenPort,
  bridgeStaleSeconds,
  bridgeSyncState,
  effectiveEnv,
  hasDashPunctuation,
  inspectApiPort,
  nodeSupported,
  readHealthIdentity,
  report,
  runDoctor,
  gatewayLine,
  gatewayTarget,
  loginState,
  tokenState,
} from './doctor.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function facts(overrides = {}) {
  return {
    nodeVersion: 'v22.14.0',
    envExists: true,
    env: { HOST: '127.0.0.1', INGEST_TOKEN: 'change-me', PORT: '3000' },
    ports: {
      badPort: false,
      api: 3000,
      apiState: 'ours',
      health: { reachable: true, db: 'up', url: 'http://127.0.0.1:3000/health' },
    },
    database: { state: 'ok', migrations: 'current', pending: [], detail: '127.0.0.1:5432' },
    openclaw: 'OpenClaw is optional. The openclaw command is not on PATH, so the bridge was not reached. Sample data does not need it.',
    bridge: { state: 'missing', limit: 600 },
    ...overrides,
  }
}

test('supported Node ranges are 20.17+ and 22.9+', () => {
  assert.equal(nodeSupported('v20.17.0'), true)
  assert.equal(nodeSupported('v20.16.9'), false)
  assert.equal(nodeSupported('v22.9.0'), true)
  assert.equal(nodeSupported('v22.8.9'), false)
  assert.equal(nodeSupported('v18.20.8'), false)
  assert.equal(nodeSupported('v21.7.3'), false)
  assert.equal(nodeSupported('v24.0.0'), false)
})

test('login is open on loopback and required when Compose or a public bind has no password', () => {
  assert.equal(loginState({ HOST: '127.0.0.1' }).kind, 'loopback-open')
  assert.equal(loginState({ HOST: '127.0.0.1', DASHBOARD_PASSWORD_HASH: 'scrypt:1', SESSION_SECRET: 'ab' }).kind, 'set')
  assert.equal(loginState({ HOST: '0.0.0.0' }).kind, 'exposed')
  assert.equal(loginState({ HOST: '127.0.0.1', MC_DOCTOR_DOCKER: '1' }).ok, false)
  assert.equal(
    loginState({ HOST: '127.0.0.1', MC_DOCTOR_DOCKER: '1', DASHBOARD_PASSWORD_HASH: 'scrypt:1', SESSION_SECRET: 'ab' }).kind,
    'set',
  )
  const exposed = report(facts({ env: { HOST: '0.0.0.0', INGEST_TOKEN: 'change-me', PORT: '3000' } }))
  assert.equal(exposed.code, 1)
  assert.match(exposed.lines[6], /^fail login:/)
})

test('token rules match loopback, production, and off loopback', () => {
  assert.equal(tokenState({ HOST: '127.0.0.1', INGEST_TOKEN: 'change-me' }).ok, true)
  assert.equal(tokenState({ HOST: '127.0.0.1' }).kind, 'loopback-open')
  assert.equal(tokenState({ HOST: '127.0.0.1', NODE_ENV: 'production' }).kind, 'production')
  assert.equal(tokenState({ HOST: '0.0.0.0' }).kind, 'off-loopback')
  assert.equal(tokenState({ HOST: '0.0.0.0', INGEST_TOKEN: 'change-me', NODE_ENV: 'production' }).ok, true)
  assert.equal(tokenState({ INGEST_TOKEN: '   ' }).kind, 'loopback-open')
})

test('a healthy report exits 0 and keeps OpenClaw informational', () => {
  const result = report(facts())
  assert.equal(result.code, 0)
  assert.equal(result.lines.length, 11)
  assert.ok(result.lines.every((line) => !hasDashPunctuation(line)))
  assert.match(result.lines[0], /^pass node:/)
  assert.match(result.lines[1], /^pass ports: Port 3000 is already running\.$/)
  assert.match(result.lines[7], /^pass health: The health check says the database is up\.$/)
  assert.match(result.lines[2], /^pass env:/)
  assert.match(result.lines[3], /^pass database:/)
  assert.match(result.lines[4], /^pass migrations:/)
  assert.match(result.lines[5], /^pass token:/)
  assert.match(result.lines[6], /^pass login: HOST is loopback, so the dashboard stays open without a password\.$/)
  assert.match(result.lines[8], /^info openclaw: OpenClaw is optional/)
  assert.match(result.lines[9], /^info bridge: No OpenClaw sync timestamp was found/)
  assert.match(result.lines[10], /^info gateway: The gateway probe uses 127\.0\.0\.1 port 18789\./)
})

test('each required failure names the next command and exits non zero', () => {
  const cases = [
    {
      name: 'node',
      facts: facts({ nodeVersion: 'v18.20.8' }),
      includes: FIX_NODE,
    },
    {
      name: 'ports',
      facts: facts({
        ports: {
          badPort: false,
          api: 3000,
          apiState: 'busy',
          health: { reachable: false, db: null, url: 'http://127.0.0.1:3000/health' },
        },
      }),
      includes: 'Port 3000 is used by another program. Stop it or set PORT in .env.',
    },
    {
      name: 'env',
      facts: facts({ envExists: false }),
      includes: FIX_ENV,
    },
    {
      name: 'database',
      facts: facts({
        database: { state: 'unreachable', migrations: 'unknown', pending: [], detail: '127.0.0.1:5432' },
      }),
      includes: FIX_DATABASE,
    },
    {
      name: 'migrations',
      facts: facts({
        database: {
          state: 'ok',
          migrations: 'pending',
          pending: ['20261006040100_run_ticket_id'],
          detail: '127.0.0.1:5432',
        },
      }),
      includes: FIX_MIGRATIONS,
    },
    {
      name: 'token',
      facts: facts({ env: { HOST: '127.0.0.1', NODE_ENV: 'production', PORT: '3000' } }),
      includes: FIX_TOKEN,
    },
    {
      name: 'bridge',
      facts: facts({ bridge: { state: 'stale', limit: 600, scheduled: true } }),
      includes: 'The last OpenClaw sync is older than 600 seconds. Run python3 bridge/mc-bridge-sync.py and confirm the schedule is installed.',
    },
    {
      name: 'health',
      facts: facts({
        ports: {
          badPort: false,
          api: 3000,
          apiState: 'free',
          health: { reachable: false, db: null, url: 'http://127.0.0.1:3000/health' },
        },
      }),
      includes: FIX_HEALTH,
    },
  ]
  for (const item of cases) {
    const result = report(item.facts)
    assert.equal(result.code, 1, item.name)
    const line = result.lines.find((entry) => entry.startsWith(`fail ${item.name}:`))
    assert.ok(line, item.name)
    assert.match(line, new RegExp(item.includes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.equal(hasDashPunctuation(result.lines.join('\n')), false, item.name)
    if (item.name === 'ports') {
      assert.equal(
        result.lines[7],
        'info health: Skipped because the API port is used by another program.',
      )
      assert.doesNotMatch(result.lines[7], /npm run dev/)
    }
  }
})

const HTML_404 = `<!DOCTYPE HTML>
<html lang="en">
<head>
<title>Error response</title>
</head>
<body>
<h1>Error response</h1>
<p>Error code: 404</p>
<p>Message: File not found.</p>
</body>
</html>
`

function dbOk() {
  return { state: 'ok', migrations: 'current', pending: [], detail: '127.0.0.1:5432' }
}

function dbDown() {
  return { state: 'unreachable', migrations: 'unknown', pending: [], detail: '127.0.0.1:59999' }
}

function otherProgram(port) {
  return `fail ports: Port ${port} is used by another program. Stop it or set PORT in .env.`
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

test('a foreign 404 fails with the port message', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(404, { 'content-type': 'text/html' })
    res.end(HTML_404)
  })
  const port = await listen(server)
  try {
    const seen = await inspectApiPort(port)
    assert.equal(seen.state, 'other')
    const result = report(facts({
      ports: { badPort: false, api: port, apiState: 'busy', health: { reachable: false, db: null, url: seen.url } },
      database: dbOk(),
    }))
    assert.equal(result.code, 1)
    assert.equal(result.lines[1], otherProgram(port))
    assert.match(result.lines[3], /^pass database:/)
    assert.equal(
      result.lines[7],
      'info health: Skipped because the API port is used by another program.',
    )
    assert.doesNotMatch(result.lines[7], /npm run dev/)
    assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
  } finally {
    await close(server)
  }
})

test('a foreign 500 fails with the port message whether the database is up or down', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('oops')
  })
  const port = await listen(server)
  try {
    const seen = await inspectApiPort(port)
    assert.equal(seen.state, 'other')
    assert.equal(
      readHealthIdentity({ status: 500, text: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) }).ours,
      false,
    )
    for (const database of [dbOk(), dbDown()]) {
      const result = report(facts({
        ports: { badPort: false, api: port, apiState: 'busy', health: { reachable: false, db: null, url: seen.url } },
        database,
      }))
      assert.equal(result.lines[1], otherProgram(port))
      assert.equal(result.code, 1)
      assert.doesNotMatch(result.lines[1], /already running/)
      assert.equal(
        result.lines[7],
        'info health: Skipped because the API port is used by another program.',
      )
      assert.doesNotMatch(result.lines.join('\n'), /npm run dev/)
      assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
    }
  } finally {
    await close(server)
  }
})

test('a raw TCP listener with no HTTP fails with the port message', async () => {
  const server = net.createServer((socket) => socket.destroy())
  const port = await listen(server)
  try {
    const seen = await inspectApiPort(port)
    assert.equal(seen.state, 'other')
    const result = report(facts({
      ports: { badPort: false, api: port, apiState: 'busy', health: { reachable: false, db: null, url: seen.url } },
      database: dbOk(),
    }))
    assert.equal(result.code, 1)
    assert.equal(result.lines[1], otherProgram(port))
    assert.equal(
      result.lines[7],
      'info health: Skipped because the API port is used by another program.',
    )
    assert.doesNotMatch(result.lines[7], /npm run dev/)
    assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
  } finally {
    await close(server)
  }
})

test('API up and database down passes the port and fails the database', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', db: 'down' }))
  })
  const port = await listen(server)
  try {
    const seen = await inspectApiPort(port)
    assert.equal(seen.state, 'ours')
    assert.equal(seen.db, 'down')
    const result = report(facts({
      ports: { badPort: false, api: port, apiState: 'ours', health: { reachable: true, db: 'down', url: seen.url } },
      database: dbDown(),
    }))
    assert.equal(result.code, 1)
    assert.equal(result.lines[1], `pass ports: Port ${port} is already running.`)
    assert.match(result.lines[3], /^fail database:/)
    assert.match(result.lines[3], /docker compose up -d db/)
    assert.equal(result.lines[7], 'fail health: The health check says the database is down.')
    assert.doesNotMatch(result.lines.join('\n'), /another program/)
    assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
  } finally {
    await close(server)
  }
})

test('a healthy API passes every required check', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', db: 'up' }))
  })
  const port = await listen(server)
  try {
    const seen = await inspectApiPort(port)
    assert.equal(seen.state, 'ours')
    assert.equal(seen.db, 'up')
    const result = report(facts({
      ports: { badPort: false, api: port, apiState: 'ours', health: { reachable: true, db: 'up', url: seen.url } },
      database: dbOk(),
    }))
    assert.equal(result.code, 0)
    assert.equal(result.lines[1], `pass ports: Port ${port} is already running.`)
    assert.match(result.lines[3], /^pass database:/)
    assert.equal(result.lines[7], 'pass health: The health check says the database is up.')
    assert.ok(result.lines.every((line) => !hasDashPunctuation(line)))
  } finally {
    await close(server)
  }
})

test('OpenClaw staying unreachable does not fail the command', () => {
  const result = report(facts())
  assert.equal(result.code, 0)
  assert.match(result.lines[8], /^info openclaw:/)
  assert.doesNotMatch(result.lines[8], /^fail /)
  assert.match(result.lines[9], /^info bridge:/)
  assert.match(result.lines[10], /^info gateway:/)
  assert.doesNotMatch(result.lines[10], /^fail /)
})

test('gateway host defaults to host.docker.internal under Compose and 127.0.0.1 outside it', () => {
  assert.deepEqual(gatewayTarget({}), { host: '127.0.0.1', port: 18789 })
  assert.deepEqual(gatewayTarget({ MC_DOCTOR_DOCKER: '0' }), { host: '127.0.0.1', port: 18789 })
  assert.deepEqual(gatewayTarget({ MC_DOCTOR_DOCKER: '1' }), { host: 'host.docker.internal', port: 18789 })
  assert.deepEqual(
    gatewayTarget({ MC_DOCTOR_DOCKER: '1', OPENCLAW_GATEWAY_HOST: 'gateway.internal', OPENCLAW_GATEWAY_PORT: '19001' }),
    { host: 'gateway.internal', port: 19001 },
  )
  assert.deepEqual(
    gatewayTarget({ OPENCLAW_GATEWAY_HOST: 'gateway.internal', OPENCLAW_GATEWAY_PORT: '19001' }),
    { host: 'gateway.internal', port: 19001 },
  )
  assert.deepEqual(
    gatewayTarget({ MC_DOCTOR_DOCKER: '1', OPENCLAW_GATEWAY_HOST: 'not a host', OPENCLAW_GATEWAY_PORT: '0' }),
    { host: 'host.docker.internal', port: 18789 },
  )
  assert.deepEqual(
    gatewayTarget({ OPENCLAW_GATEWAY_HOST: 'not a host', OPENCLAW_GATEWAY_PORT: '70000' }),
    { host: '127.0.0.1', port: 18789 },
  )
  assert.equal(
    gatewayLine({}),
    'info gateway: The gateway probe uses 127.0.0.1 port 18789. Set OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT to change it.',
  )
  assert.equal(
    gatewayLine({ MC_DOCTOR_DOCKER: '1' }),
    'info gateway: Under Compose the gateway probe uses host.docker.internal port 18789. Set OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT to change it.',
  )
  const compose = report(facts({
    env: {
      HOST: '127.0.0.1',
      INGEST_TOKEN: 'change-me',
      PORT: '3000',
      MC_DOCTOR_DOCKER: '1',
      DASHBOARD_PASSWORD_HASH: 'scrypt:1',
      SESSION_SECRET: 'ab',
    },
  }))
  assert.equal(compose.code, 0)
  assert.match(compose.lines[10], /host\.docker\.internal port 18789/)
  assert.equal(hasDashPunctuation(compose.lines.join('\n')), false)
  assert.equal(
    effectiveEnv({ OPENCLAW_GATEWAY_HOST: 'gateway.internal' }, { OPENCLAW_GATEWAY_HOST: '10.0.0.4' }).OPENCLAW_GATEWAY_HOST,
    '10.0.0.4',
  )
  assert.equal(
    effectiveEnv({ OPENCLAW_GATEWAY_HOST: 'gateway.internal' }, { OPENCLAW_GATEWAY_HOST: '  ' }).OPENCLAW_GATEWAY_HOST,
    'gateway.internal',
  )
})

test('bridge sync age uses the limit and treats an equal age as recent', () => {
  assert.equal(bridgeStaleSeconds({}), 600)
  assert.equal(bridgeStaleSeconds({ MC_BRIDGE_STALE_SECONDS: '90' }), 90)
  assert.equal(bridgeStaleSeconds({ MC_BRIDGE_STALE_SECONDS: '0' }), 600)
  assert.equal(bridgeStaleSeconds({ MC_BRIDGE_STALE_SECONDS: 'nope' }), 600)
  const now = 1_700_000_000_000
  assert.equal(bridgeSyncState(String(now / 1000 - 600), 0, now, 600).state, 'fresh')
  assert.equal(bridgeSyncState(String(now / 1000 - 601), 0, now, 600).state, 'stale')
  assert.equal(bridgeSyncState('', now - 5000, now, 1).state, 'stale')
  assert.equal(bridgeSyncState('', now - 500, now, 1).state, 'fresh')
})

test('MC port environment wins over .env and a blank shell value does not', () => {
  const file = { MC_API_PORT: '3881', MC_WEB_PORT: '5881', MC_DB_PORT: '55881', PORT: '3000' }
  const over = effectiveEnv(file, { MC_API_PORT: '3880', MC_WEB_PORT: '5880', MC_DB_PORT: '55880' })
  assert.equal(over.MC_API_PORT, '3880')
  assert.equal(over.MC_WEB_PORT, '5880')
  assert.equal(over.MC_DB_PORT, '55880')
  assert.equal(effectiveEnv(file, { MC_API_PORT: '  ' }).MC_API_PORT, '3881')
  assert.equal(
    effectiveEnv(
      { DASHBOARD_PASSWORD_HASH: 'scrypt:file', SESSION_SECRET: 'file-secret' },
      { DASHBOARD_PASSWORD_HASH: '', SESSION_SECRET: '   ' },
    ).DASHBOARD_PASSWORD_HASH,
    'scrypt:file',
  )
  assert.equal(
    effectiveEnv(
      { DASHBOARD_PASSWORD_HASH: 'scrypt:file', SESSION_SECRET: 'file-secret' },
      { DASHBOARD_PASSWORD_HASH: '', SESSION_SECRET: '   ' },
    ).SESSION_SECRET,
    'file-secret',
  )
  assert.equal(
    effectiveEnv(
      { DASHBOARD_PASSWORD_HASH: 'scrypt:file', SESSION_SECRET: 'file-secret' },
      { DASHBOARD_PASSWORD_HASH: 'scrypt:proc', SESSION_SECRET: 'proc-secret' },
    ).SESSION_SECRET,
    'proc-secret',
  )
  assert.equal(
    effectiveEnv({ MC_BRIDGE_STALE_SECONDS: '90' }, { MC_BRIDGE_STALE_SECONDS: '  ' }).MC_BRIDGE_STALE_SECONDS,
    '90',
  )
  assert.equal(effectiveEnv({ MC_BRIDGE_STALE_SECONDS: '90' }, { MC_BRIDGE_STALE_SECONDS: '120' }).MC_BRIDGE_STALE_SECONDS, '120')
  assert.equal(effectiveEnv(file, {}).MC_WEB_PORT, '5881')
  assert.equal(apiListenPort({ MC_DOCTOR_DOCKER: '1', ...over }), 3880)
  assert.equal(apiListenPort({ MC_DOCTOR_DOCKER: '1', PORT: '3000' }), 3000)
})

test('docker mode uses MC_API_PORT and native mode keeps PORT', () => {
  assert.equal(apiListenPort({ MC_DOCTOR_DOCKER: '1', PORT: '3000' }), 3000)
  assert.equal(apiListenPort({ MC_DOCTOR_DOCKER: '1', PORT: '3000', MC_API_PORT: '3880' }), 3880)
  assert.equal(apiListenPort({ PORT: '3000', MC_API_PORT: '3880' }), 3000)
  assert.equal(apiListenPort({ MC_DOCTOR_DOCKER: '1', MC_API_PORT: 'nope' }), null)
})

test('docker doctor uses the shell MC_API_PORT when .env names a different port', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-doctor-env-'))
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', status: 'ok', database: 'connected', db: 'up' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    writeFileSync(
      path.join(dir, '.env'),
      ['PORT=3000', 'MC_API_PORT=3000', 'HOST=127.0.0.1', 'INGEST_TOKEN=abc123', 'DASHBOARD_PASSWORD_HASH=scrypt:16384:8:1:aabb:ccdd', 'SESSION_SECRET=001122', 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:59999/mission_control', ''].join('\n'),
    )
    const result = await runDoctor(dir, { MC_DOCTOR_DOCKER: '1', MC_API_PORT: String(port) })
    assert.equal(result.code, 0, result.lines.join('\n'))
    assert.match(result.lines[1], new RegExp(`^pass ports: Port ${port} is already running\\.$`))
    assert.equal(result.lines.some((line) => /Port 3000/.test(line)), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docker doctor reports host database checks as info and checks the custom API port', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-doctor-'))
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        service: 'mission-control',
        status: 'ok',
        database: 'connected',
        db: 'up',
      }),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    writeFileSync(
      path.join(dir, '.env'),
      [
        'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:59999/mission_control',
        'PORT=3000',
        `MC_API_PORT=${port}`,
        'HOST=127.0.0.1',
        'INGEST_TOKEN=abc123',
        'DASHBOARD_PASSWORD_HASH=scrypt:16384:8:1:aabb:ccdd',
        'SESSION_SECRET=001122',
        '',
      ].join('\n'),
    )
    const result = await runDoctor(dir, { MC_DOCTOR_DOCKER: '1' })
    assert.equal(result.code, 0, result.lines.join('\n'))
    assert.equal(result.lines.some((line) => line.startsWith('fail ')), false)
    assert.match(result.lines[1], new RegExp(`^pass ports: Port ${port} is already running\\.$`))
    assert.match(result.lines[3], /^info database: /)
    assert.match(result.lines[4], /^info migrations: /)
    assert.equal(result.lines[7], 'pass health: The health check says the database is up.')
    assert.equal(result.lines.some((line) => /Port 3000/.test(line)), false)
    for (const line of result.lines) assert.equal(hasDashPunctuation(line), false, line)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

function isolatedSchedule(dir, installed) {
  const systemdDir = path.join(dir, installed ? 'systemd-on' : 'systemd-off')
  const launchDir = path.join(dir, installed ? 'launch-on' : 'launch-off')
  mkdirSync(systemdDir, { recursive: true })
  mkdirSync(launchDir, { recursive: true })
  if (installed) {
    writeFileSync(path.join(systemdDir, 'mission-control-bridge.timer'), '[Timer]\nOnUnitActiveSec=300s\n')
  }
  return {
    MC_BRIDGE_SYSTEMD_DIR: systemdDir,
    MC_BRIDGE_LAUNCHD_DIR: launchDir,
    MC_BRIDGE_CRON_MARK: 'mission-control-bridge-test',
  }
}

test('bridge sync: a stale timestamp fails doctor', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-doctor-stale-'))
  const stamp = path.join(dir, 'last-sync')
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', status: 'ok', database: 'connected', db: 'up' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    writeFileSync(stamp, `${Math.floor(Date.now() / 1000) - 5000}\n`)
    writeFileSync(
      path.join(dir, '.env'),
      ['PORT=3000', `MC_API_PORT=${port}`, 'HOST=127.0.0.1', 'INGEST_TOKEN=abc123', 'DASHBOARD_PASSWORD_HASH=scrypt:16384:8:1:aabb:ccdd', 'SESSION_SECRET=001122', 'MC_BRIDGE_STALE_SECONDS=600', ''].join('\n'),
    )
    const result = await runDoctor(dir, {
      MC_DOCTOR_DOCKER: '1',
      MC_BRIDGE_STAMP_FILE: stamp,
      ...isolatedSchedule(dir, true),
    })
    assert.equal(result.code, 1, result.lines.join('\n'))
    const fails = result.lines.filter((line) => line.startsWith('fail '))
    assert.deepEqual(fails, [
      'fail bridge: The last OpenClaw sync is older than 600 seconds. Run python3 bridge/mc-bridge-sync.py and confirm the schedule is installed.',
    ])
    assert.match(result.lines[8], /^info openclaw:/)
    for (const line of result.lines) assert.equal(hasDashPunctuation(line), false, line)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('bridge sync: a fresh timestamp passes and a missing timestamp stays informational', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-doctor-fresh-'))
  const stamp = path.join(dir, 'last-sync')
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', status: 'ok', database: 'connected', db: 'up' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    writeFileSync(
      path.join(dir, '.env'),
      ['PORT=3000', `MC_API_PORT=${port}`, 'HOST=127.0.0.1', 'INGEST_TOKEN=abc123', 'DASHBOARD_PASSWORD_HASH=scrypt:16384:8:1:aabb:ccdd', 'SESSION_SECRET=001122', 'MC_BRIDGE_STALE_SECONDS=30', ''].join('\n'),
    )
    const missing = await runDoctor(dir, { MC_DOCTOR_DOCKER: '1' })
    assert.equal(missing.code, 0, missing.lines.join('\n'))
    assert.match(missing.lines[9], /^info bridge: No OpenClaw sync timestamp was found/)

    writeFileSync(stamp, `${Math.floor(Date.now() / 1000) - 5}\n`)
    const fresh = await runDoctor(dir, {
      MC_DOCTOR_DOCKER: '1',
      MC_BRIDGE_STAMP_FILE: stamp,
      MC_BRIDGE_STALE_SECONDS: '30',
    })
    assert.equal(fresh.code, 0, fresh.lines.join('\n'))
    assert.match(fresh.lines[9], /^pass bridge: The last OpenClaw sync is recent\./)

    writeFileSync(stamp, `${Math.floor(Date.now() / 1000) - 120}\n`)
    const stale = await runDoctor(dir, {
      MC_DOCTOR_DOCKER: '1',
      MC_BRIDGE_STAMP_FILE: stamp,
      MC_BRIDGE_STALE_SECONDS: '30',
      ...isolatedSchedule(dir, true),
    })
    assert.equal(stale.code, 1, stale.lines.join('\n'))
    assert.match(stale.lines[9], /^fail bridge: The last OpenClaw sync is older than 30 seconds\./)

    const unscheduled = await runDoctor(dir, {
      MC_DOCTOR_DOCKER: '1',
      MC_BRIDGE_STAMP_FILE: stamp,
      MC_BRIDGE_STALE_SECONDS: '30',
      ...isolatedSchedule(dir, false),
    })
    assert.equal(unscheduled.code, 0, unscheduled.lines.join('\n'))
    assert.match(unscheduled.lines[9], /^info bridge: The last OpenClaw sync is older than 30 seconds\. No bridge schedule is installed\./)
    for (const line of stale.lines) assert.equal(hasDashPunctuation(line), false, line)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docs point at npm run doctor and do not use dash punctuation in that guidance', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  const onboarding = readFileSync(path.join(root, 'docs/OPENCLAW_ONBOARDING.md'), 'utf8')
  assert.match(readme, /npm run doctor/)
  assert.match(onboarding, /npm run doctor/)
  const readmeLine = readme.split('\n').find((line) => line.includes('npm run doctor'))
  const onboardingLine = onboarding.split('\n').find((line) => line.includes('npm run doctor'))
  assert.equal(hasDashPunctuation(readmeLine), false)
  assert.equal(hasDashPunctuation(onboardingLine), false)
})
