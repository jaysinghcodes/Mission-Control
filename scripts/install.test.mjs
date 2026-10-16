/**
 * install.sh behavior that can run without Docker and without macOS.
 * A docker stub stands in for `docker compose`. Token generation, reruns,
 * and doctor output use the real script.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { hasDashPunctuation } from './doctor.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUNCT = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

function outputOf(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`
}

function assignments(text) {
  const out = {}
  for (const line of String(text).split(/\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match) out[match[1]] = match[2]
  }
  return out
}

function nonTokenLines(text) {
  return String(text)
    .split(/\n/)
    .filter((line) => !/^(?:export\s+)?(INGEST_TOKEN|SOCKET_TOKEN)=/.test(line))
}

function pathWithout(names) {
  return (process.env.PATH ?? '')
    .split(':')
    .filter((entry) => entry && !names.some((name) => existsSync(path.join(entry, name))))
    .join(':')
}

function writeExe(file, body) {
  writeFileSync(file, body)
  chmodSync(file, 0o755)
}

function linkCommands(bin, names) {
  mkdirSync(bin, { recursive: true })
  for (const name of names) {
    const found = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' })
    if (found.status !== 0) continue
    const src = found.stdout.trim()
    const dest = path.join(bin, name)
    if (src && !existsSync(dest)) symlinkSync(src, dest)
  }
}

function copyFixture(dir) {
  mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  mkdirSync(path.join(dir, 'apps/api'), { recursive: true })
  cpSync(path.join(root, 'install.sh'), path.join(dir, 'install.sh'))
  cpSync(path.join(root, '.env.example'), path.join(dir, '.env.example'))
  cpSync(path.join(root, 'docker-compose.yml'), path.join(dir, 'docker-compose.yml'))
  cpSync(path.join(root, 'scripts/doctor.mjs'), path.join(dir, 'scripts/doctor.mjs'))
  chmodSync(path.join(dir, 'install.sh'), 0o755)
}

function dockerStub(bin) {
  writeExe(
    path.join(bin, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_STUB_LOG"
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  echo "Docker Compose version v2 stub"
  exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "up" ]; then
  if [ "\${DOCKER_STUB_FAIL:-}" = "1" ]; then
    echo "stub compose failed" >&2
    exit 1
  fi
  exit 0
fi
exit 0
`,
  )
}

const SCHEDULE_ENV_KEYS = [
  'MC_BRIDGE_INTERVAL_SECONDS',
  'MC_BRIDGE_STALE_SECONDS',
  'MC_BRIDGE_REGISTER',
  'MC_BRIDGE_STAMP_FILE',
  'MC_BRIDGE_LOG',
  'MC_BRIDGE_PYTHON',
  'MC_BRIDGE_SCHEDULER',
  'MC_BRIDGE_RUN_NOW',
  'MC_BRIDGE_SCRIPT',
  'MC_BRIDGE_SYSTEMD_DIR',
  'MC_BRIDGE_LAUNCHD_DIR',
  'MC_BRIDGE_LAUNCHD_LABEL',
  'MC_BRIDGE_UNIT_NAME',
  'MC_BRIDGE_CRON_MARK',
  'MC_API_URL',
]

function runInstall(dir, env, args = []) {
  const merged = { ...process.env }
  for (const key of ['MC_WEB_PORT', 'MC_API_PORT', 'MC_DB_PORT', ...SCHEDULE_ENV_KEYS]) {
    if (!Object.prototype.hasOwnProperty.call(env, key)) delete merged[key]
  }
  Object.assign(merged, env)
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key]
  }
  return spawnSync('/bin/bash', ['install.sh', ...args], {
    cwd: dir,
    env: merged,
    encoding: 'utf8',
  })
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function writeNode22Report(bin) {
  writeExe(
    path.join(bin, 'node'),
    `#!/bin/sh
if [ "$1" = "-v" ]; then
  printf '%s\\n' "v22.14.0"
  exit 0
fi
exec ${shellQuote(process.execPath)} "$@"
`,
  )
}

function setApiPort(repo, port) {
  const file = path.join(repo, '.env.example')
  const text = readFileSync(file, 'utf8').replace(/^PORT=\d+$/m, `PORT=${port}`)
  if (!text.includes(`PORT=${port}`)) {
    throw new Error('PORT was not updated in .env.example')
  }
  writeFileSync(file, text)
}

function spawnNodeUntilPort(dir, filename, source) {
  const file = path.join(dir, filename)
  writeFileSync(file, source)
  const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = ''
    child.stdout.on('data', (chunk) => {
      if (settled) return
      buf += chunk
      const line = buf.split('\n')[0]
      if (!line) return
      settled = true
      resolve({ child, port: Number(line) })
    })
    child.once('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      reject(new Error(`${filename} exited ${code}`))
    })
  })
}

function startPlainOk(dir) {
  return spawnNodeUntilPort(
    dir,
    'plain-ok.mjs',
    [
      "import { createServer } from 'node:http'",
      'const server = createServer((req, res) => {',
      "  res.writeHead(200, { 'content-type': 'application/json' })",
      '  res.end(\'{"status":"ok"}\')',
      '})',
      "server.listen(0, '127.0.0.1', () => {",
      '  process.stdout.write(String(server.address().port) + "\\n")',
      '})',
      '',
    ].join('\n'),
  )
}

function delayedHealthSource(port, delayMs) {
  const delay = Number(delayMs)
  const bind = Number(port)
  const listen =
    bind === 0
      ? [
          "server.listen(0, '127.0.0.1', () => {",
          '  process.stdout.write(String(server.address().port) + "\\n")',
          '})',
        ]
      : [
          `server.listen(${bind}, '127.0.0.1', () => {`,
          `  process.stdout.write('${bind}\\n')`,
          '})',
        ]
  return [
    "import { createServer } from 'node:http'",
    `const readyAt = Date.now() + ${delay}`,
    'const healthy = JSON.stringify({ service: "mission-control", status: "ok", database: "connected", db: "up" })',
    'const starting = JSON.stringify({ service: "mission-control", status: "degraded", database: "unavailable", db: "down" })',
    'const server = createServer((req, res) => {',
    '  const body = Date.now() < readyAt ? starting : healthy',
    '  const status = Date.now() < readyAt ? 503 : 200',
    "  res.writeHead(status, { 'content-type': 'application/json' })",
    '  res.end(body)',
    '})',
    ...listen,
    '',
  ].join('\n')
}

function startDelayedHealth(dir, delayMs) {
  return spawnNodeUntilPort(dir, 'delayed-health.mjs', delayedHealthSource(0, delayMs))
}

function startDelayedHealthOn(dir, port, delayMs) {
  return spawnNodeUntilPort(dir, `delayed-health-${port}.mjs`, delayedHealthSource(port, delayMs))
}

function setExampleAssignment(repo, key, value) {
  const file = path.join(repo, '.env.example')
  const text = readFileSync(file, 'utf8')
  const re = new RegExp(`^#?\\s*${key}=.*$`, 'm')
  const next = re.test(text)
    ? text.replace(re, `${key}=${value}`)
    : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`
  if (!next.includes(`${key}=${value}`)) throw new Error(`could not set ${key}`)
  writeFileSync(file, next)
}

function waitForLog(file, needle) {
  const deadline = Date.now() + 2000
  let text = ''
  while (Date.now() < deadline) {
    text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text.includes(needle)) return text
    spawnSync('/bin/sleep', ['0.05'])
  }
  return text
}

function freshDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-install-'))
  const bin = path.join(dir, 'bin')
  const log = path.join(dir, 'docker-stub.log')
  mkdirSync(bin)
  copyFixture(path.join(dir, 'repo'))
  dockerStub(bin)
  writeFileSync(log, '')
  return {
    dir,
    repo: path.join(dir, 'repo'),
    bin,
    log,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DOCKER_STUB_LOG: log,
      DOCKER_STUB_FAIL: '',
      MC_INSTALL_READY_SECONDS: '0',
    },
  }
}

function assertReadableDoctor(text) {
  const lines = text.split(/\n/).filter((line) => /^(pass|fail|info) /.test(line))
  assert.ok(lines.length >= 8, text)
  for (const line of lines) {
    assert.equal(hasDashPunctuation(line), false, line)
    assert.equal(PUNCT.test(line), false, line)
    assert.match(line, /:/)
  }
  return lines
}

function assertNoSecrets(text, tokens) {
  assert.equal(text.includes(tokens.INGEST_TOKEN), false)
  assert.equal(text.includes(tokens.SOCKET_TOKEN), false)
  assert.equal(text.includes('postgres:postgres'), false)
  assert.equal((text.match(/Open http:\/\/localhost:/g) ?? []).length, 1)
}

test('install.sh has no dash punctuation or arrows', () => {
  const script = readFileSync(path.join(root, 'install.sh'), 'utf8')
  assert.equal(PUNCT.test(script), false)
  assert.match(script, /docker compose up -d --build/)
  assert.match(script, /node scripts\/doctor\.mjs/)
})

test('bash -n accepts install.sh', () => {
  const result = spawnSync('bash', ['-n', path.join(root, 'install.sh')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('shellcheck accepts install.sh when shellcheck is installed', () => {
  const which = spawnSync('bash', ['-lc', 'command -v shellcheck'], { encoding: 'utf8' })
  if (which.status !== 0) return
  const result = spawnSync(which.stdout.trim(), [path.join(root, 'install.sh')], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('a fresh run writes unique random tokens, calls compose, and prints the URL', () => {
  const first = freshDir()
  const second = freshDir()
  try {
    const a = runInstall(first.repo, first.env)
    const b = runInstall(second.repo, second.env)
    const textA = outputOf(a)
    const textB = outputOf(b)
    const envA = assignments(readFileSync(path.join(first.repo, '.env'), 'utf8'))
    const envB = assignments(readFileSync(path.join(second.repo, '.env'), 'utf8'))
    const example = assignments(readFileSync(path.join(root, '.env.example'), 'utf8'))
    for (const env of [envA, envB]) {
      assert.match(env.INGEST_TOKEN, /^[0-9a-f]{48}$/)
      assert.match(env.SOCKET_TOKEN, /^[0-9a-f]{48}$/)
      assert.notEqual(env.INGEST_TOKEN, env.SOCKET_TOKEN)
      assert.notEqual(env.INGEST_TOKEN, 'change-me')
      assert.notEqual(env.INGEST_TOKEN, 'dev-ingest-token')
      assert.notEqual(env.SOCKET_TOKEN, 'dev-socket-token')
      assert.notEqual(env.SOCKET_TOKEN, '')
    }
    assert.notEqual(envA.INGEST_TOKEN, envB.INGEST_TOKEN)
    assert.notEqual(envA.SOCKET_TOKEN, envB.SOCKET_TOKEN)
    for (const key of Object.keys(example)) {
      if (key === 'INGEST_TOKEN' || key === 'SOCKET_TOKEN') continue
      assert.equal(envA[key], example[key], key)
    }
    assert.deepEqual(
      nonTokenLines(readFileSync(path.join(first.repo, '.env'), 'utf8')),
      nonTokenLines(readFileSync(path.join(root, '.env.example'), 'utf8')),
    )
    assert.equal(statSync(path.join(first.repo, '.env')).mode & 0o777, 0o600)
    for (const text of [textA, textB]) {
      assert.match(text, /Wrote INGEST_TOKEN and SOCKET_TOKEN to \.env\./)
      assert.match(text, /Starting the stack with Docker Compose\./)
      assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
      assert.match(text, /INGEST_TOKEN and SOCKET_TOKEN are in \.env/)
      assert.match(text, /OpenClaw is optional/)
      assertReadableDoctor(text)
      assert.equal(PUNCT.test(text), false)
    }
    assertNoSecrets(textA, envA)
    assertNoSecrets(textB, envB)
    const log = readFileSync(first.log, 'utf8')
    assert.match(log, /compose version/)
    assert.match(log, /compose up -d --build/)
    const failed = assertReadableDoctor(textA).some((line) => line.startsWith('fail '))
    assert.equal(a.status, failed ? 1 : 0)
  } finally {
    rmSync(first.dir, { recursive: true, force: true })
    rmSync(second.dir, { recursive: true, force: true })
  }
})

test('a rerun keeps existing tokens and every other .env value', () => {
  const fx = freshDir()
  try {
    const first = runInstall(fx.repo, fx.env)
    assert.equal(first.error, undefined)
    const envPath = path.join(fx.repo, '.env')
    const before = readFileSync(envPath)
    const mode = statSync(envPath).mode & 0o777
    chmodSync(envPath, 0o640)
    const second = runInstall(fx.repo, fx.env)
    const text = outputOf(second)
    assert.match(text, /Keeping the existing \.env\. Tokens and other values were not changed\./)
    assert.deepEqual(readFileSync(envPath), before)
    assert.equal(statSync(envPath).mode & 0o777, 0o640)
    assert.equal(text.includes(assignments(before.toString('utf8')).INGEST_TOKEN), false)
    assert.match(readFileSync(fx.log, 'utf8'), /compose up -d --build[\s\S]*compose up -d --build/)
    assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
    assert.equal(mode, 0o600)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('an existing .env is not rewritten, even when the token is still change-me', () => {
  const fx = freshDir()
  try {
    const envPath = path.join(fx.repo, '.env')
    const custom = [
      '# kept comment',
      'OPERATOR_NAME=Ada Lovelace',
      'DATABASE_URL=postgresql://kept:secret@db.internal:5432/mission_control',
      'INGEST_TOKEN=change-me',
      'SOCKET_TOKEN=keep-socket',
      'MC_WEB_PORT=5273',
      'CUSTOM_FLAG=do-not-touch',
      '',
    ].join('\n')
    writeFileSync(envPath, custom, { mode: 0o644 })
    writeExe(
      path.join(fx.bin, 'openssl'),
      '#!/bin/sh\necho "openssl should not run" >&2\nexit 99\n',
    )
    const result = runInstall(fx.repo, fx.env)
    const text = outputOf(result)
    assert.equal(readFileSync(envPath, 'utf8'), custom)
    assert.match(text, /Keeping the existing \.env/)
    assert.match(text, /Open http:\/\/localhost:5273\/#\/tasks/)
    assert.equal(text.includes('change-me'), false)
    assert.equal(text.includes('keep-socket'), false)
    assert.equal(text.includes('secret'), false)
    assert.equal(text.includes('Ada Lovelace'), false)
    assert.equal(text.includes('openssl should not run'), false)
    assertReadableDoctor(text)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('missing token keys are appended, and other example lines stay', () => {
  const fx = freshDir()
  try {
    writeFileSync(path.join(fx.repo, '.env.example'), 'PORT=3000\nHOST=127.0.0.1\n# note\n')
    const result = runInstall(fx.repo, fx.env)
    const text = readFileSync(path.join(fx.repo, '.env'), 'utf8')
    const env = assignments(text)
    assert.equal(env.PORT, '3000')
    assert.equal(env.HOST, '127.0.0.1')
    assert.match(env.INGEST_TOKEN, /^[0-9a-f]{48}$/)
    assert.match(env.SOCKET_TOKEN, /^[0-9a-f]{48}$/)
    assert.match(text, /# note/)
    assert.equal(outputOf(result).includes(env.INGEST_TOKEN), false)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('a compose failure does not print the URL', () => {
  const fx = freshDir()
  try {
    const result = runInstall(fx.repo, { ...fx.env, DOCKER_STUB_FAIL: '1' })
    const text = outputOf(result)
    assert.notEqual(result.status, 0)
    assert.match(text, /Docker Compose did not start the stack\./)
    assert.doesNotMatch(text, /Open http:\/\//)
    assert.match(readFileSync(path.join(fx.repo, '.env'), 'utf8'), /INGEST_TOKEN=[0-9a-f]{48}/)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('docker without Node still prints the URL and a readable doctor line', () => {
  const fx = freshDir()
  try {
    const result = runInstall(fx.repo, {
      ...fx.env,
      PATH: `${fx.bin}:/usr/bin:/bin`,
    })
    const text = outputOf(result)
    assert.equal(result.status, 0, text)
    assert.match(text, /^info node: Node is not on PATH/m)
    assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
    assert.equal(PUNCT.test(text), false)
    assert.equal(hasDashPunctuation(text), false)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('a piped installer clones, and a second pipe keeps the clone and the tokens', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'mc-pipe-'))
  try {
    const fixture = path.join(parent, 'fixture')
    const work = path.join(parent, 'work')
    const bin = path.join(parent, 'bin')
    const log = path.join(parent, 'docker-stub.log')
    mkdirSync(work)
    mkdirSync(bin)
    copyFixture(fixture)
    dockerStub(bin)
    writeFileSync(log, '')
    writeExe(
      path.join(bin, 'git'),
      `#!/bin/sh
dest=""
for arg in "$@"; do
  dest="$arg"
done
if [ "$1" != "clone" ]; then
  echo "unexpected git $*" >&2
  exit 1
fi
mkdir -p "$dest"
cp -a "$MC_FIXTURE/." "$dest/"
mkdir -p "$dest/.git"
exit 0
`,
    )
    const script = readFileSync(path.join(root, 'install.sh'))
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DOCKER_STUB_LOG: log,
      DOCKER_STUB_FAIL: '',
      MC_FIXTURE: fixture,
      MC_INSTALL_READY_SECONDS: '0',
    }
    const first = spawnSync('bash', ['-s'], { cwd: work, env, input: script, encoding: 'utf8' })
    const envPath = path.join(work, 'mission-control', '.env')
    const written = readFileSync(envPath)
    const tokens = assignments(written.toString('utf8'))
    assert.match(outputOf(first), /Cloning Mission Control\./)
    assert.match(tokens.INGEST_TOKEN, /^[0-9a-f]{48}$/)
    assert.equal(outputOf(first).includes(tokens.INGEST_TOKEN), false)
    const second = spawnSync('bash', ['-s'], { cwd: work, env, input: script, encoding: 'utf8' })
    assert.match(outputOf(second), /Using the existing clone at mission-control\./)
    assert.deepEqual(readFileSync(envPath), written)
    assert.match(outputOf(second), /Keeping the existing \.env/)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('the native path names Node 22 and Postgres 16 when Docker is missing', () => {
  const fx = freshDir()
  try {
    writeExe(path.join(fx.bin, 'docker'), '#!/bin/sh\nexit 127\n')
    writeExe(path.join(fx.bin, 'node'), '#!/bin/sh\necho "v18.20.8"\nexit 0\n')
    const old = runInstall(fx.repo, {
      ...fx.env,
      PATH: `${fx.bin}:${pathWithout(['node'])}`,
    })
    const oldText = outputOf(old)
    assert.notEqual(old.status, 0)
    assert.match(oldText, /Docker was not found\. Using the native path\. This needs Node\.js 22 and Postgres 16\./)
    assert.match(oldText, /Node\.js v18\.20\.8 is not a supported native runtime/)
    assert.doesNotMatch(oldText, /Open http:\/\//)
    assert.equal(PUNCT.test(oldText), false)

    writeExe(path.join(fx.bin, 'node'), '#!/bin/sh\necho "v22.14.0"\nexit 0\n')
    const bare = path.join(fx.dir, 'bare')
    linkCommands(bare, ['dirname', 'pwd', 'grep', 'tail', 'openssl', 'mktemp', 'chmod', 'mv'])
    const down = runInstall(fx.repo, {
      ...fx.env,
      PATH: `${fx.bin}:${bare}`,
    })
    assert.notEqual(down.status, 0)
    assert.match(outputOf(down), /pg_isready is not on PATH/)
    assert.equal(existsSync(path.join(fx.repo, '.env')), true)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('the native path runs npm ci, migrate, and doctor when Docker is missing', async () => {
  const fx = freshDir()
  let plain
  try {
    plain = await startPlainOk(fx.dir)
    setApiPort(fx.repo, plain.port)
    writeExe(path.join(fx.bin, 'docker'), '#!/bin/sh\nexit 127\n')
    writeNode22Report(fx.bin)
    const nativeLog = path.join(fx.dir, 'native.log')
    writeFileSync(nativeLog, '')
    writeExe(
      path.join(fx.bin, 'npm'),
      '#!/bin/sh\nprintf \'npm %s\\n\' "$*" >> "$NATIVE_LOG"\nexit 0\n',
    )
    writeExe(
      path.join(fx.bin, 'npx'),
      '#!/bin/sh\nprintf \'npx %s\\n\' "$*" >> "$NATIVE_LOG"\nexit 0\n',
    )
    writeExe(path.join(fx.bin, 'pg_isready'), '#!/bin/sh\nexit 0\n')
    writeExe(path.join(fx.bin, 'psql'), '#!/bin/sh\nprintf \'16.4\\n\'\nexit 0\n')
    const result = runInstall(fx.repo, {
      ...fx.env,
      PATH: fx.env.PATH,
      NATIVE_LOG: nativeLog,
      MC_INSTALL_READY_SECONDS: '0',
    })
    const text = outputOf(result)
    const log = waitForLog(nativeLog, 'npm run dev')
    assert.match(text, /Docker was not found\. Using the native path/)
    assert.doesNotMatch(text, /is not a supported native runtime/)
    assert.doesNotMatch(text, /The API is already up/)
    assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
    assertReadableDoctor(text)
    const ci = log.indexOf('npm ci')
    const generate = log.indexOf('npx prisma generate')
    const migrate = log.indexOf('npx prisma migrate deploy')
    const dev = log.indexOf('npm run dev')
    assert.ok(ci >= 0 && generate > ci && migrate > generate && dev > migrate, log)
    assert.equal(text.includes(assignments(readFileSync(path.join(fx.repo, '.env'), 'utf8')).INGEST_TOKEN), false)
  } finally {
    plain?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('docker install waits for a custom MC_API_PORT and doctor exits 0 without host modules', async () => {
  const fx = freshDir()
  let health
  try {
    health = await startDelayedHealth(fx.dir, 1600)
    setExampleAssignment(fx.repo, 'MC_API_PORT', String(health.port))
    const result = runInstall(fx.repo, {
      ...fx.env,
      MC_INSTALL_READY_SECONDS: '8',
    })
    const text = outputOf(result)
    assert.equal(result.status, 0, text)
    assert.match(text, new RegExp(`Waiting for the API health check on port ${health.port}\\.`))
    assert.doesNotMatch(text, /did not answer on port/)
    assert.match(text, new RegExp(`pass ports: Port ${health.port} is already running\\.`))
    assert.doesNotMatch(text, /Port 3000/)
    assert.match(text, /^info database:/m)
    assert.match(text, /^info migrations:/m)
    assert.match(text, /pass health: The health check says the database is up\./)
    assert.equal(/\bfail /.test(text), false, text)
    assert.equal(text.includes('npm ci'), false, text)
    assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
    assert.equal(existsSync(path.join(fx.repo, 'node_modules')), false)
  } finally {
    health?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

function keptEnv(repo, ports) {
  let text = readFileSync(path.join(repo, '.env.example'), 'utf8')
  text = text.replace(/^INGEST_TOKEN=.*$/m, `INGEST_TOKEN=${'ab'.repeat(24)}`)
  text = text.replace(/^SOCKET_TOKEN=.*$/m, `SOCKET_TOKEN=${'cd'.repeat(24)}`)
  for (const [key, value] of Object.entries(ports)) {
    const re = new RegExp(`^#?\\s*${key}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text}${key}=${value}\n`
  }
  const file = path.join(repo, '.env')
  writeFileSync(file, text, { mode: 0o600 })
  return file
}

test('Run A: shell ports with no .env wait on that API port and print that web URL', async () => {
  const fx = freshDir()
  let health
  try {
    health = await startDelayedHealthOn(fx.dir, 3880, 1200)
    const result = runInstall(fx.repo, {
      ...fx.env,
      MC_INSTALL_READY_SECONDS: '8',
      MC_WEB_PORT: '5880',
      MC_API_PORT: '3880',
      MC_DB_PORT: '55880',
    })
    const text = outputOf(result)
    const written = readFileSync(path.join(fx.repo, '.env'), 'utf8')
    assert.equal(result.status, 0, text)
    assert.match(text, /Waiting for the API health check on port 3880\./)
    assert.doesNotMatch(text, /port 3000/)
    assert.match(text, /pass ports: Port 3880 is already running\./)
    assert.match(text, /Open http:\/\/localhost:5880\/#\/tasks/)
    assert.doesNotMatch(text, /localhost:5173/)
    assert.match(written, /^MC_API_PORT=3880$/m)
    assert.match(written, /^MC_WEB_PORT=5880$/m)
    assert.match(written, /^MC_DB_PORT=55880$/m)
    assert.match(text, /Wrote host port values from the environment into \.env\./)
    assert.equal(/\bfail /.test(text), false, text)
  } finally {
    health?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('Run B: ports already in .env are kept and used', async () => {
  const fx = freshDir()
  let health
  try {
    health = await startDelayedHealthOn(fx.dir, 3881, 1200)
    const envFile = keptEnv(fx.repo, {
      MC_API_PORT: '3881',
      MC_WEB_PORT: '5881',
      MC_DB_PORT: '55881',
    })
    const before = readFileSync(envFile)
    const result = runInstall(fx.repo, {
      ...fx.env,
      MC_INSTALL_READY_SECONDS: '8',
    })
    const text = outputOf(result)
    assert.equal(result.status, 0, text)
    assert.match(text, /Keeping the existing \.env/)
    assert.deepEqual(readFileSync(envFile), before)
    assert.match(text, /Waiting for the API health check on port 3881\./)
    assert.match(text, /pass ports: Port 3881 is already running\./)
    assert.match(text, /Open http:\/\/localhost:5881\/#\/tasks/)
    assert.doesNotMatch(text, /localhost:5173/)
    assert.doesNotMatch(text, /Wrote host port values/)
    assert.equal(/\bfail /.test(text), false, text)
  } finally {
    health?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('default ports wait on 3000 and print localhost:5173', async () => {
  const fx = freshDir()
  let health
  try {
    health = await startDelayedHealthOn(fx.dir, 3000, 1200)
    const result = runInstall(fx.repo, {
      ...fx.env,
      MC_INSTALL_READY_SECONDS: '8',
    })
    const text = outputOf(result)
    const written = readFileSync(path.join(fx.repo, '.env'), 'utf8')
    assert.equal(result.status, 0, text)
    assert.match(text, /Waiting for the API health check on port 3000\./)
    assert.match(text, /pass ports: Port 3000 is already running\./)
    assert.match(text, /Open http:\/\/localhost:5173\/#\/tasks/)
    assert.doesNotMatch(written, /^MC_API_PORT=/m)
    assert.doesNotMatch(written, /^MC_WEB_PORT=/m)
    assert.doesNotMatch(written, /^MC_DB_PORT=/m)
    assert.equal(/\bfail /.test(text), false, text)
  } finally {
    health?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

const FOREIGN_CRON = '15 4 * * * echo keep-foreign-job\n# keep this comment\n0 1 * * * echo also-keep\n'

function scheduleFixture({ openclaw = true } = {}) {
  const fx = freshDir()
  const home = path.join(fx.dir, 'home')
  const systemdDir = path.join(fx.dir, 'systemd')
  const launchDir = path.join(fx.dir, 'launch')
  const cronFile = path.join(fx.dir, 'crontab.txt')
  const systemctlLog = path.join(fx.dir, 'systemctl.log')
  const launchctlLog = path.join(fx.dir, 'launchctl.log')
  mkdirSync(home, { recursive: true })
  mkdirSync(systemdDir, { recursive: true })
  mkdirSync(launchDir, { recursive: true })
  mkdirSync(path.join(fx.repo, 'bridge'), { recursive: true })
  cpSync(path.join(root, 'bridge/mc-bridge-sync.py'), path.join(fx.repo, 'bridge/mc-bridge-sync.py'))
  writeFileSync(path.join(systemdDir, 'other.service'), '[Unit]\nDescription=Keep this unit\n')
  writeFileSync(path.join(launchDir, 'com.other.agent.plist'), '<plist><dict></dict></plist>\n')
  writeFileSync(cronFile, FOREIGN_CRON)
  writeFileSync(systemctlLog, '')
  writeFileSync(launchctlLog, '')
  if (openclaw) {
    writeExe(path.join(fx.bin, 'openclaw'), '#!/bin/sh\necho "stub openclaw" >&2\nexit 1\n')
  }
  writeExe(
    path.join(fx.bin, 'crontab'),
    `#!/bin/sh
file="$CRONTAB_FILE"
if [ "$1" = "-l" ]; then
  if [ -f "$file" ]; then
    cat "$file"
    exit 0
  fi
  echo "no crontab for user" >&2
  exit 1
fi
if [ "$1" = "-" ]; then
  cat > "$file"
  exit 0
fi
if [ "$1" = "-r" ]; then
  : > "$file"
  exit 0
fi
echo "unexpected crontab $*" >&2
exit 1
`,
  )
  writeExe(
    path.join(fx.bin, 'systemctl'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$SYSTEMCTL_LOG"
if [ "$1" = "--user" ] && [ "$2" = "show-environment" ]; then
  if [ "\${SYSTEMCTL_USER_DOWN:-}" = "1" ]; then
    echo "user manager is not running" >&2
    exit 1
  fi
  exit 0
fi
exit 0
`,
  )
  writeExe(
    path.join(fx.bin, 'launchctl'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"
exit 0
`,
  )
  writeExe(
    path.join(fx.bin, 'uname'),
    `#!/bin/sh
printf '%s\\n' "\${UNAME_S:-Linux}"
exit 0
`,
  )
  return {
    ...fx,
    home,
    systemdDir,
    launchDir,
    cronFile,
    systemctlLog,
    launchctlLog,
    env: {
      ...fx.env,
      HOME: home,
      XDG_CONFIG_HOME: home,
      CRONTAB_FILE: cronFile,
      SYSTEMCTL_LOG: systemctlLog,
      LAUNCHCTL_LOG: launchctlLog,
      MC_BRIDGE_SYSTEMD_DIR: systemdDir,
      MC_BRIDGE_LAUNCHD_DIR: launchDir,
      MC_BRIDGE_RUN_NOW: '0',
      MC_INSTALL_READY_SECONDS: '0',
      UNAME_S: 'Linux',
      SYSTEMCTL_USER_DOWN: '',
    },
  }
}

function beginCount(text) {
  return (String(text).match(/# BEGIN mission-control-bridge/g) ?? []).length
}

test('bridge schedule: missing OpenClaw skips with exit 0', async () => {
  const fx = scheduleFixture({ openclaw: false })
  let health
  try {
    health = await startDelayedHealth(fx.dir, 0)
    const result = runInstall(fx.repo, {
      ...fx.env,
      PATH: `${fx.bin}:${pathWithout(['openclaw'])}`,
      MC_API_PORT: String(health.port),
      MC_INSTALL_READY_SECONDS: '8',
    })
    const text = outputOf(result)
    assert.equal(result.status, 0, text)
    assert.match(text, /OpenClaw was not found on PATH\. Skipping the bridge schedule\. npm run seed:demo still fills sample data\./)
    assert.doesNotMatch(text, /Installed the bridge schedule/)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(existsSync(path.join(fx.systemdDir, 'mission-control-bridge.timer')), false)
    assert.equal(existsSync(path.join(fx.launchDir, 'com.missioncontrol.bridge.plist')), false)
    assert.equal(readFileSync(path.join(fx.systemdDir, 'other.service'), 'utf8'), '[Unit]\nDescription=Keep this unit\n')
    assert.equal(PUNCT.test(text), false)
    assert.equal(/\bfail /.test(text), false, text)
  } finally {
    health?.child.kill()
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: systemd install and uninstall are idempotent', () => {
  const fx = scheduleFixture()
  try {
    const first = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'systemd' })
    const firstText = outputOf(first)
    assert.match(firstText, /Installed the bridge schedule with systemd\. It runs every 300 seconds\./)
    assert.match(firstText, /Optional: merge bridge\/openclaw\.starter\.json/)
    assert.match(firstText, /This installer does not edit that file\./)
    const service = path.join(fx.systemdDir, 'mission-control-bridge.service')
    const timer = path.join(fx.systemdDir, 'mission-control-bridge.timer')
    const serviceText = readFileSync(service, 'utf8')
    const timerText = readFileSync(timer, 'utf8')
    assert.match(timerText, /OnUnitActiveSec=300s/)
    assert.match(serviceText, /Environment="MC_BRIDGE_REGISTER=1"/)
    assert.match(serviceText, /Environment="MC_API_URL=http:\/\/127\.0\.0\.1:3000"/)
    assert.match(serviceText, /mc-bridge-sync\.py/)
    const token = assignments(readFileSync(path.join(fx.repo, '.env'), 'utf8')).INGEST_TOKEN
    assert.equal(serviceText.includes(token), false)
    assert.equal(timerText.includes(token), false)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(readFileSync(path.join(fx.systemdDir, 'other.service'), 'utf8'), '[Unit]\nDescription=Keep this unit\n')
    assert.match(readFileSync(fx.systemctlLog, 'utf8'), /enable --now mission-control-bridge\.timer/)
    assert.equal(PUNCT.test(firstText), false)

    const second = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'systemd' })
    assert.match(outputOf(second), /Installed the bridge schedule with systemd/)
    assert.equal(readFileSync(service, 'utf8'), serviceText)
    assert.equal(readFileSync(timer, 'utf8'), timerText)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal((readFileSync(fx.systemctlLog, 'utf8').match(/enable --now/g) ?? []).length, 2)

    const logBefore = readFileSync(fx.log, 'utf8')
    const removed = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    const removedText = outputOf(removed)
    const logAfter = readFileSync(fx.log, 'utf8')
    assert.equal(removed.status, 0, removedText)
    assert.match(removedText, /The bridge schedule is uninstalled\./)
    assert.equal(existsSync(service), false)
    assert.equal(existsSync(timer), false)
    assert.equal(readFileSync(path.join(fx.systemdDir, 'other.service'), 'utf8'), '[Unit]\nDescription=Keep this unit\n')
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(readFileSync(path.join(fx.launchDir, 'com.other.agent.plist'), 'utf8').includes('plist'), true)
    assert.equal(logAfter.slice(logBefore.length).includes('compose up'), false)
    const again = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    assert.equal(again.status, 0, outputOf(again))
    assert.match(outputOf(again), /The bridge schedule is uninstalled\./)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: cron install and uninstall leave other lines', () => {
  const fx = scheduleFixture()
  try {
    const first = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'cron' })
    const text = outputOf(first)
    assert.match(text, /Installed the bridge schedule with cron\. It runs every 300 seconds, rounded up to whole minutes by cron\./)
    const cron = readFileSync(fx.cronFile, 'utf8')
    assert.equal(beginCount(cron), 1)
    assert.match(cron, /15 4 \* \* \* echo keep-foreign-job/)
    assert.match(cron, /# keep this comment/)
    assert.match(cron, /0 1 \* \* \* echo also-keep/)
    assert.match(cron, /\*\/5 \* \* \* \* MC_BRIDGE_REGISTER='1'/)
    assert.match(cron, /mc-bridge-sync\.py/)
    assert.equal(existsSync(path.join(fx.systemdDir, 'mission-control-bridge.timer')), false)
    assert.equal(PUNCT.test(text), false)
    const second = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'cron' })
    assert.match(outputOf(second), /Installed the bridge schedule with cron/)
    const again = readFileSync(fx.cronFile, 'utf8')
    assert.equal(beginCount(again), 1)
    assert.equal((again.match(/keep-foreign-job/g) ?? []).length, 1)
    assert.equal((again.match(/also-keep/g) ?? []).length, 1)
    const removed = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    assert.equal(removed.status, 0, outputOf(removed))
    const left = readFileSync(fx.cronFile, 'utf8')
    assert.equal(beginCount(left), 0)
    assert.doesNotMatch(left, /mc-bridge-sync/)
    assert.match(left, /15 4 \* \* \* echo keep-foreign-job/)
    assert.match(left, /# keep this comment/)
    assert.match(left, /0 1 \* \* \* echo also-keep/)
    assert.equal((left.match(/keep-foreign-job/g) ?? []).length, 1)
    const twice = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    assert.equal(twice.status, 0)
    assert.match(readFileSync(fx.cronFile, 'utf8'), /keep-foreign-job/)
    assert.equal(beginCount(readFileSync(fx.cronFile, 'utf8')), 0)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: launchd install and uninstall leave other agents', () => {
  const fx = scheduleFixture()
  try {
    const first = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'launchd' })
    const text = outputOf(first)
    assert.match(text, /Installed the bridge schedule with launchd\. It runs every 300 seconds\./)
    const plistPath = path.join(fx.launchDir, 'com.missioncontrol.bridge.plist')
    const plist = readFileSync(plistPath, 'utf8')
    assert.match(plist, /<key>StartInterval<\/key>\s*<integer>300<\/integer>/)
    assert.match(plist, /<key>MC_BRIDGE_REGISTER<\/key>\s*<string>1<\/string>/)
    assert.match(plist, /mc-bridge-sync\.py/)
    const token = assignments(readFileSync(path.join(fx.repo, '.env'), 'utf8')).INGEST_TOKEN
    assert.equal(plist.includes(token), false)
    assert.match(readFileSync(fx.launchctlLog, 'utf8'), /bootstrap/)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(existsSync(path.join(fx.systemdDir, 'mission-control-bridge.timer')), false)
    assert.equal(readFileSync(path.join(fx.launchDir, 'com.other.agent.plist'), 'utf8').includes('plist'), true)
    assert.equal(PUNCT.test(text), false)
    const second = runInstall(fx.repo, { ...fx.env, MC_BRIDGE_SCHEDULER: 'launchd' })
    assert.match(outputOf(second), /Installed the bridge schedule with launchd/)
    assert.equal(readFileSync(plistPath, 'utf8'), plist)
    const removed = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    assert.equal(removed.status, 0, outputOf(removed))
    assert.equal(existsSync(plistPath), false)
    assert.equal(existsSync(path.join(fx.launchDir, 'com.other.agent.plist')), true)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    const twice = runInstall(fx.repo, fx.env, ['--uninstall-schedule'])
    assert.equal(twice.status, 0)
    assert.match(readFileSync(fx.launchctlLog, 'utf8'), /bootout/)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: Linux without a user manager uses cron', () => {
  const fx = scheduleFixture()
  try {
    const result = runInstall(fx.repo, { ...fx.env, UNAME_S: 'Linux', SYSTEMCTL_USER_DOWN: '1' })
    const text = outputOf(result)
    assert.match(text, /Installed the bridge schedule with cron/)
    assert.equal(beginCount(readFileSync(fx.cronFile, 'utf8')), 1)
    assert.equal(existsSync(path.join(fx.systemdDir, 'mission-control-bridge.timer')), false)
    assert.match(readFileSync(fx.cronFile, 'utf8'), /keep-foreign-job/)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: Darwin uses launchd', () => {
  const fx = scheduleFixture()
  try {
    const result = runInstall(fx.repo, { ...fx.env, UNAME_S: 'Darwin' })
    const text = outputOf(result)
    assert.match(text, /Installed the bridge schedule with launchd/)
    assert.equal(existsSync(path.join(fx.launchDir, 'com.missioncontrol.bridge.plist')), true)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(existsSync(path.join(fx.systemdDir, 'mission-control-bridge.timer')), false)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: shell interval and register win over .env', () => {
  const fx = scheduleFixture()
  const kept = scheduleFixture()
  try {
    const created = runInstall(fx.repo, {
      ...fx.env,
      MC_BRIDGE_SCHEDULER: 'systemd',
      MC_BRIDGE_INTERVAL_SECONDS: '120',
      MC_BRIDGE_REGISTER: '0',
      MC_API_URL: 'http://127.0.0.1:3999',
    })
    const createdText = outputOf(created)
    assert.match(createdText, /Wrote bridge schedule values from the environment into \.env\./)
    assert.match(createdText, /Installed the bridge schedule with systemd\. It runs every 120 seconds\./)
    const written = readFileSync(path.join(fx.repo, '.env'), 'utf8')
    assert.match(written, /^MC_BRIDGE_INTERVAL_SECONDS=120$/m)
    assert.match(written, /^MC_BRIDGE_REGISTER=0$/m)
    assert.match(written, /^MC_API_URL=http:\/\/127\.0\.0\.1:3999$/m)
    const service = readFileSync(path.join(fx.systemdDir, 'mission-control-bridge.service'), 'utf8')
    const timer = readFileSync(path.join(fx.systemdDir, 'mission-control-bridge.timer'), 'utf8')
    assert.match(timer, /OnUnitActiveSec=120s/)
    assert.match(service, /Environment="MC_BRIDGE_REGISTER=0"/)
    assert.match(service, /Environment="MC_API_URL=http:\/\/127\.0\.0\.1:3999"/)
    assert.equal(PUNCT.test(createdText), false)

    const envFile = path.join(kept.repo, '.env')
    const custom = [
      'INGEST_TOKEN=abababababababababababababababababababababababab',
      'SOCKET_TOKEN=cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      'MC_BRIDGE_INTERVAL_SECONDS=300',
      'MC_BRIDGE_REGISTER=1',
      'PORT=3000',
      'HOST=127.0.0.1',
      '',
    ].join('\n')
    writeFileSync(envFile, custom, { mode: 0o600 })
    const before = readFileSync(envFile)
    const rerun = runInstall(kept.repo, {
      ...kept.env,
      MC_BRIDGE_SCHEDULER: 'systemd',
      MC_BRIDGE_INTERVAL_SECONDS: '120',
    })
    assert.match(outputOf(rerun), /Keeping the existing \.env/)
    assert.deepEqual(readFileSync(envFile), before)
    assert.match(readFileSync(path.join(kept.systemdDir, 'mission-control-bridge.timer'), 'utf8'), /OnUnitActiveSec=120s/)
    assert.match(outputOf(rerun), /every 120 seconds/)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
    rmSync(kept.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: a successful run records a stamp', () => {
  const fx = scheduleFixture()
  try {
    const result = runInstall(fx.repo, {
      ...fx.env,
      MC_BRIDGE_SCHEDULER: 'cron',
      MC_BRIDGE_RUN_NOW: '1',
    })
    const text = outputOf(result)
    assert.match(text, /Running the bridge once so a successful sync can record a timestamp before the next interval\./)
    assert.doesNotMatch(text, /The first bridge run exited/)
    const stamp = path.join(fx.repo, 'bridge', '.state', 'last-sync')
    assert.equal(existsSync(stamp), true, text)
    const age = Date.now() / 1000 - Number(readFileSync(stamp, 'utf8').trim())
    assert.ok(age >= 0 && age < 30, readFileSync(stamp, 'utf8'))
    assert.equal(beginCount(readFileSync(fx.cronFile, 'utf8')), 1)
    assert.equal(PUNCT.test(text), false)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})

test('bridge schedule: unknown arguments do not install or uninstall', () => {
  const fx = scheduleFixture({ openclaw: false })
  try {
    const unknown = runInstall(fx.repo, fx.env, ['--nope'])
    const text = outputOf(unknown)
    assert.notEqual(unknown.status, 0)
    assert.match(text, /Unknown argument\. Run bash install\.sh to install, or bash install\.sh --uninstall-schedule to remove the bridge schedule\./)
    assert.equal(existsSync(path.join(fx.repo, '.env')), false)
    assert.equal(readFileSync(fx.cronFile, 'utf8'), FOREIGN_CRON)
    assert.equal(readFileSync(fx.log, 'utf8'), '')
    const extra = runInstall(fx.repo, fx.env, ['--uninstall-schedule', 'extra'])
    assert.notEqual(extra.status, 0)
    assert.equal(existsSync(path.join(fx.repo, '.env')), false)
  } finally {
    rmSync(fx.dir, { recursive: true, force: true })
  }
})
