/**
 * Setup diagnostics for Mission Control.
 *
 * One line per check. A required failure exits 1. The OpenClaw command
 * line is informational. A sync timestamp older than MC_BRIDGE_STALE_SECONDS
 * fails the command when a bridge schedule is installed. With no schedule,
 * that age stays an info line. Run from the repo root: npm run doctor
 *
 * Token rules match apps/api/src/auth/write-token.ts.
 * Login rules match apps/api/src/auth/password.ts. Compose (MC_DOCTOR_DOCKER=1)
 * counts as exposed even when .env HOST is loopback, because the container
 * peer is the Docker bridge. Compose does not check the host Node version
 * and prints no node line.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FIX_ENV = 'cp .env.example .env'
export const FIX_DATABASE = 'docker compose up -d db'
export const FIX_MIGRATIONS = '(cd apps/api && npx prisma migrate deploy)'
export const FIX_TOKEN = 'openssl rand -hex 24'
export const FIX_HEALTH = 'npm run dev'
export const FIX_NODE =
  "Node 20.17 or later is needed for the native install. Docker installs don't need Node."

export function portFix(port) {
  return `lsof -nP -iTCP:${port} -sTCP:LISTEN`
}

/** Em dash and en dash are dash punctuation. CLI flags are not. */
export function hasDashPunctuation(text) {
  return /[\u2012\u2013\u2014\u2015]/.test(text)
}

const MIN_NATIVE_NODE = [20, 17, 0]

/** major.minor.patch as numbers. Missing minor or patch counts as 0. */
export function parseNodeVersion(version) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version).trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function compareNodeParts(left, right) {
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1
    if (left[i] < right[i]) return -1
  }
  return 0
}

