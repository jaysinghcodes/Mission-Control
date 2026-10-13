/**
 * Prove a clean tree can follow the README install block.
 *
 * The bash commands come from the Install and run section. git clone is
 * pointed at this checkout so the job tests the commit under review, not
 * whatever the public default branch happens to be. .env is the example
 * file with no edits. OpenClaw is not started.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEnvFile } from './doctor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function readInstallCommands(markdown) {
  const parts = String(markdown).split(/^## Install and run\s*$/m)
  if (parts.length < 2) {
    throw new Error('README is missing the Install and run section.')
  }
  const section = parts[1].split(/^## /m)[0]
  const fence = section.match(/```bash\r?\n([\s\S]*?)```/)
  if (!fence) throw new Error('README Install and run section has no bash block.')
  return fence[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
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
  delete prodEnv.INGEST_TOKEN
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
    const res = await fetch('http://127.0.0.1:3001/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'production no token' }),
    })
    const body = await res.json().catch(() => null)
    if (res.status !== 401 || body?.message !== 'unauthorized') {
      throw new Error(
        `Expected 401 unauthorized for a production write with no token, got ${res.status} ${JSON.stringify(body)}`,
      )
    }
    console.log('production write with no token returned 401')
  } catch (err) {
    console.error(tail(logPath))
    throw err
  } finally {
    killGroup(child)
    closeSync(fd)
  }
}

async function assertDevRejectsMissingHeader(env) {
  const res = await fetch('http://127.0.0.1:3000/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'direct write without token' }),
  })
  const body = await res.json().catch(() => null)
  if (res.status !== 401 || body?.message !== 'unauthorized') {
    throw new Error(
      `Expected 401 unauthorized when INGEST_TOKEN is set and the header is missing, got ${res.status} ${JSON.stringify(body)}`,
    )
  }
  if (!env.INGEST_TOKEN) {
    throw new Error('The example env did not set INGEST_TOKEN, so this check is not meaningful.')
  }
  console.log('direct write without x-ingest-token returned 401')
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
    console.log('Fresh clone passed.')
  } finally {
    killGroup(dev)
    if (!keep) rmSync(workParent, { recursive: true, force: true })
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const readmePath = process.env.FRESH_CLONE_README || path.join(ROOT, 'README.md')
  freshClone({
    source: ROOT,
    readmePath,
    keep: process.env.FRESH_CLONE_KEEP === '1',
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
