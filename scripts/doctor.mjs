/**
 * Setup diagnostics for Mission Control.
 *
 * One line per check. A required failure exits 1. OpenClaw is informational
 * and never changes the exit code. Run from the repo root: npm run doctor
 *
 * Token rules match apps/api/src/auth/write-token.ts.
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const WEB_PORT = 5173

export const FIX_ENV = 'cp .env.example .env'
export const FIX_DATABASE = 'docker compose up -d db'
export const FIX_MIGRATIONS = '(cd apps/api && npx prisma migrate deploy)'
export const FIX_TOKEN = 'openssl rand -hex 24'
export const FIX_HEALTH = 'npm run dev'
export const FIX_NODE =
  'Install Node.js 20.17 or newer, or Node.js 22.9 or newer, then run npm run doctor again.'

export function portFix(port) {
  return `lsof -nP -iTCP:${port} -sTCP:LISTEN`
}

/** Em dash and en dash are dash punctuation. CLI flags are not. */
export function hasDashPunctuation(text) {
  return /[\u2012\u2013\u2014\u2015]/.test(text)
}

export function nodeSupported(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major === 20) return minor >= 17
  if (major === 22) return minor >= 9
  return false
}

export function bindHost(env) {
  const raw = env.HOST
  if (typeof raw !== 'string') return '127.0.0.1'
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : '127.0.0.1'
}

export function configuredToken(env) {
  const raw = env.INGEST_TOKEN
  if (typeof raw !== 'string') return null
  if (raw.trim() === '') return null
  return raw
}

export function isLoopbackHost(host) {
  const bare = host.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (bare === 'localhost' || bare === '::1') return true
  const parts = bare.split('.')
  if (parts.length !== 4) return false
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return false
  return nums[0] === 127
}

/**
 * ok when a token is set, or when loopback has no token outside production.
 * Production with no token fails closed. Any other bind with no token refuses to start.
 */
export function tokenState(env) {
  const host = bindHost(env)
  const token = configuredToken(env)
  if (!token && !isLoopbackHost(host)) return { ok: false, kind: 'off-loopback', host }
  if (!token && env.NODE_ENV === 'production') return { ok: false, kind: 'production', host }
  return { ok: true, kind: token ? 'set' : 'loopback-open', host }
}

export function loadEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  const text = readFileSync(file, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    let value = body.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** File values, then the process environment wins when a key is set (including blank). */
export function effectiveEnv(fileEnv, processEnv = process.env) {
  const env = { ...fileEnv }
  for (const key of ['DATABASE_URL', 'PORT', 'HOST', 'INGEST_TOKEN', 'NODE_ENV']) {
    if (processEnv[key] !== undefined) env[key] = processEnv[key]
  }
  return env
}

export function parseDatabaseUrl(raw) {
  const normalized = String(raw).replace(/^postgresql:/i, 'http:').replace(/^postgres:/i, 'http:')
  const url = new URL(normalized)
  const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] ?? '')
  return {
    host: url.hostname,
    port: url.port || '5432',
    database,
  }
}

function apiPort(env) {
  const raw = typeof env.PORT === 'string' ? env.PORT.trim() : ''
  if (!raw) return 3000
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

function probeHost(host) {
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1'
  return host
}

function listenFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}

async function httpGet(url, ms = 2500) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch {
    return { ok: false, status: 0, text: '' }
  } finally {
    clearTimeout(timer)
  }
}

function isMissionControlHealth(text) {
  try {
    const body = JSON.parse(text)
    return Boolean(
      body &&
        typeof body.status === 'string' &&
        typeof body.database === 'string' &&
        typeof body.uptimeSeconds === 'number',
    )
  } catch {
    return false
  }
}

