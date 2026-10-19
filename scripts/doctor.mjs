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
 * and prints no node line. The health probe retries for up to 60 seconds.
 * Compose mode is a compose file, any project container, or MC_DOCTOR_DOCKER=1.
 * MC_DOCTOR_DOCKER=0 keeps the native check. In Compose mode the order is
 * fixed: an outside holder of the API, web, or database port, then a
 * missing, stopped, or paused service, then a slow start. The port line
 * names MC_API_PORT, MC_WEB_PORT, or MC_DB_PORT, including when no container
 * exists. A slow start is only when those ports are free, db and api are
 * running or starting, and the probe has not answered. The Compose installer
 * runs this file inside the api container. npm run doctor still runs it on the host.
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
  for (const key of ['DATABASE_URL', 'PORT', 'HOST', 'INGEST_TOKEN', 'NODE_ENV', 'MC_DOCTOR_DOCKER', 'DASHBOARD_PASSWORD_HASH', 'SESSION_SECRET', 'TRUSTED_PROXY', 'MC_INSTALL_HEALTH_PORT', 'MC_DOCTOR_HEALTH_SECONDS', ...MC_BLANK_FALLTHROUGH]) {
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
  const insidePort = env.MC_DOCTOR_INSIDE === '1' ? env.MC_DOCTOR_PROBE_PORT : ''
  const raw = typeof insidePort === 'string' && insidePort.trim() !== '' ? insidePort : env.MC_INSTALL_HEALTH_PORT
  if (typeof raw !== 'string' || raw.trim() === '') return logical
  const port = parsePort(raw, logical)
  return port == null ? logical : port
}

