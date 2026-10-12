import assert from 'node:assert/strict'
import http from 'node:http'
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
  applyDatabaseToPorts,
  hasDashPunctuation,
  interpretHealthResponse,
  nodeSupported,
  portFix,
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
      web: 5173,
      apiState: 'free',
      webState: 'free',
      health: { reachable: true, url: 'http://127.0.0.1:3000/health' },
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
  assert.match(result.lines[1], /^pass ports: Required ports are free/)
  assert.match(result.lines[2], /^pass env:/)
  assert.match(result.lines[3], /^pass database:/)
  assert.match(result.lines[4], /^pass migrations:/)
  assert.match(result.lines[5], /^pass token:/)
  assert.match(result.lines[6], /^pass health:/)
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
          web: 5173,
          apiState: 'busy',
          webState: 'free',
          health: { reachable: false, url: 'http://127.0.0.1:3000/health' },
        },
      }),
      includes: portFix(3000),
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
          web: 5173,
          apiState: 'free',
          webState: 'free',
          health: { reachable: false, url: 'http://127.0.0.1:3000/health' },
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
  }
})

const NEST_500 = JSON.stringify({ statusCode: 500, message: 'Internal server error' })
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rawPorts(port, probe) {
  const url = `http://127.0.0.1:${port}/health`
  return {
    badPort: false,
    api: port,
    web: 5173,
    apiState: 'busy',
    webState: 'free',
    healthUrl: url,
    probe,
    health: { reachable: false, databaseDown: false, url, body: '' },
  }
}

function reported(port, probe, database) {
  const ports = applyDatabaseToPorts(rawPorts(port, probe), database)
  return { ports, result: report(facts({ ports, database })) }
}

function assertStranger(result, port) {
  assert.equal(result.code, 1)
  assert.match(result.lines[1], new RegExp(`^fail ports: Port ${port} is in use\\.`))
  assert.match(result.lines[1], new RegExp(escapeRegExp(portFix(port))))
  assert.match(result.lines[3], /^pass database:/)
  assert.doesNotMatch(result.lines.join('\n'), /database is down/)
  assert.doesNotMatch(result.lines.join('\n'), /serving the Mission Control API/)
  assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
}

async function serve(status, body, type) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-type': type })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const live = await fetch(`http://127.0.0.1:${port}/health`)
  const probe = { ok: live.ok, status: live.status, text: await live.text() }
  await new Promise((resolve) => server.close(resolve))
  return { port, probe }
}

test('a stranger 404 HTML page fails the port check', async () => {
  const { port, probe } = await serve(404, HTML_404, 'text/html')
  assert.equal(probe.status, 404)
  assert.equal(interpretHealthResponse(probe, false).kind, 'stranger')
  assert.equal(interpretHealthResponse(probe, true).kind, 'stranger')
  const { result } = reported(port, probe, dbOk())
  assertStranger(result, port)
})

test('a stranger 500 text body fails the port check', async () => {
  const { port, probe } = await serve(500, 'oops', 'text/plain')
  assert.equal(probe.status, 500)
  assert.equal(probe.text, 'oops')
  assert.equal(interpretHealthResponse(probe, false).kind, 'stranger')
  assert.equal(interpretHealthResponse(probe, true).kind, 'stranger')
  const { result } = reported(port, probe, dbOk())
  assertStranger(result, port)
})

test('a Nest 500 with the database up is a stranger', async () => {
  const { port, probe } = await serve(500, NEST_500, 'application/json')
  assert.equal(interpretHealthResponse(probe, false).kind, 'stranger')
  const { ports, result } = reported(port, probe, dbOk())
  assert.equal(ports.health.databaseDown, false)
  assert.equal(ports.apiState, 'busy')
  assertStranger(result, port)
})

test('API up and database down keeps the API port and names the database', async () => {
  const { port, probe } = await serve(500, NEST_500, 'application/json')
  assert.equal(interpretHealthResponse(probe, true).kind, 'database-down')
  assert.equal(
    interpretHealthResponse({
      ok: true,
      status: 200,
      text: JSON.stringify({ status: 'ok', database: 'connected', uptimeSeconds: 1 }),
    }, false).kind,
    'up',
  )
  assert.equal(interpretHealthResponse({ ok: false, status: 0, text: '' }, true).kind, 'down')
  assert.equal(interpretHealthResponse({ ok: true, status: 200, text: 'not the api' }, true).kind, 'stranger')
  const { ports, result } = reported(port, probe, dbDown())
  assert.equal(ports.apiState, 'ours')
  assert.equal(ports.health.databaseDown, true)
  assert.equal(result.code, 1)
  assert.match(result.lines[1], /^pass ports:/)
  assert.match(result.lines[1], /serving the Mission Control API/)
  assert.doesNotMatch(result.lines[1], /in use/)
  assert.match(result.lines[3], new RegExp(escapeRegExp(FIX_DATABASE)))
  assert.match(
    result.lines[6],
    new RegExp(
      `^fail health: The API is running at http://127\\.0\\.0\\.1:${port}/health but the database is down\\. Start Postgres with: ${escapeRegExp(FIX_DATABASE)}$`,
    ),
  )
  assert.doesNotMatch(result.lines[6], /npm run dev/)
  assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
})

test('ports held by Mission Control are not a conflict', () => {
  const result = report(facts({
    ports: {
      badPort: false,
      api: 3000,
      web: 5173,
      apiState: 'ours',
      webState: 'ours',
      health: { reachable: true, url: 'http://127.0.0.1:3000/health' },
    },
  }))
  assert.equal(result.code, 0)
  assert.match(result.lines[1], /serving the Mission Control API/)
  assert.match(result.lines[1], /serving the Mission Control web app/)
  assert.equal(hasDashPunctuation(result.lines.join('\n')), false)
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
