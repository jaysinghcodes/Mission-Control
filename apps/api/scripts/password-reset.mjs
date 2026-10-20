/**
 * Set a new dashboard password and revoke every session.
 *
 * Writes the scrypt hash straight to the session file. There is no HTTP route.
 * Native: npm run password:reset
 * Compose: docker compose exec api npm run password:reset
 */
import { spawnSync } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LEN = 32
const UNREADABLE_VERSION = Number.MAX_SAFE_INTEGER
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

if (hostComposeIsRunning()) {
  console.error('Could not reset the dashboard password.')
  console.error('The Compose API is running. This command has to run inside that container.')
  console.error('Under Compose: docker compose exec api npm run password:reset')
  process.exit(1)
}

const password = randomBytes(18).toString('base64url')
const file = statePath()
try {
  const state = readState(file)
  const next = state.version >= UNREADABLE_VERSION ? state.version : state.version + 1
  writeState(file, { version: next, passwordHash: hashPassword(password) })
} catch {
  console.error('Could not reset the dashboard password.')
  console.error('Could not write the session file.')
  console.error('Under Compose: docker compose exec api npm run password:reset')
  process.exit(1)
}

console.log(`Dashboard password, shown once: ${password}`)
console.log('Every session was revoked.')

function statePath() {
  const raw = process.env.SESSION_STATE_PATH
  if (typeof raw === 'string' && raw.trim() !== '') return resolve(raw.trim())
  return resolve(here, '..', 'data', 'session-state.json')
}

function hostComposeIsRunning() {
  if (process.env.MC_COMPOSE === '1') return false
  const explicit = process.env.SESSION_STATE_PATH
  if (typeof explicit === 'string' && explicit.trim() !== '') return false
  const result = spawnSync(
    'docker',
    ['compose', 'ps', '--status', 'running', '--services'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 5000 },
  )
  if (result.error || result.status !== 0) return false
  return String(result.stdout || '')
    .split('\n')
    .some((line) => line.trim() === 'api')
}

function hashPassword(value) {
  const salt = randomBytes(16)
  const key = scryptSync(value, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('hex'),
    key.toString('hex'),
  ].join(':')
}

function readState(file) {
  if (!existsSync(file)) return { version: 1, passwordHash: null }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const version = parsed.version
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > UNREADABLE_VERSION
    ) {
      return { version: UNREADABLE_VERSION, passwordHash: null }
    }
    const passwordHash =
      typeof parsed.passwordHash === 'string' && parsed.passwordHash.trim() !== ''
        ? parsed.passwordHash.trim()
        : null
    return { version, passwordHash }
  } catch {
    return { version: UNREADABLE_VERSION, passwordHash: null }
  }
}

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  const body = { version: state.version }
  if (state.passwordHash) body.passwordHash = state.passwordHash
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 })
  renameSync(tmp, file)
  chmodSync(file, 0o600)
}