/** Nest's unhandled error body, for example {"statusCode":500,"message":"Internal server error"}. */
function isNestServerError(res) {
  if (!res || res.status < 500 || res.status > 599) return false
  let body
  try {
    body = JSON.parse(res.text)
  } catch {
    return false
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const code = body.statusCode
  if (typeof code !== 'number' || code < 500 || code > 599) return false
  return typeof body.message === 'string' && body.message.length > 0
}

/**
 * A refused connection means the API is not running.
 * The Mission Control health JSON is this API.
 * A Nest 5xx JSON body is this API only when the database check also failed.
 * Every other response is a stranger on the port.
 */
export function interpretHealthResponse(res, databaseFailed = false) {
  if (!res || res.status === 0) return { kind: 'down' }
  if (isMissionControlHealth(res.text)) {
    try {
      const body = JSON.parse(res.text)
      if (body.database !== 'connected') return { kind: 'database-down' }
    } catch {
      return { kind: 'stranger' }
    }
    return { kind: 'up' }
  }
  if (databaseFailed && isNestServerError(res)) return { kind: 'database-down' }
  return { kind: 'stranger' }
}

/** Fold the database check into the port probe. A stranger stays busy. */
export function applyDatabaseToPorts(ports, database) {
  if (ports.badPort || !ports.probe) return ports
  const databaseFailed = database?.state !== 'ok'
  const kind = interpretHealthResponse(ports.probe, databaseFailed)
  if (kind.kind === 'up' || kind.kind === 'database-down') {
    return {
      ...ports,
      apiState: 'ours',
      health: {
        reachable: kind.kind === 'up',
        databaseDown: kind.kind === 'database-down',
        url: ports.healthUrl,
        body: ports.probe.text,
      },
    }
  }
  return {
    ...ports,
    apiState: 'busy',
    health: {
      reachable: false,
      databaseDown: false,
      url: ports.healthUrl,
      body: '',
    },
  }
}

function isMissionControlWeb(text) {
  return text.includes('Mission Control') && text.includes('id="root"')
}

function loadPg(root) {
  const candidates = [
    path.join(root, 'apps/api/package.json'),
    path.join(root, 'package.json'),
  ]
  for (const from of candidates) {
    if (!existsSync(from)) continue
    try {
      return createRequire(from)('pg')
    } catch {
      // Try the next location. A fresh tree may not have installed yet.
    }
  }
  return null
}

function migrationNames(root) {
  const dir = path.join(root, 'apps/api/prisma/migrations')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() && existsSync(path.join(full, 'migration.sql'))
    })
    .sort()
}

function which(command) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', `command -v ${command}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', (code) => {
      resolve(code === 0 ? out.trim() : '')
    })
    child.on('error', () => resolve(''))
  })
}

async function openclawDetail() {
  const bin = await which('openclaw')
  if (!bin) {
    return 'OpenClaw is optional. The openclaw command is not on PATH, so the bridge was not reached. Sample data does not need it.'
  }
  return 'OpenClaw is optional. The openclaw command is on PATH. Bridge reachability does not affect this check.'
}

