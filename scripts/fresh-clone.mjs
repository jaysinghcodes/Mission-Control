/**
 * Prove a clean tree can follow the README install block.
 *
 * The fresh clone job runs the Advanced: Node and Postgres block. It has
 * Node and Postgres and does not need Docker. git clone is pointed at this
 * checkout so the job tests the commit under review, not whatever the public
 * default branch happens to be. .env is the example file with no edits.
 * OpenClaw is not started.
 *
 * FRESH_INSTALL_MODE=compose runs bash install.sh with Docker Compose.
 * FRESH_INSTALL_MODE=native runs bash install.sh with Docker hidden, so the
 * native path is what a machine without Docker runs. Both modes then post
 * bridge/examples/fresh-install through the bridge and read it back.
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, openSync, closeSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEnvFile } from './doctor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const ADVANCED_HEADING = '### Advanced: Node and Postgres'

function installSection(markdown) {
  const parts = String(markdown).split(/^## Install and run\s*$/m)
  if (parts.length < 2) {
    throw new Error('README is missing the Install and run section.')
  }
  return parts[1].split(/^## /m)[0]
}

function bashCommands(section) {
  const fence = section.match(/```bash\r?\n([\s\S]*?)```/)
  if (!fence) throw new Error('README Install and run section has no bash block.')
  return fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** The first bash block. That is the install.sh one liner. */
export function readComposeInstallCommands(markdown) {
  const section = installSection(markdown)
  const beforeAdvanced = section.split(new RegExp(`^${ADVANCED_HEADING}\\s*$`, 'm'))[0]
  return bashCommands(beforeAdvanced)
}

/**
 * The fresh clone job runs this block. It needs Node and Postgres and does
 * not need Docker. The installer jobs call freshInstall instead.
 */