function composeServices(root, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['compose', 'ps', '-a', '--services'], {
      cwd: root,
      env,
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

const COMPOSE_FILE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']

export function parseComposeServiceNames(text) {
  const names = []
  let inServices = false
  for (const line of String(text).split(/\n/)) {
    if (/^services:\s*(?:#.*)?$/.test(line)) {
      inServices = true
      continue
    }
    if (!inServices) continue
    if (/^\S/.test(line)) break
    const match = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line)
    if (match) names.push(match[1])
  }
  return names
}

function readComposeServiceNames(root) {
  for (const name of COMPOSE_FILE_NAMES) {
    const file = path.join(root, name)
    if (!existsSync(file)) continue
    try {
      return parseComposeServiceNames(readFileSync(file, 'utf8'))
    } catch {
      return []
    }
  }
  return null
}

function composeFilePresent(root) {
  return COMPOSE_FILE_NAMES.some((name) => existsSync(path.join(root, name)))
}

async function usingDocker(root, env, processEnv = process.env) {
  if (env.MC_DOCTOR_DOCKER === '1') return true
  if (env.MC_DOCTOR_DOCKER === '0') return false
  // A compose file selects Compose with zero containers. Any project
  // container does too: created, exited, paused, running, or removed.
  if (composeFilePresent(root)) return true
  const listed = await composeServices(root, { ...processEnv, ...env })
  return listed.split(/\r?\n/).some((line) => line.trim() !== '')
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

async function openclawDetail(env = process.env) {
  if (env.MC_DOCTOR_OPENCLAW_ON_PATH === '0') {
    return 'OpenClaw is optional. The openclaw command is not on PATH, so the bridge was not reached. Sample data does not need it.'
  }
  if (env.MC_DOCTOR_OPENCLAW_ON_PATH === '1') {
    return 'OpenClaw is optional. The openclaw command is on PATH. Bridge reachability does not affect this check.'
  }
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

export const STARTING_NOTE = 'The API is still starting. Run doctor again in a minute.'

/** Blank or invalid stays at 60 seconds. 0 is one probe, for tests. */
export function doctorHealthBudgetMs(env = process.env) {
  const raw = env && typeof env.MC_DOCTOR_HEALTH_SECONDS === 'string' ? env.MC_DOCTOR_HEALTH_SECONDS.trim() : ''
  if (raw === '') return 60000
  if (!/^\d+$/.test(raw)) return 60000
  return Number(raw) * 1000
}

export function textShowsListenPort(text, port) {
  const re = new RegExp(`:${port}(?!\\d)`)
  return re.test(String(text))
}

export function parseSsListeners(text, port) {
  const rows = []
  for (const line of String(text).split(/\n/)) {
    if (!textShowsListenPort(line, port)) continue
    const named = /\(\("([^"]+)"/.exec(line)
    const pid = /pid=(\d+)/.exec(line)
    rows.push({
      pid: pid ? Number(pid[1]) : null,
      command: named ? named[1] : '',
    })
  }
  return rows
}

export function parseLsofListeners(text) {
  const rows = []
  for (const line of String(text).split(/\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2 || !/^\d+$/.test(parts[1])) continue
    rows.push({ pid: Number(parts[1]), command: parts[0] })
  }
  return rows
}

export function parseComposePublishedPorts(text) {
  const ports = []
  for (const line of String(text).split(/\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const row = JSON.parse(trimmed)
      const publishers = row.Publishers || row.publishers || []
      for (const pub of publishers) {
        const published = pub.PublishedPort ?? pub.publishedPort
        const port = Number(published)
        if (Number.isInteger(port) && port > 0) ports.push(port)
      }
    } catch {
      // A non JSON line is not a publisher row.
    }
  }
  return ports
}

export function parseComposeServiceRows(text) {
  const rows = []
  for (const line of String(text).split(/\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const row = JSON.parse(trimmed)
      const service = row.Service || row.service || ''
      if (!service) continue
      rows.push({
        service: String(service),
        state: String(row.State || row.state || '').toLowerCase(),
        health: String(row.Health || row.health || '').toLowerCase(),
        status: String(row.Status || row.status || '').toLowerCase(),
      })
    } catch {
      // A non JSON line is not a service row.
    }
  }
  return rows
}

/** Running, or a health check that is still starting, can wait on the probe. */
export function composeServiceReady(row) {
  if (!row) return false
  if (row.state === 'paused' || row.state === 'exited' || row.state === 'dead' || row.state === 'restarting') return false
  if (row.health === 'starting' || row.status.includes('health: starting')) return true
  if (row.state === 'running' || row.state === 'starting') return true
  return false
}

function serviceFailureSentence(names, kind) {
  if (names.length === 0) return ''
  const subject = names.length === 1 ? `The ${names[0]} service` : `The ${names.join(' and ')} services`
  const command = kind === 'paused' ? 'unpause' : kind === 'missing' ? 'up -d' : 'start'
  if (kind === 'paused') {
    const state = names.length === 1 ? 'is paused' : 'are paused'
    const verb = names.length === 1 ? 'Unpause it' : 'Unpause them'
    return `${subject} ${state}. ${verb} with: docker compose ${command} ${names.join(' ')}`
  }
  const state = names.length === 1 ? 'is not running' : 'are not running'
  const verb = names.length === 1 ? 'Start it' : 'Start them'
  return `${subject} ${state}. ${verb} with: docker compose ${command} ${names.join(' ')}`
}

/**
 * Empty when db and api are both ready, or when there is nothing to name.
 * A removed or never created service names docker compose up -d.
 * An exited, created, or restarting service names docker compose start.
 * A paused service names docker compose unpause.
 * An outside holder of a configured port is reported by the caller first.
 * serviceNames, when the compose file lists any, limits db and api to that file.
 */
export function composeServiceFailure(rows, serviceNames) {
  const list = Array.isArray(rows) ? rows : []
  const required = ['db', 'api']
  let expected
  if (Array.isArray(serviceNames)) {
    if (serviceNames.length === 0 && list.length === 0) return ''
    const fromFile = required.filter((name) => serviceNames.includes(name))
    if (fromFile.length > 0) expected = fromFile
    else if (list.length === 0) return ''
    else expected = required
  } else if (list.length === 0) {
    return ''
  } else {
    expected = required
  }
  const buckets = { start: [], missing: [], paused: [] }
  for (const name of expected) {
    const row = list.find((item) => item.service === name)
    if (row && composeServiceReady(row)) continue
    if (!row) buckets.missing.push(name)
    else if (row.state === 'paused' || row.status.startsWith('paused')) buckets.paused.push(name)
    else buckets.start.push(name)
  }
  return [
    serviceFailureSentence(buckets.start, 'start'),
    serviceFailureSentence(buckets.missing, 'missing'),
    serviceFailureSentence(buckets.paused, 'paused'),
  ].filter(Boolean).join(' ')
}

function decodeComposePs(env) {
  const b64 = typeof env.MC_DOCTOR_COMPOSE_PS_B64 === 'string' ? env.MC_DOCTOR_COMPOSE_PS_B64.trim() : ''
  if (!b64) return null
  try {
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function readComposeServiceRows(root, env = process.env) {
  const embedded = decodeComposePs(env)
  if (embedded != null) return parseComposeServiceRows(embedded)
  const ps = runCaptured('docker', ['compose', 'ps', '-a', '--format', 'json'], root, env)
  if (!ps || ps.error || ps.status !== 0) return null
  return parseComposeServiceRows(ps.stdout || '')
}

export function parseDockerPortLines(text) {
  const ports = []
  for (const line of String(text).split(/\n/)) {
    const match = line.trim().match(/:(\d+)$/)
    if (match) ports.push(Number(match[1]))
  }
  return ports
}

function isDockerProxyCommand(command) {
  const name = String(command || '').toLowerCase()
  if (!name) return false
  return name === 'docker-proxy' || name.includes('docker-proxy') || name === 'com.docker.backend' || name.includes('vpnkit')
}

/**
 * stack: this compose project publishes the port, or the listener is one of
 * its containers. foreign: a named process outside that set, or docker
 * answered and the port is not one of ours. unknown: docker did not answer
 * and the listener is only a proxy. none: nothing is listening.
 */
export function classifyPortHolder({ port, listeners = [], publishedPorts = [], containerPids = [], dockerOk = false, portInUse = false }) {
  const rows = Array.isArray(listeners) ? listeners : []
  const published = publishedPorts.map((item) => Number(item))
  const containers = new Set(containerPids.map((item) => Number(item)))
  if (published.includes(port)) return 'stack'
  if (rows.some((row) => row.pid && containers.has(row.pid))) return 'stack'
  const namedForeign = rows.filter((row) => {
    if (row.pid && containers.has(row.pid)) return false
    if (!row.command) return false
    if (isDockerProxyCommand(row.command)) return false
    return true
  })
  if (namedForeign.length > 0) return 'foreign'
  if (dockerOk && portInUse && !published.includes(port)) return 'foreign'
  if (portInUse) return 'unknown'
  return 'none'
}

function runCaptured(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 4000,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function readListenerRows(port, env = process.env) {
  let ssRows = []
  const ss = runCaptured('ss', ['-H', '-lptn'], undefined, env)
  if (!ss.error && ss.status === 0 && textShowsListenPort(ss.stdout || '', port)) {
    ssRows = parseSsListeners(ss.stdout || '', port)
    if (ssRows.some((row) => row.command)) return ssRows
  }
  const lsof = runCaptured('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], undefined, env)
  if (!lsof.error && lsof.stdout) {
    const rows = parseLsofListeners(lsof.stdout)
    if (rows.length > 0) return rows
  }
  return ssRows
}

function dockerDetail(result) {
  if (!result) return ''
  const error = result.error ? result.error.message : ''
  return `${result.stderr || ''}\n${error}`
}

function readComposeOwnership(root, port, env = process.env) {
  const ps = runCaptured('docker', ['compose', 'ps', '--format', 'json'], root, env)
  const detail = dockerDetail(ps)
  if (ps.error || ps.status !== 0) {
    if (/no configuration file|can't find a suitable configuration|no such file/i.test(detail)) {
      return { ok: true, published: [], containerPids: [] }
    }
    return { ok: false, published: [], containerPids: [] }
  }
  const published = parseComposePublishedPorts(ps.stdout || '')
  const mapped = runCaptured('docker', ['compose', 'port', 'api', '3000'], root, env)
  if (!mapped.error && mapped.status === 0) {
    published.push(...parseDockerPortLines(mapped.stdout || ''))
  }
  const ids = runCaptured('docker', ['compose', 'ps', '-q'], root, env)
  const containerPids = []
  if (!ids.error && ids.status === 0) {
    for (const id of String(ids.stdout || '').split(/\n/)) {
      const trimmed = id.trim()
      if (!trimmed) continue
      const inspected = runCaptured('docker', ['inspect', '-f', '{{.State.Pid}}', trimmed], root, env)
      if (inspected.error || inspected.status !== 0) continue
      const pid = Number(String(inspected.stdout || '').trim())
      if (pid > 0) containerPids.push(pid)
    }
  }
  if (published.includes(port)) return { ok: true, published, containerPids }
  return { ok: true, published, containerPids }
}

async function outsideProgramHoldsPort(port, host, options) {
  const free = await listenFree(port, host)
  if (free) return false
  const owner = typeof options.portOwner === 'function'
    ? await options.portOwner(port, options)
    : await defaultPortOwner(port, options)
  return owner === 'foreign'
}

const COMPOSE_PORT_SPECS = [
  { key: 'MC_API_PORT', fallback: 3000, api: true },
  { key: 'MC_WEB_PORT', fallback: 5173, api: false },
  { key: 'MC_DB_PORT', fallback: 5432, api: false },
]

export function composePortConflictLine(port, key) {
  return `Port ${port} is used by another program. Stop it or set ${key} in .env.`
}

async function apiPortHeldByOtherProgram(port, host, options) {
  if (!(await outsideProgramHoldsPort(port, host, options))) return false
  const timeout = options.httpTimeoutMs ?? 1500
  const res = await httpGet(`http://${host}:${port}/health`, timeout)
  if (readHealthIdentity(res).ours) return false
  if (res.status === 401 && options.docker && options.root && !options.inside) {
    const inside = dockerLoopbackHealth(options.root, options)
    if (inside.ours) return false
  }
  return true
}

async function composeOutsideConflicts(host, options) {
  const env = options.env || {}
  const seen = new Set()
  const hits = []
  for (const spec of COMPOSE_PORT_SPECS) {
    const port = parsePort(env[spec.key], spec.fallback)
    if (port == null || seen.has(port)) continue
    seen.add(port)
    const held = spec.api
      ? await apiPortHeldByOtherProgram(port, host, options)
      : await outsideProgramHoldsPort(port, host, options)
    if (held) hits.push({ key: spec.key, port, api: spec.api })
  }
  return hits
}

async function defaultPortOwner(port, options) {
  const env = options.env || process.env
  const listeners = options.readListeners ? options.readListeners(port) : readListenerRows(port, env)
  const docker = options.docker
    ? options.readCompose
      ? options.readCompose(port)
      : readComposeOwnership(options.root, port, env)
    : { ok: false, published: [], containerPids: [] }
  return classifyPortHolder({
    port,
    listeners,
    publishedPorts: docker.published || [],
    containerPids: docker.containerPids || [],
    dockerOk: Boolean(docker.ok),
    portInUse: true,
  })
}

// compose-host-free:start
function splitCurlStatus(stdout) {
  const text = String(stdout || '')
  const match = /^(.*)\n(\d{3})\s*$/s.exec(text)
  if (!match) return { status: 0, text: '' }
  const status = Number(match[2])
  if (!Number.isInteger(status)) return { status: 0, text: '' }
  return { status, text: match[1] }
}

function readContainerCurl(root, urlPath, options = {}) {
  const timeout = options.execTimeoutMs ?? 2000
  const run = options.execFile || spawnSync
  const env = options.env ? { ...process.env, ...options.env } : process.env
  try {
    const result = run(
      'docker',
      ['compose', 'exec', '-T', 'api', 'curl', '-sS', '--max-time', '2', '-w', '\n%{http_code}', `http://127.0.0.1:3000${urlPath}`],
      {
        cwd: root,
        encoding: 'utf8',
        timeout,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const parsed = splitCurlStatus(result && result.stdout)
    const detail = `${(result && result.stderr) || ''}\n${result && result.error ? result.error.message : ''}`
    return {
      status: parsed.status,
      text: parsed.text,
      detail,
      dockerDenied: dockerPermissionDenied(detail),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 0, text: '', detail: message, dockerDenied: dockerPermissionDenied(message) }
  }
}
// compose-host-free:end

function dockerLoopbackHealth(root, options = {}) {
  return readHealthIdentity(readContainerCurl(root, '/health', options))
}

async function probeApiOnce(port, host, options) {
  const url = `http://${host}:${port}/health`
  const free = await listenFree(port, host)
  if (free) {
    if (options.inside && options.servicesReady) return { state: 'pending', url, db: null }
    return { state: 'free', url, db: null }
  }
  const timeout = options.httpTimeoutMs ?? 1500
  const res = await httpGet(url, timeout)
  const identity = readHealthIdentity(res)
  if (identity.ours) return { state: 'ours', url, db: identity.db }
  if (options.inside && options.servicesReady) return { state: 'pending', url, db: null }
  if (res.status === 401 && options.docker && options.root && !options.inside) {
    const inside = dockerLoopbackHealth(options.root, options)
    if (inside.ours) return { state: 'ours', url, db: inside.db }
  }
  if (!options.docker) return { state: 'other', url, db: null }
  const owner = typeof options.portOwner === 'function'
    ? await options.portOwner(port, options)
    : await defaultPortOwner(port, options)
  if (owner === 'foreign') return { state: 'other', url, db: null }
  if (owner === 'stack' || owner === 'unknown') return { state: 'pending', url, db: null, owner }
  return { state: 'other', url, db: null }
}

export async function inspectApiPort(port, host = '127.0.0.1', options = {}) {
  const budgetMs = options.budgetMs ?? doctorHealthBudgetMs(options.env || process.env)
  const now = options.now || Date.now
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const started = now()
  const probeUrl = `http://${host}:${port}/health`
  while (true) {
    let servicesReady = false
    if (options.docker && options.root) {
      const rows = typeof options.readServices === 'function'
        ? options.readServices()
        : readComposeServiceRows(options.root, options.env || process.env)
      const hits = await composeOutsideConflicts(host, options)
      if (hits.length > 0) {
        return {
          state: 'other',
          url: probeUrl,
          db: null,
          conflict: hits.map((hit) => composePortConflictLine(hit.port, hit.key)).join(' '),
          conflictApi: hits.some((hit) => hit.api),
        }
      }
      if (Array.isArray(rows)) {
        const downMessage = composeServiceFailure(rows, readComposeServiceNames(options.root))
        if (downMessage) return { state: 'down', url: probeUrl, db: null, downMessage }
        servicesReady = rows.some((row) => (row.service === 'db' || row.service === 'api') && composeServiceReady(row))
      }
    }
    const seen = await probeApiOnce(port, host, { ...options, servicesReady })
    if (seen.state !== 'pending') return { state: seen.state, url: seen.url, db: seen.db }
    if (now() - started >= budgetMs) {
      return { state: 'starting', url: seen.url, db: null }
    }
    const elapsed = now() - started
    const pause = Math.min(1000, Math.max(1, budgetMs - elapsed))
    await sleep(pause)
  }
}

async function portFacts(env, root, processEnv = process.env) {
  const port = apiListenPort(env)
  const host = probeHost(bindHost(env))
  const bind = host === 'localhost' ? '127.0.0.1' : host
  if (port == null) {
    return { badPort: true, api: null, apiState: 'busy', health: null }
  }
  const merged = { ...processEnv, ...env }
  const seen = await inspectApiPort(healthProbePort(port, merged), bind, {
    docker: dockerRequested(env),
    inside: merged.MC_DOCTOR_INSIDE === '1',
    root,
    env: merged,
  })
  const apiState = seen.state === 'free'
    ? 'free'
    : seen.state === 'ours'
      ? 'ours'
      : seen.state === 'starting'
        ? 'starting'
        : seen.state === 'down'
          ? 'down'
          : 'busy'
  return {
    badPort: false,
    api: port,
    apiState,
    downMessage: seen.downMessage || '',
    conflict: seen.conflict || '',
    conflictApi: seen.conflictApi === false ? false : true,
    health: {
      reachable: seen.state === 'ours',
      db: seen.db,
      url: seen.url,
    },
  }
}

export async function gather(root, processEnv = process.env) {
  const envFile = path.join(root, '.env')
  const envExists = existsSync(envFile) || processEnv.MC_DOCTOR_ENV_PRESENT === '1'
  const loaded = effectiveEnv(loadEnvFile(envFile), processEnv)
  const docker = await usingDocker(root, loaded, processEnv)
  const env = { ...loaded, MC_DOCTOR_DOCKER: docker ? '1' : '0' }
  const [ports, database, openclaw] = await Promise.all([
    portFacts(env, root, processEnv),
    databaseFacts(root, env),
    openclawDetail(processEnv),
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
  if (ports.conflict) return `fail ports: ${ports.conflict}`
  if (ports.apiState === 'free') return `pass ports: Port ${ports.api} is free.`
  if (ports.apiState === 'ours') return `pass ports: Port ${ports.api} is already running.`
  if (ports.apiState === 'down') return `fail ports: ${ports.downMessage}`
  if (ports.apiState === 'starting') return `info ports: ${STARTING_NOTE}`
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

function dockerLoopbackSystem(root, processEnv = process.env) {
  const result = readContainerCurl(root, '/system', { env: processEnv, execTimeoutMs: 8000 })
  return {
    status: result.status,
    text: result.text,
    dockerDenied: result.dockerDenied,
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

function healthLine(ports, docker = false) {
  const url = ports.health?.url ?? 'http://127.0.0.1:3000/health'
  if (!ports.badPort && ports.apiState === 'down') {
    return `fail health: ${ports.downMessage}`
  }
  if (!ports.badPort && ports.apiState === 'starting') {
    return `info health: ${STARTING_NOTE}`
  }
  if (!ports.badPort && ports.apiState === 'busy') {
    if (ports.conflict && ports.conflictApi === false) {
      return 'info health: Skipped because a Compose port is used by another program.'
    }
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
  if (docker) {
    return `fail health: The API health endpoint is not reachable at ${url}. Start the stack with: docker compose up -d`
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
    healthLine(facts.ports, docker),
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