async function databaseFacts(root, env) {
  const raw = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : ''
  if (!raw) {
    return {
      state: 'missing-url',
      detail: '',
      migrations: 'unknown',
      pending: [],
    }
  }
  let where
  try {
    where = parseDatabaseUrl(raw)
  } catch {
    return {
      state: 'bad-url',
      detail: '',
      migrations: 'unknown',
      pending: [],
    }
  }
  const place = `${where.host}:${where.port}`
  const pg = loadPg(root)
  if (!pg) {
    return {
      state: 'no-client',
      detail: place,
      migrations: 'unknown',
      pending: [],
    }
  }
  let client
  try {
    client = new pg.Client({ connectionString: raw, connectionTimeoutMillis: 4000 })
    await client.connect()
    await client.query('SELECT 1')
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    let state = 'unreachable'
    if (code === '3D000') state = 'missing-db'
    else if (code === '28P01' || code === '28000') state = 'auth'
    return {
      state,
      detail: place,
      database: where.database,
      migrations: 'unknown',
      pending: [],
    }
  }
  const local = migrationNames(root)
  try {
    const rows = await client.query(
      'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
    )
    const applied = new Set(
      rows.rows
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    )
    const pending = local.filter((name) => !applied.has(name))
    const failed = rows.rows.some((row) => !row.finished_at || row.rolled_back_at)
    if (pending.length || failed) {
      return {
        state: 'ok',
        detail: place,
        database: where.database,
        migrations: 'pending',
        pending: pending.length ? pending : ['a failed migration'],
      }
    }
    return {
      state: 'ok',
      detail: place,
      database: where.database,
      migrations: 'current',
      pending: [],
    }
  } catch (err) {
    const code = err && typeof err === 'object' ? err.code : ''
    if (code === '42P01') {
      return {
        state: 'ok',
        detail: place,
        database: where.database,
        migrations: 'pending',
        pending: local.length ? local : ['the initial migration'],
      }
    }
    return {
      state: 'ok',
      detail: place,
      database: where.database,
      migrations: 'pending',
      pending: ['the migration table'],
    }
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

async function portFacts(env) {
  const port = apiPort(env)
  const host = probeHost(bindHost(env))
  if (port == null) {
    return { badPort: true, api: null, web: null, apiState: 'busy', webState: 'busy', health: null }
  }
  const apiFree = await listenFree(port, host === 'localhost' ? '127.0.0.1' : host)
  const webFree = await listenFree(WEB_PORT, '127.0.0.1')
  let apiState = apiFree ? 'free' : 'busy'
  let webState = webFree ? 'free' : 'busy'
  const healthUrl = `http://${host}:${port}/health`
  let probe = null
  const health = { reachable: false, databaseDown: false, url: healthUrl, body: '' }
  if (!apiFree) probe = await httpGet(healthUrl)
  if (!webFree) {
    const res = await httpGet(`http://127.0.0.1:${WEB_PORT}/`)
    if (res.ok && isMissionControlWeb(res.text)) webState = 'ours'
  }
  return { badPort: false, api: port, web: WEB_PORT, apiState, webState, health, probe, healthUrl }
}

export async function gather(root, processEnv = process.env) {
  const envFile = path.join(root, '.env')
  const envExists = existsSync(envFile)
  const env = effectiveEnv(loadEnvFile(envFile), processEnv)
  const [rawPorts, database, openclaw] = await Promise.all([
    portFacts(env),
    databaseFacts(root, env),
    openclawDetail(),
  ])
  return {
    nodeVersion: process.version,
    envExists,
    env,
    ports: applyDatabaseToPorts(rawPorts, database),
    database,
    openclaw,
  }
}

function portLine(ports) {
  if (ports.badPort) {
    return 'fail ports: PORT is not a valid port number. Set PORT in .env to a free port, then run npm run doctor again.'
  }
  const busy = []
  if (ports.apiState === 'busy') busy.push(ports.api)
  if (ports.webState === 'busy') busy.push(ports.web)
  if (busy.length === 1) {
    return `fail ports: Port ${busy[0]} is in use. Free it, then start again. Find the listener with: ${portFix(busy[0])}`
  }
  if (busy.length > 1) {
    const commands = busy.map((port) => portFix(port)).join(' ; ')
    return `fail ports: Ports ${busy.join(' and ')} are in use. Free them, then start again. Find the listeners with: ${commands}`
  }
  const apiText =
    ports.apiState === 'free'
      ? `Port ${ports.api} is free`
      : `Port ${ports.api} is serving the Mission Control API`
  const webText =
    ports.webState === 'free'
      ? `port ${ports.web} is free`
      : `port ${ports.web} is serving the Mission Control web app`
  if (ports.apiState === 'free' && ports.webState === 'free') {
    return `pass ports: Required ports are free (${ports.api} and ${ports.web}).`
  }
  return `pass ports: Required ports are ready. ${apiText} and ${webText}.`
}

function databaseLine(database) {
  if (database.state === 'ok') return 'pass database: The database is reachable.'
  if (database.state === 'missing-url') {
    return `fail database: DATABASE_URL is not set. Create .env with: ${FIX_ENV}`
  }
  if (database.state === 'bad-url') {
    return 'fail database: DATABASE_URL could not be read. Set it to the value in .env.example, then run npm run doctor again.'
  }
  if (database.state === 'no-client') {
    return 'fail database: The database client is not installed, so the database was not checked. Install dependencies with: npm ci'
  }
  if (database.state === 'missing-db') {
    return `fail database: The database ${database.database} does not exist at ${database.detail}. Start Postgres with: ${FIX_DATABASE}`
  }
  if (database.state === 'auth') {
    return 'fail database: The database rejected the login in DATABASE_URL. Use the local default from .env.example (user postgres, password postgres), or correct DATABASE_URL, then run npm run doctor again.'
  }
  return `fail database: The database is not reachable at ${database.detail}. Start Postgres with: ${FIX_DATABASE}`
}

function migrationsLine(database) {
  if (database.migrations === 'current') return 'pass migrations: Migrations are current.'
  if (database.migrations === 'pending') {
    const names = database.pending.join(', ')
    return `fail migrations: Migrations are pending (${names}). Apply them with: ${FIX_MIGRATIONS}`
  }
  return `fail migrations: Migrations were not checked because the database is not reachable. After the database is up, run: ${FIX_MIGRATIONS}`
}

function tokenLine(env) {
  const state = tokenState(env)
  if (state.kind === 'off-loopback') {
    return `fail token: HOST is ${state.host}, which is not loopback, and INGEST_TOKEN is not set. The API refuses to start. Set INGEST_TOKEN in .env. Generate one with: ${FIX_TOKEN}`
  }
  if (state.kind === 'production') {
    return `fail token: NODE_ENV is production and INGEST_TOKEN is not set. Every write returns 401. Set INGEST_TOKEN in .env. Generate one with: ${FIX_TOKEN}`
  }
  if (state.kind === 'loopback-open') {
    return 'pass token: Token configuration is valid. HOST is loopback and INGEST_TOKEN is not set, so writes stay open outside production.'
  }
  return `pass token: Token configuration is valid for ${state.host}.`
}

function healthLine(ports) {
  const url = ports.health?.url ?? 'http://127.0.0.1:3000/health'
  if (ports.health?.databaseDown) {
    return `fail health: The API is running at ${url} but the database is down. Start Postgres with: ${FIX_DATABASE}`
  }
  if (ports.health?.reachable) return `pass health: The API health endpoint is reachable at ${url}.`
  return `fail health: The API health endpoint is not reachable at ${url}. Start the API and the web app with: ${FIX_HEALTH}`
}

export function report(facts) {
  const lines = [
    nodeSupported(facts.nodeVersion)
      ? `pass node: Node ${facts.nodeVersion} is supported.`
      : `fail node: Node ${facts.nodeVersion} is not supported. ${FIX_NODE}`,
    portLine(facts.ports),
    facts.envExists ? 'pass env: .env is present.' : `fail env: .env is missing. Create it with: ${FIX_ENV}`,
    databaseLine(facts.database),
    migrationsLine(facts.database),
    tokenLine(facts.env),
    healthLine(facts.ports),
    `info openclaw: ${facts.openclaw}`,
  ]
  const code = lines.some((line) => line.startsWith('fail ')) ? 1 : 0
  return { lines, code }
}

export async function runDoctor(root = process.cwd(), processEnv = process.env) {
  const facts = await gather(root, processEnv)
  return report(facts)
}

async function main() {
  const { lines, code } = await runDoctor(process.cwd())
  for (const line of lines) console.log(line)
  process.exit(code)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`fail doctor: The check could not finish. ${message}`)
    process.exit(1)
  })
}