/** Native installs accept Node 20.17.0 or later. There is no upper bound. */
export function nodeSupported(version) {
  const parsed = parseNodeVersion(version)
  if (!parsed) return false
  return compareNodeParts(parsed, MIN_NATIVE_NODE) >= 0
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

/**
 * A password is required when HOST is not loopback, and when Compose is in
 * use. The published port is not loopback inside the api container.
 */
export function loginState(env) {
  const hash = configuredValue(env, 'DASHBOARD_PASSWORD_HASH')
  const secret = configuredValue(env, 'SESSION_SECRET')
  const exposed = env.MC_DOCTOR_DOCKER === '1' || !isLoopbackHost(bindHost(env))
  if (hash && secret) return { ok: true, kind: 'set', exposed }
  if (exposed) return { ok: false, kind: 'exposed', exposed }
  return { ok: true, kind: 'loopback-open', exposed }
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

const MC_PORT_KEYS = ['MC_API_PORT', 'MC_WEB_PORT', 'MC_DB_PORT']
const MC_BLANK_FALLTHROUGH = [
  ...MC_PORT_KEYS,
  'MC_BRIDGE_STALE_SECONDS',
  'MC_BRIDGE_STAMP_FILE',
  'MC_BRIDGE_INTERVAL_SECONDS',
  'MC_BRIDGE_SYSTEMD_DIR',
  'MC_BRIDGE_LAUNCHD_DIR',
  'MC_BRIDGE_UNIT_NAME',
  'MC_BRIDGE_LAUNCHD_LABEL',
  'MC_BRIDGE_CRON_MARK',
  'DASHBOARD_PASSWORD_HASH',
  'SESSION_SECRET',
  'OPENCLAW_GATEWAY_HOST',
  'OPENCLAW_GATEWAY_PORT',
]

/**
 * File values fill in first. A set process value wins, including a blank,
 * except the keys in MC_BLANK_FALLTHROUGH. A blank there falls through to
 * the file. That includes the dashboard hash and session secret, so a
 * parent shell that sourced an empty template does not hide the values
 * bash install.sh just wrote.
 */
export function effectiveEnv(fileEnv, processEnv = process.env) {
  const env = { ...fileEnv }
  for (const key of ['DATABASE_URL', 'PORT', 'HOST', 'INGEST_TOKEN', 'NODE_ENV', 'MC_DOCTOR_DOCKER', 'DASHBOARD_PASSWORD_HASH', 'SESSION_SECRET', 'TRUSTED_PROXY', 'MC_INSTALL_HEALTH_PORT', ...MC_BLANK_FALLTHROUGH]) {
    if (processEnv[key] === undefined) continue
    if (MC_BLANK_FALLTHROUGH.includes(key) && String(processEnv[key]).trim() === '') continue
    env[key] = processEnv[key]
  }
  return env
}

export function dockerRequested(env) {
  return env.MC_DOCTOR_DOCKER === '1'
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

function parsePort(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback
  const port = Number(raw.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

/**
 * Compose publishes the API on MC_API_PORT.
 * Native listens on PORT. MC_API_PORT is accepted when PORT is unset.
 * When both are set, PORT wins.
 */
export function apiListenPort(env) {
  if (dockerRequested(env)) return parsePort(env.MC_API_PORT, 3000)
  if (typeof env.PORT === 'string' && env.PORT.trim() !== '') return parsePort(env.PORT, 3000)
  return parsePort(env.MC_API_PORT, 3000)
}

/**
 * Test seam. MC_INSTALL_HEALTH_PORT is the socket to probe.
 * The reported port stays the resolved listen port.
 */
export function healthProbePort(logical, env) {
  const raw = env.MC_INSTALL_HEALTH_PORT
  if (typeof raw !== 'string' || raw.trim() === '') return logical
  const port = parsePort(raw, logical)
  return port == null ? logical : port
}

function composeServices(root) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['compose', 'ps', '--status', 'running', '--services'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve('')
    }, 4000)
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
  })
}

async function usingDocker(root, env) {
  if (env.MC_DOCTOR_DOCKER === '1') return true
  if (env.MC_DOCTOR_DOCKER === '0') return false
  const listed = await composeServices(root)
  return listed.split(/\r?\n/).some((line) => line.trim() === 'api')
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

/** Mission Control is the JSON service name, at any HTTP status. */
export function readHealthIdentity(res) {
  if (!res || res.status === 0) return { ours: false, db: null }
  try {
    const body = JSON.parse(res.text)
    if (!body || body.service !== 'mission-control') return { ours: false, db: null }
    const db = body.db === 'up' || body.db === 'down' ? body.db : null
    return { ours: true, db }
  } catch {
    return { ours: false, db: null }
  }
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

export function bridgeStampPath(root, env) {
  const raw = typeof env.MC_BRIDGE_STAMP_FILE === 'string' ? env.MC_BRIDGE_STAMP_FILE.trim() : ''
  if (raw) return raw
  return path.join(root, 'bridge', '.state', 'last-sync')
}

export function bridgeStaleSeconds(env) {
  const raw = typeof env.MC_BRIDGE_STALE_SECONDS === 'string' ? env.MC_BRIDGE_STALE_SECONDS.trim() : ''
  if (raw === '') return 600
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 1) return 600
  return seconds
}

function configuredValue(env, key) {
  const raw = typeof env[key] === 'string' ? env[key].trim() : ''
  return raw
}

function scheduleName(value, fallback) {
  if (/^[A-Za-z0-9._-]+$/.test(value)) return value
  return fallback
}

function defaultSystemdDir(processEnv) {
  const xdg = typeof processEnv.XDG_CONFIG_HOME === 'string' ? processEnv.XDG_CONFIG_HOME.trim() : ''
  if (xdg) return path.join(xdg, 'systemd', 'user')
  const home = typeof processEnv.HOME === 'string' ? processEnv.HOME.trim() : ''
  if (!home) return ''
  return path.join(home, '.config', 'systemd', 'user')
}

function defaultLaunchdDir(processEnv) {
  const home = typeof processEnv.HOME === 'string' ? processEnv.HOME.trim() : ''
  if (!home) return ''
  return path.join(home, 'Library', 'LaunchAgents')
}

function cronSchedulePresent(mark) {
  if (!mark) return false
  const listed = spawnSync('crontab', ['-l'], { encoding: 'utf8' })
  if (listed.error || listed.status !== 0 || typeof listed.stdout !== 'string') return false
  return listed.stdout.split(/\r?\n/).includes(`# BEGIN ${mark}`)
}

/** A schedule is installed when our unit, plist, or cron block is present. */
export function bridgeSchedulePresent(env, processEnv = process.env) {
  const unit = scheduleName(configuredValue(env, 'MC_BRIDGE_UNIT_NAME'), 'mission-control-bridge')
  const label = scheduleName(configuredValue(env, 'MC_BRIDGE_LAUNCHD_LABEL'), 'com.missioncontrol.bridge')
  const mark = scheduleName(configuredValue(env, 'MC_BRIDGE_CRON_MARK'), 'mission-control-bridge')
  const systemdDir = configuredValue(env, 'MC_BRIDGE_SYSTEMD_DIR') || defaultSystemdDir(processEnv)
  const launchDir = configuredValue(env, 'MC_BRIDGE_LAUNCHD_DIR') || defaultLaunchdDir(processEnv)
  if (systemdDir && (existsSync(path.join(systemdDir, `${unit}.timer`)) || existsSync(path.join(systemdDir, `${unit}.service`)))) {
    return true
  }
  if (launchDir && existsSync(path.join(launchDir, `${label}.plist`))) return true
  return cronSchedulePresent(mark)
}

/** age equal to the limit is still recent. Older than the limit is stale. */
export function bridgeSyncState(text, mtimeMs, nowMs, limitSeconds) {
  const trimmed = String(text ?? '').trim()
  let then = Number(trimmed)
  if (!Number.isFinite(then) || then <= 0) {
    then = Number(mtimeMs) / 1000
  }
  if (!Number.isFinite(then)) return { state: 'unreadable', limit: limitSeconds }
  const age = nowMs / 1000 - then
  if (age > limitSeconds) return { state: 'stale', age, limit: limitSeconds }
  return { state: 'fresh', age, limit: limitSeconds }
}

function bridgeFacts(root, env, processEnv = process.env) {
  const stamp = bridgeStampPath(root, env)
  const limit = bridgeStaleSeconds(env)
  const scheduled = bridgeSchedulePresent(env, processEnv)
  if (!existsSync(stamp)) return { state: 'missing', limit, stamp, scheduled }
  try {
    const text = readFileSync(stamp, 'utf8')
    const mtimeMs = statSync(stamp).mtimeMs
    return { ...bridgeSyncState(text, mtimeMs, Date.now(), limit), stamp, scheduled }
  } catch {
    return { state: 'unreadable', limit, stamp, scheduled }
  }
}

async function openclawDetail() {
  const bin = await which('openclaw')
  if (!bin) {
    return 'OpenClaw is optional. The openclaw command is not on PATH, so the bridge was not reached. Sample data does not need it.'
  }
  return 'OpenClaw is optional. The openclaw command is on PATH. Bridge reachability does not affect this check.'
}

async function databaseFacts(root, env) {
  if (dockerRequested(env)) {
    return {
      state: 'docker',
      detail: '',
      migrations: 'docker',
      pending: [],
    }
  }
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

const DOCKER_HEALTH_JS =
  'fetch("http://127.0.0.1:3000/health").then(async (res) => { const text = await res.text(); process.stdout.write(text); process.exit(res.ok ? 0 : 1); }).catch(() => process.exit(1))'

function dockerLoopbackHealth(root) {
  try {
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', DOCKER_HEALTH_JS], {
      cwd: root,
      encoding: 'utf8',
      timeout: 8000,
    })
    return readHealthIdentity({
      status: result.status === 0 ? 200 : 503,
      text: result.stdout || '',
    })
  } catch {
    return { ours: false, db: null }
  }
}

export async function inspectApiPort(port, host = '127.0.0.1', options = {}) {
  const url = `http://${host}:${port}/health`
  const free = await listenFree(port, host)
  if (free) return { state: 'free', url, db: null }
  const res = await httpGet(url)
  const identity = readHealthIdentity(res)
  if (identity.ours) return { state: 'ours', url, db: identity.db }
  if (res.status === 401 && options.docker && options.root) {
    const inside = dockerLoopbackHealth(options.root)
    if (inside.ours) return { state: 'ours', url, db: inside.db }
  }
  return { state: 'other', url, db: null }
}

async function portFacts(env, root) {
  const port = apiListenPort(env)
  const host = probeHost(bindHost(env))
  const bind = host === 'localhost' ? '127.0.0.1' : host
  if (port == null) {
    return { badPort: true, api: null, apiState: 'busy', health: null }
  }
  const seen = await inspectApiPort(healthProbePort(port, env), bind, { docker: dockerRequested(env), root })
  return {
    badPort: false,
    api: port,
    apiState: seen.state === 'free' ? 'free' : seen.state === 'ours' ? 'ours' : 'busy',
    health: {
      reachable: seen.state === 'ours',
      db: seen.db,
      url: seen.url,
    },
  }
}

export async function gather(root, processEnv = process.env) {
  const envFile = path.join(root, '.env')
  const envExists = existsSync(envFile)
  const loaded = effectiveEnv(loadEnvFile(envFile), processEnv)
  const docker = await usingDocker(root, loaded)
  const env = { ...loaded, MC_DOCTOR_DOCKER: docker ? '1' : '0' }
  const [ports, database, openclaw] = await Promise.all([
    portFacts(env, root),
    databaseFacts(root, env),
    openclawDetail(),
  ])
  const facts = {
    nodeVersion: process.version,
    envExists,
    env,
    ports,
    database,
    openclaw,
    bridge: bridgeFacts(root, env, processEnv),
  }
  facts.gateway = await gatewayReading(facts.env, facts.ports, root, processEnv)
  return facts
}

function portLine(ports, docker = false) {
  const label = docker ? 'MC_API_PORT' : 'PORT'
  if (ports.badPort) {
    return `fail ports: ${label} is not a valid port number. Set ${label} in .env to a free port, then run npm run doctor again.`
  }
  if (ports.apiState === 'free') return `pass ports: Port ${ports.api} is free.`
  if (ports.apiState === 'ours') return `pass ports: Port ${ports.api} is already running.`
  return `fail ports: Port ${ports.api} is used by another program. Stop it or set ${label} in .env.`
}

function databaseLine(database) {
  if (database.state === 'docker') {
    return 'info database: Docker runs Postgres inside Compose. This check did not use a host database client.'
  }
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
  if (database.migrations === 'docker') {
    return 'info migrations: Docker applies migrations when the API container starts. This check did not read a host migration table.'
  }
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
    return `fail token: NODE_ENV is production and INGEST_TOKEN is not set. Ingest routes return 401. Set INGEST_TOKEN in .env. Generate one with: ${FIX_TOKEN}`
  }
  if (state.kind === 'loopback-open') {
    return 'pass token: Token configuration is valid. HOST is loopback and INGEST_TOKEN is not set, so ingest stays open outside production.'
  }
  return `pass token: Token configuration is valid for ${state.host}.`
}