export function readInstallCommands(markdown) {
  const section = installSection(markdown)
  const advanced = section.split(new RegExp(`^${ADVANCED_HEADING}\\s*$`, 'm'))
  if (advanced.length < 2) {
    throw new Error(`README Install and run section is missing ${ADVANCED_HEADING}.`)
  }
  return bashCommands(advanced[1])
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function isDevCommand(cmd) {
  return /^npm run dev(\s|$)/.test(cmd)
}

/**
 * Bash for every README command except npm run dev, which the caller starts
 * after the build and the production token check. git clone fetches this
 * checkout so a broken command in the README fails this script.
 */
export function buildInstallScript(commands, { source, workParent }) {
  const devIndex = commands.findIndex((cmd) => isDevCommand(cmd))
  if (devIndex === -1) {
    throw new Error('The README install block does not run npm run dev.')
  }
  const lines = ['set -euo pipefail', `cd ${shellQuote(workParent)}`]
  let sawClone = false
  let dest = ''
  for (const cmd of commands.slice(0, devIndex)) {
    if (cmd.startsWith('git clone ')) {
      const parts = cmd.split(/\s+/)
      dest = parts[parts.length - 1]
      if (!dest || dest.startsWith('-')) {
        throw new Error('The git clone command in the README has no destination directory.')
      }
      sawClone = true
      lines.push(`git clone --local ${shellQuote(source)} ${shellQuote(dest)}`)
      continue
    }
    lines.push(cmd)
  }
  if (!sawClone) throw new Error('The README install block does not clone the repo.')
  return {
    script: `${lines.join('\n')}\n`,
    cloneDir: path.join(workParent, dest),
    afterDev: commands.slice(devIndex + 1),
    devCommand: commands[devIndex],
  }
}

export function runShell(script, { cwd, env = process.env, inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', script], {
      cwd,
      env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    if (!inherit) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
    }
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function runInherit(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

function httpGet(url, ms = 3000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal })
    .then(async (res) => ({ ok: res.ok, status: res.status, text: await res.text() }))
    .catch(() => ({ ok: false, status: 0, text: '' }))
    .finally(() => clearTimeout(timer))
}

function bootTime(text) {
  try {
    const body = JSON.parse(text)
    if (body.status !== 'ok' || body.database !== 'connected') return null
    if (typeof body.ts !== 'number' || typeof body.uptimeSeconds !== 'number') return null
    return body.ts - body.uptimeSeconds * 1000
  } catch {
    return null
  }
}

/**
 * prisma generate restarts `nest start --watch`, sometimes a second time
 * after the first health check is already green. Wait until one process
 * stays up long enough for the browser checks.
 */
async function waitUntilApiSettles(timeoutMs = 120000) {
  const start = Date.now()
  let boot = null
  let stableSince = null
  while (Date.now() - start < timeoutMs) {
    const res = await httpGet('http://127.0.0.1:3000/health')
    const next = res.ok ? bootTime(res.text) : null
    const same = next !== null && boot !== null && Math.abs(next - boot) < 1500
    if (!same) {
      boot = next
      stableSince = next === null ? null : Date.now()
    } else if (stableSince && Date.now() - stableSince >= 8000) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The API did not stay up after seed:demo.')
}

async function waitFor(url, ready, timeoutMs) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await httpGet(url)
    if (ready(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}. Last status ${last ? last.status : 0}.`)
}

function killGroup(child) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

function tail(file, lines = 80) {
  if (!existsSync(file)) return ''
  const text = readFileSync(file, 'utf8')
  return text.split(/\r?\n/).slice(-lines).join('\n')
}

function envFromClone(cloneDir) {
  const fileEnv = loadEnvFile(path.join(cloneDir, '.env'))
  const env = { ...process.env }
  for (const [key, value] of Object.entries(fileEnv)) env[key] = value
  return env
}

async function assertProductionWriteRejected(cloneDir, env) {
  const prodEnv = { ...env, NODE_ENV: 'production', PORT: '3001', HOST: '127.0.0.1' }
  // A blank value stays blank. The API loads .env but does not replace it.
  // Loopback dashboard writes stay open. Ingest without a token is 401.
  prodEnv.INGEST_TOKEN = ''
  const logPath = path.join(cloneDir, 'production-api.log')
  const fd = openSync(logPath, 'w')
  const child = spawn('node', ['dist/main.js'], {
    cwd: path.join(cloneDir, 'apps/api'),
    env: prodEnv,
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  try {
    await waitFor('http://127.0.0.1:3001/health', (res) => res.ok, 120000)
    const tickets = await fetch('http://127.0.0.1:3001/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const ticketBody = await tickets.json().catch(() => null)
    if (tickets.status !== 400 || ticketBody?.message !== 'title is required') {
      throw new Error(
        `Expected 400 title is required for a production loopback dashboard write, got ${tickets.status} ${JSON.stringify(ticketBody)}`,
      )
    }
    const events = await fetch('http://127.0.0.1:3001/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'hello', payload: {} }),
    })
    const eventBody = await events.json().catch(() => null)
    if (events.status !== 401 || eventBody?.message !== 'unauthorized') {
      throw new Error(
        `Expected 401 unauthorized for production ingest with no token, got ${events.status} ${JSON.stringify(eventBody)}`,
      )
    }
    console.log('production loopback dashboard write is open and ingest without a token is 401')
  } catch (err) {
    console.error(tail(logPath))
    throw err
  } finally {
    killGroup(child)
    closeSync(fd)
  }
}

async function assertDevRejectsMissingHeader(env) {
  const tickets = await fetch('http://127.0.0.1:3000/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  const ticketBody = await tickets.json().catch(() => null)
  if (tickets.status !== 400 || ticketBody?.message !== 'title is required') {
    throw new Error(
      `A loopback dashboard write must stay open when the caller is this machine. Got ${tickets.status} ${JSON.stringify(ticketBody)}`,
    )
  }
  const events = await fetch('http://127.0.0.1:3000/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'hello', payload: {} }),
  })
  const body = await events.json().catch(() => null)
  if (events.status !== 401 || body?.message !== 'unauthorized') {
    throw new Error(
      `Expected 401 unauthorized when INGEST_TOKEN is set and the ingest header is missing, got ${events.status} ${JSON.stringify(body)}`,
    )
  }
  if (!env.INGEST_TOKEN) {
    throw new Error('The example env did not set INGEST_TOKEN, so this check is not meaningful.')
  }
  console.log('direct ingest without x-ingest-token returned 401')
}

async function ensureBrowser(cloneDir, env) {
  const chrome = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((file) => existsSync(file))
  if (chrome) return { ...env, MC_CHROME_CHANNEL: 'chrome' }
  await runInherit('npx', ['playwright', 'install', '--with-deps', 'chromium'], { cwd: cloneDir, env })
  return env
}

export async function freshClone({
  source = ROOT,
  readmePath = path.join(source, 'README.md'),
  keep = false,
} = {}) {
  const markdown = readFileSync(readmePath, 'utf8')
  const commands = readInstallCommands(markdown)
  const workParent = mkdtempSync(path.join(tmpdir(), 'mc-fresh-'))
  const plan = buildInstallScript(commands, { source, workParent })
  const devLog = path.join(workParent, 'dev.log')
  let dev = null
  try {
    console.log(`Clean directory: ${workParent}`)
    const install = await runShell(plan.script, { cwd: workParent, inherit: true })
    if (install.code !== 0) {
      throw new Error(`A README install command failed (exit ${install.code}).`)
    }
    const example = path.join(plan.cloneDir, '.env.example')
    const envFile = path.join(plan.cloneDir, '.env')
    if (!existsSync(envFile) || !existsSync(example)) {
      throw new Error('The README install did not create .env from .env.example.')
    }
    if (readFileSync(envFile).equals(readFileSync(example)) === false) {
      throw new Error('Fresh clone must copy .env.example to .env with no edits.')
    }
    const env = envFromClone(plan.cloneDir)
    await runInherit('npm', ['test'], { cwd: plan.cloneDir, env })
    await runInherit('npm', ['run', 'build'], { cwd: plan.cloneDir, env })
    await runInherit('python3', ['-m', 'unittest', 'discover', '-s', 'bridge', '-p', 'test_*.py'], {
      cwd: plan.cloneDir,
      env,
    })
    await assertProductionWriteRejected(plan.cloneDir, env)

    const fd = openSync(devLog, 'w')
    dev = spawn('npm', ['run', 'dev'], {
      cwd: plan.cloneDir,
      env,
      detached: true,
      stdio: ['ignore', fd, fd],
    })
    dev.on('error', (err) => {
      console.error(err)
    })
    try {
      const health = await waitFor(
        'http://127.0.0.1:3000/health',
        (res) => {
          if (!res.ok) return false
          try {
            const body = JSON.parse(res.text)
            return body.status === 'ok' && body.database === 'connected'
          } catch {
            return false
          }
        },
        240000,
      )
      console.log(`health ${health.status} ${health.text}`)
      await waitFor(
        'http://127.0.0.1:5173/',
        (res) => res.ok && res.text.includes('Mission Control') && res.text.includes('id="root"'),
        240000,
      )
    } catch (err) {
      console.error(tail(devLog))
      throw err
    } finally {
      closeSync(fd)
    }

    if (plan.afterDev.length) {
      const after = await runShell(['set -euo pipefail', ...plan.afterDev].join('\n'), {
        cwd: plan.cloneDir,
        env,
        inherit: true,
      })
      if (after.code !== 0) {
        throw new Error(`A README command after npm run dev failed (exit ${after.code}).`)
      }
    }

    await runInherit('npm', ['run', 'doctor'], { cwd: plan.cloneDir, env })
    await assertDevRejectsMissingHeader(env)
    const smokeEnv = await ensureBrowser(plan.cloneDir, env)
    // A fresh database has no sample rows. Prove the empty states, then seed.
    await runInherit('node', ['scripts/empty-state.mjs'], { cwd: plan.cloneDir, env: smokeEnv })
    await runInherit('npm', ['run', 'seed:demo'], { cwd: plan.cloneDir, env })
    await waitUntilApiSettles()
    await runInherit('node', ['scripts/ui-smoke.mjs'], { cwd: plan.cloneDir, env: smokeEnv })
    await runInherit('npm', ['run', 'test:e2e'], { cwd: plan.cloneDir, env })
    await runInherit('node', ['scripts/roster-ui.e2e.mjs'], { cwd: plan.cloneDir, env: smokeEnv })
    await runInherit('node', ['scripts/office-live.e2e.mjs'], { cwd: plan.cloneDir, env: smokeEnv })
    console.log('Fresh clone passed.')
  } finally {
    killGroup(dev)
    if (!keep) rmSync(workParent, { recursive: true, force: true })
  }
}

export function installMode(env = process.env) {
  const mode = String(env.FRESH_INSTALL_MODE || '').trim()
  if (!mode) return ''
  if (mode === 'compose' || mode === 'native') return mode
  throw new Error('FRESH_INSTALL_MODE must be compose or native.')
}

export const COMPOSE_PASSWORD_RESET = 'docker compose exec api npm run password:reset'

/**
 * Empty when npm or node runs inside docker compose exec or run.
 * Otherwise the host tool name, or empty when the command uses neither.
 */
export function hostNodeInvocation(command) {
  const trimmed = String(command).trim()
  if (/^docker compose (exec|run)\b/.test(trimmed)) return ''
  const hit = trimmed.match(/\b(node|npm|npx)\b/)
  return hit ? hit[1] : ''
}

export function parseDashboardPassword(text) {
  const match = String(text).match(/^Dashboard password, shown once: ([^\r\n]+)$/m)
  return match ? match[1] : ''
}

/** Host URL the installer told the operator to open, with localhost pinned to 127.0.0.1. */
export function parseInstallerUrl(text) {
  const match = String(text).match(/^Open http:\/\/localhost:(\d+)\/#\/tasks\s*$/m)
  if (!match) return ''
  return `http://127.0.0.1:${match[1]}/`
}

/**
 * Every port number the installer output names (issue 117). A native install
 * must print only ports that answer, and never the tunnel port.
 */
export function parsePrintedPorts(text) {
  const ports = new Set()
  for (const match of String(text).matchAll(/(?:localhost|127\.0\.0\.1):(\d+)|\b[Pp]ort (\d+)/g)) {
    ports.add(Number(match[1] ?? match[2]))
  }
  return [...ports]
}

/** TCP connect, so a printed Postgres port (MC_DB_PORT) counts as answering. */
export function portAnswers(port, host = '127.0.0.1', timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = connect({ port, host })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

function ipv4First(env) {
  const current = String(env.NODE_OPTIONS || '')
  if (current.includes('ipv4first')) return env
  return {
    ...env,
    NODE_OPTIONS: [current, '--dns-result-order=ipv4first'].filter(Boolean).join(' '),
  }
}

function pathWithoutHostNode(pathValue) {
  return String(pathValue || '')
    .split(path.delimiter)
    .filter((entry) => {
      if (!entry || !existsSync(entry)) return false
      return !['node', 'npm', 'npx'].some((name) => existsSync(path.join(entry, name)))
    })
    .join(path.delimiter)
}

function prependDockerStub(workParent, env) {
  const bin = path.join(workParent, 'docker-stub')
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  return { ...env, PATH: `${bin}${path.delimiter}${env.PATH || ''}` }
}

function apiUrlFor(fileEnv, mode) {
  const port = mode === 'compose' ? fileEnv.MC_API_PORT || '3000' : fileEnv.PORT || fileEnv.MC_API_PORT || '3000'
  return `http://127.0.0.1:${port}`
}

/**
 * data/docs must belong to the user running the installer. A root owned
 * directory would make a later cleanup need sudo, and that fallback would
 * hide the regression.
 */
export function docsOwnerError(cloneDir, uid = typeof process.getuid === 'function' ? process.getuid() : null) {
  const docs = path.join(cloneDir, 'data', 'docs')
  if (!existsSync(docs)) return 'data/docs is missing before cleanup.'
  const owner = statSync(docs).uid
  if (uid === null) return ''
  if (owner !== uid) return `data/docs is owned by uid ${owner}, not the runner uid ${uid}.`
  return ''
}

const DOCKER_HEALTH_JS =
  'fetch("http://127.0.0.1:3000/health").then(async (res) => { if (!res.ok) process.exit(1); const body = await res.json(); const ok = body && body.status === "ok" && body.database === "connected"; process.exit(ok ? 0 : 1); }).catch(() => process.exit(1))'

async function assertNativeDatabase(env) {
  const check = await runShell(
    'pg_isready -h 127.0.0.1 -p 5432 && psql "postgresql://postgres:postgres@127.0.0.1:5432/mission_control" -tAc "SELECT 1"',
    { env },
  )
  if (check.code !== 0) {
    throw new Error(
      'Native install needs Postgres 16 on 127.0.0.1:5432, database mission_control, user postgres. The password is the local default from .env.example.',
    )
  }
}

async function waitForApi(apiUrl, mode, cloneDir, env) {
  const start = Date.now()
  while (Date.now() - start < 180000) {
    const res = await httpGet(`${apiUrl}/health`)
    if (mode === 'native' && res.ok) {
      try {
        const body = JSON.parse(res.text)
        if (body.status === 'ok' && body.database === 'connected') return
      } catch {
        // Keep waiting until the body is the health document.
      }
    }
    if (mode === 'compose' && res.status === 401) {
      const inside = await runShell(`docker compose exec -T api node -e ${shellQuote(DOCKER_HEALTH_JS)}`, {
        cwd: cloneDir,
        env,
      })
      if (inside.code === 0) return
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The API did not become ready at ${apiUrl}.`)
}

async function assertInstallAuth({ apiUrl, token, mode }) {
  const missing = await fetch(`${apiUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'hello', payload: {} }),
  })
  const missingBody = await missing.json().catch(() => null)
  if (missing.status !== 401 || missingBody?.message !== 'unauthorized') {
    throw new Error(`Ingest without a token returned ${missing.status}.`)
  }
  const authed = await fetch(`${apiUrl}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': token },
    body: JSON.stringify({ type: 'hello', payload: {} }),
  })
  const authedBody = await authed.json().catch(() => null)
  if (authed.status !== 202 || authedBody?.accepted !== true) {
    throw new Error(`Ingest with the installer token returned ${authed.status}.`)
  }
  const devices = await fetch(`${apiUrl}/devices`)
  if (mode === 'compose') {
    const body = await devices.json().catch(() => null)
    if (devices.status !== 401 || body?.message !== 'unauthorized') {
      throw new Error(`Compose dashboard read without a session returned ${devices.status}.`)
    }
    const tickets = await fetch(`${apiUrl}/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const ticketBody = await tickets.json().catch(() => null)
    if (tickets.status !== 401 || ticketBody?.message !== 'unauthorized') {
      throw new Error(`Compose ticket write without a session or token returned ${tickets.status}.`)
    }
    console.log('Compose login is required and ingest without a token is 401')
    return
  }
  if (devices.status !== 200) {
    throw new Error(`Native loopback GET /devices returned ${devices.status}.`)
  }
  const tickets = await fetch(`${apiUrl}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  const ticketBody = await tickets.json().catch(() => null)
  if (tickets.status !== 400 || ticketBody?.message !== 'title is required') {
    throw new Error(`Native loopback ticket write returned ${tickets.status}.`)
  }
  console.log('Native loopback reads stay open and ingest without a token is 401')
}

function killTree(pid) {
  if (!pid) return
  const listed = spawnSync('ps', ['-o', 'pid=', '--ppid', String(pid)], { encoding: 'utf8' })
  for (const line of String(listed.stdout || '').split(/\n/)) {
    const child = Number(line.trim())
    if (child) killTree(child)
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

async function stopInstall(cloneDir, mode, env) {
  if (!existsSync(cloneDir)) return
  if (mode === 'native') {
    const pidFile = path.join(cloneDir, 'install-dev.pid')
    if (existsSync(pidFile)) killTree(Number(readFileSync(pidFile, 'utf8').trim()))
  }
  if (mode === 'compose' && existsSync(path.join(cloneDir, 'docker-compose.yml'))) {
    await runShell('docker compose down -v --remove-orphans', { cwd: cloneDir, env, inherit: true })
  }
}

function assertDisposableTemp(target) {
  const resolved = path.resolve(target)
  const temp = path.resolve(tmpdir())
  if (resolved === temp || !resolved.startsWith(`${temp}${path.sep}`)) {
    throw new Error(`Refusing to remove ${resolved} outside the temp directory.`)
  }
  return resolved
}

/**
 * Delete the install checkout. Docker may have left a root-owned bind such as
 * data/docs. A normal rm then throws EACCES. Try sudo, then a local image
 * running as root. A cleanup miss is logged and does not throw.
 */
export async function removeInstallWork(workParent, env = process.env, exec = runShell) {
  const resolved = assertDisposableTemp(workParent)
  try {
    rmSync(resolved, { recursive: true, force: true })
    return true
  } catch (err) {
    console.error(
      `Could not remove ${resolved} as this user: ${err instanceof Error ? err.message : err}`,
    )
  }
  const quoted = shellQuote(resolved)
  const attempts = [
    `sudo -n rm -rf ${quoted}`,
    `id="$(docker image ls -q 2>/dev/null | head -n 1)"
if [ -z "$id" ]; then
  exit 1
fi
docker run --rm -v ${quoted}:/work --entrypoint /bin/rm "$id" -rf /work`,
  ]
  for (const script of attempts) {
    const result = await exec(script, { env, inherit: true })
    if (result.code === 0 && !existsSync(resolved)) return true
  }
  console.error(`Cleanup left ${resolved} in place. The install result is unchanged.`)
  return false
}

/**
 * Stop the stack and delete the checkout. Cleanup failures are logged.
 * installError is thrown after cleanup, so a late rm cannot hide it and
 * cannot fail a run that already passed.
 */
export async function finishFreshInstall({
  workParent,
  cloneDir,
  mode,
  env,
  keep = false,
  installError = null,
  stop = stopInstall,
  remove = removeInstallWork,
}) {
  try {
    await stop(cloneDir, mode, env)
    if (!keep) await remove(workParent, env)
  } catch (err) {
    console.error(`Cleanup failed: ${err instanceof Error ? err.message : err}`)
  }
  if (installError) throw installError
}

/**
 * Prove bash install.sh on a clean clone of this checkout.
 * mode compose uses Docker. mode native hides docker so install.sh takes the
 * Node and Postgres path. The bridge then posts the fresh install fixture.
 */
export async function freshInstall({ source = ROOT, mode, keep = false } = {}) {
  if (mode !== 'compose' && mode !== 'native') {
    throw new Error('FRESH_INSTALL_MODE must be compose or native.')
  }
  const workParent = mkdtempSync(path.join(tmpdir(), 'mc-install-'))
  const cloneDir = path.join(workParent, 'mission-control')
  const logPath = path.join(workParent, 'install.log')
  const hideNode = process.env.FRESH_INSTALL_HIDE_NODE === '1'
  let env = ipv4First({ ...process.env })
  const hostPath = env.PATH
  if (hideNode) env = { ...env, PATH: pathWithoutHostNode(env.PATH) }
  let installError = null
  try {
    const cloned = await runShell(`git clone --local ${shellQuote(source)} ${shellQuote(cloneDir)}`, {
      inherit: true,
    })
    if (cloned.code !== 0) throw new Error('git clone of this checkout failed.')
    if (mode === 'native') {
      await assertNativeDatabase(env)
      env = prependDockerStub(workParent, env)
    } else {
      const docker = await runShell('docker compose version', { cwd: cloneDir, env })
      if (docker.code !== 0) throw new Error('Compose install needs Docker with the Compose plugin.')
    }
    console.log(`Installer mode ${mode} in ${cloneDir}`)
    const install = await runShell(`set -o pipefail\nbash install.sh 2>&1 | tee ${shellQuote(logPath)}`, {
      cwd: cloneDir,
      env,
      inherit: true,
    })
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    if (install.code !== 0) {
      console.error(tail(logPath))
      console.error(tail(path.join(cloneDir, 'install-dev.log')))
      throw new Error(`bash install.sh failed (exit ${install.code}).`)
    }
    if (hideNode) {
      if (/did not answer on port/.test(log)) {
        throw new Error('Compose install with no host Node printed that the API did not answer.')
      }
      if (/Node is not on PATH/.test(log)) {
        throw new Error('Compose install skipped doctor because Node was not on PATH.')
      }
      if (!/^(pass|fail|info) ports:/m.test(log)) {
        throw new Error('Compose install with no host Node did not run doctor.')
      }
    }
    const password = parseDashboardPassword(log)
    const webUrl = parseInstallerUrl(log)
    if (!webUrl) throw new Error('The installer did not print the dashboard URL.')
    const fileEnv = loadEnvFile(path.join(cloneDir, '.env'))
    const token = fileEnv.INGEST_TOKEN || ''
    if (!/^[0-9a-f]{48}$/.test(token)) {
      throw new Error('The installer did not write a random INGEST_TOKEN.')
    }
    const apiUrl = apiUrlFor(fileEnv, mode)
    await waitForApi(apiUrl, mode, cloneDir, env)
    await assertInstallAuth({ apiUrl, token, mode })
    await waitFor(webUrl, (res) => res.ok && res.text.includes('Mission Control'), 180000)
    if (mode === 'native') {
      if (/Tunnel port|MC_REMOTE_PORT/.test(log)) {
        throw new Error('The native install printed the tunnel port.')
      }
      for (const port of parsePrintedPorts(log)) {
        if (!(await portAnswers(port))) {
          throw new Error(`The native install printed port ${port}, and nothing answers there.`)
        }
      }
    }
    const bridgeEnv = {
      ...env,
      PATH: hostPath,
      INGEST_TOKEN: token,
      MC_API_URL: apiUrl,
      MC_EXPECT_GATEWAY_SOURCE: mode === 'compose' ? 'bridge' : 'probe',
      MC_BRIDGE_REGISTER: '0',
    }
    if (mode === 'compose') {
      if (!password) throw new Error('The installer did not print a dashboard password.')
      bridgeEnv.MC_DASHBOARD_PASSWORD = password
    }
    await runInherit('node', ['scripts/bridge-fixture.mjs'], { cwd: cloneDir, env: bridgeEnv })
    if (mode === 'compose') {
      const ownerError = docsOwnerError(cloneDir)
      if (ownerError) throw new Error(ownerError)
    }
    console.log(`Fresh ${mode} install passed.`)
  } catch (err) {
    installError = err
  }
  await finishFreshInstall({ workParent, cloneDir, mode, env, keep, installError })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const keep = process.env.FRESH_CLONE_KEEP === '1'
  Promise.resolve()
    .then(() => {
      const mode = installMode()
      if (mode) return freshInstall({ source: ROOT, mode, keep })
      return freshClone({
        source: ROOT,
        readmePath: process.env.FRESH_CLONE_README || path.join(ROOT, 'README.md'),
        keep,
      })
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
