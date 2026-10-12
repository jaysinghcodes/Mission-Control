import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { readFileSync } from 'node:fs'
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
  hasDashPunctuation,
  inspectApiPort,
  nodeSupported,
  readHealthIdentity,
  report,
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
  assert.equal(result.lines.length, 8)
  assert.ok(result.lines.every((line) => !hasDashPunctuation(line)))
  assert.match(result.lines[0], /^pass node:/)
  assert.match(result.lines[1], /^pass ports: Port 3000 is already running\.$/)
  assert.match(result.lines[6], /^pass health: The health check says the database is up\.$/)
  assert.match(result.lines[2], /^pass env:/)
  assert.match(result.lines[3], /^pass database:/)
  assert.match(result.lines[4], /^pass migrations:/)
  assert.match(result.lines[5], /^pass token:/)
  assert.match(result.lines[7], /^info openclaw: OpenClaw is optional/)
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
        result.lines[6],
        'info health: Skipped because the API port is used by another program.',
      )
      assert.doesNotMatch(result.lines[6], /npm run dev/)
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
      result.lines[6],
      'info health: Skipped because the API port is used by another program.',
    )
    assert.doesNotMatch(result.lines[6], /npm run dev/)
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
        result.lines[6],
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
      result.lines[6],
      'info health: Skipped because the API port is used by another program.',
    )
    assert.doesNotMatch(result.lines[6], /npm run dev/)
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
    assert.equal(result.lines[6], 'fail health: The health check says the database is down.')
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
    assert.equal(result.lines[6], 'pass health: The health check says the database is up.')
    assert.ok(result.lines.every((line) => !hasDashPunctuation(line)))
  } finally {
    await close(server)
  }
})

test('OpenClaw staying unreachable does not fail the command', () => {
  const result = report(facts())
  assert.equal(result.code, 0)
  assert.match(result.lines[7], /^info openclaw:/)
  assert.doesNotMatch(result.lines[7], /^fail /)
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