function loginLine(env) {
  const state = loginState(env)
  if (state.kind === 'exposed') {
    return 'fail login: The dashboard is reachable beyond this machine and DASHBOARD_PASSWORD_HASH or SESSION_SECRET is not set. Run bash install.sh, or set both in .env.'
  }
  if (state.kind === 'loopback-open') {
    return 'pass login: HOST is loopback, so the dashboard stays open without a password.'
  }
  return 'pass login: A dashboard password is configured.'
}

const NATIVE_GATEWAY_HOST = '127.0.0.1'
const DEFAULT_GATEWAY_PORT = 18789
const GATEWAY_UNKNOWN_HINT = 'Gateway status comes from the bridge. Run the bridge to check it.'
export const DOCKER_PERMISSION_HINT =
  'This user lacks permission to use the Docker socket. Add the user to the docker group with sudo usermod -aG docker "$USER", start a new login session, then run npm run doctor again.'

/** Docker socket denial, including a user who is not in the docker group. */
export function dockerPermissionDenied(text) {
  const raw = String(text ?? '')
  return /permission denied/i.test(raw) && /docker/i.test(raw)
}

function isGatewayHost(value) {
  if (!value || value.length > 253) return false
  if (value.includes('/') || /\s/.test(value) || value.includes('\0')) return false
  return /^[A-Za-z0-9.:-]+$/.test(value)
}

function gatewayPort(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) return DEFAULT_GATEWAY_PORT
  const port = Number(text)
  if (port < 1 || port > 65535) return DEFAULT_GATEWAY_PORT
  return port
}

/**
 * Compose with a blank host reads the bridge report. An explicit host, and
 * every native install, probes that address. The port is the configured
 * port on either path. Defaults match apps/api/src/system/gateway-status.ts.
 */
export function gatewayUsesBridge(env) {
  const compose = env.MC_DOCTOR_DOCKER === '1' || env.MC_COMPOSE === '1'
  if (!compose) return false
  const hostRaw = typeof env.OPENCLAW_GATEWAY_HOST === 'string' ? env.OPENCLAW_GATEWAY_HOST.trim() : ''
  return !isGatewayHost(hostRaw)
}

export function gatewayTarget(env) {
  const hostRaw = typeof env.OPENCLAW_GATEWAY_HOST === 'string' ? env.OPENCLAW_GATEWAY_HOST.trim() : ''
  return {
    host: isGatewayHost(hostRaw) ? hostRaw : NATIVE_GATEWAY_HOST,
    port: gatewayPort(env.OPENCLAW_GATEWAY_PORT),
  }
}

export function gatewayLine(env, reading) {
  if (gatewayUsesBridge(env)) {
    const state = reading && reading.state
    if (state === 'up') {
      const version = reading.version ? ` Version ${reading.version}.` : ''
      return `info gateway: The bridge reported the gateway up at ${reading.host} port ${reading.port}.${version}`
    }
    if (state === 'down') {
      return `info gateway: The bridge reported the gateway down at ${reading.host} port ${reading.port}.`
    }
    const hint = reading && reading.dockerDenied ? DOCKER_PERMISSION_HINT : GATEWAY_UNKNOWN_HINT
    return `info gateway: Gateway status is unknown. ${hint}`
  }
  const target = gatewayTarget(env)
  if (reading && (reading.state === 'up' || reading.state === 'down')) {
    return `info gateway: The gateway probe at ${target.host} port ${target.port} is ${reading.state}.`
  }
  return `info gateway: The gateway probe uses ${target.host} port ${target.port}. Set OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT to change it.`
}

export function probeGatewayTarget(target, timeoutMs = 800) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (up) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ state: up ? 'up' : 'down', host: target.host, port: target.port })
    }
    const socket = net.connect({ host: target.host, port: target.port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function parseGatewayBody(text) {
  try {
    const body = JSON.parse(text)
    const gw = body && body.gateway
    if (!gw || (gw.state !== 'up' && gw.state !== 'down' && gw.state !== 'unknown')) return null
    return {
      state: gw.state,
      host: typeof gw.host === 'string' ? gw.host : NATIVE_GATEWAY_HOST,
      port: Number.isInteger(gw.port) ? gw.port : DEFAULT_GATEWAY_PORT,
      version: typeof gw.version === 'string' ? gw.version : '',
    }
  } catch {
    return null
  }
}

const DOCKER_SYSTEM_JS =
  'fetch("http://127.0.0.1:3000/system").then(async (res) => { const text = await res.text(); process.stdout.write(text); process.exit(res.ok ? 0 : 1); }).catch(() => process.exit(1))'

function dockerLoopbackSystem(root, processEnv = process.env) {
  try {
    const result = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', DOCKER_SYSTEM_JS], {
      cwd: root,
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, ...processEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const detail = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error ? result.error.message : ''}`
    return {
      status: result.status === 0 ? 200 : 0,
      text: result.stdout || '',
      dockerDenied: dockerPermissionDenied(detail),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 0, text: '', dockerDenied: dockerPermissionDenied(message) }
  }
}

async function gatewayReading(env, ports, root, processEnv = process.env) {
  const target = gatewayTarget(env)
  if (!gatewayUsesBridge(env)) return probeGatewayTarget(target)
  const unknown = { state: 'unknown', host: NATIVE_GATEWAY_HOST, port: target.port }
  const healthUrl = ports?.health?.url
  if (!healthUrl) return unknown
  const systemUrl = healthUrl.replace(/\/health$/, '/system')
  let res = await httpGet(systemUrl)
  if (res.status === 401 && env.MC_DOCTOR_DOCKER === '1' && root) {
    res = dockerLoopbackSystem(root, processEnv)
  }
  if (res.dockerDenied) return { ...unknown, dockerDenied: true }
  return parseGatewayBody(res.text) ?? unknown
}

function bridgeLine(bridge) {
  const item = bridge ?? { state: 'missing', limit: 600 }
  if (item.state === 'fresh') return 'pass bridge: The last OpenClaw sync is recent.'
  if (item.state === 'stale' && item.scheduled) {
    const limit = item.limit ?? 600
    return `fail bridge: The last OpenClaw sync is older than ${limit} seconds. Run python3 bridge/mc-bridge-sync.py and confirm the schedule is installed.`
  }
  if (item.state === 'stale') {
    const limit = item.limit ?? 600
    return `info bridge: The last OpenClaw sync is older than ${limit} seconds. No bridge schedule is installed.`
  }
  if (item.state === 'unreadable') {
    return 'fail bridge: The OpenClaw sync timestamp could not be read. Check MC_BRIDGE_STAMP_FILE, then run python3 bridge/mc-bridge-sync.py.'
  }
  return 'info bridge: No OpenClaw sync timestamp was found. That is normal before the first successful bridge run.'
}

function healthLine(ports) {
  const url = ports.health?.url ?? 'http://127.0.0.1:3000/health'
  if (!ports.badPort && ports.apiState === 'busy') {
    return 'info health: Skipped because the API port is used by another program.'
  }
  if (ports.health?.reachable && ports.health.db === 'up') {
    return 'pass health: The health check says the database is up.'
  }
  if (ports.health?.reachable && ports.health.db === 'down') {
    return 'fail health: The health check says the database is down.'
  }
  if (ports.health?.reachable) {
    return `fail health: The health check at ${url} did not say whether the database is up.`
  }
  return `fail health: The API health endpoint is not reachable at ${url}. Start the API and the web app with: ${FIX_HEALTH}`
}

export function report(facts) {
  const docker = dockerRequested(facts.env)
  const lines = []
  if (!docker) {
    lines.push(
      nodeSupported(facts.nodeVersion)
        ? `pass node: Node ${facts.nodeVersion} is supported.`
        : `fail node: ${FIX_NODE}`,
    )
  }
  lines.push(
    portLine(facts.ports, docker),
    facts.envExists ? 'pass env: .env is present.' : `fail env: .env is missing. Create it with: ${FIX_ENV}`,
    databaseLine(facts.database),
    migrationsLine(facts.database),
    tokenLine(facts.env),
    loginLine(facts.env),
    healthLine(facts.ports),
    `info openclaw: ${facts.openclaw}`,
    bridgeLine(facts.bridge),
    gatewayLine(facts.env, facts.gateway),
  )
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
