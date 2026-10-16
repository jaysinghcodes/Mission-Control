import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildInstallScript, installMode, parseDashboardPassword, parseInstallerUrl, readComposeInstallCommands, readInstallCommands, runShell } from './fresh-clone.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const README_COMMANDS = [
  'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control',
  'cd mission-control',
  'npm ci',
  'cp .env.example .env',
  'set -a; . ./.env; set +a',
  '(cd apps/api && npx prisma generate)',
  '(cd apps/api && npx prisma migrate deploy)',
  'npm run dev',
]

const COMPOSE_COMMANDS = [
  'curl -fsSL https://raw.githubusercontent.com/jaysinghcodes/Mission-Control/main/install.sh | bash',
]

test('the install block is the README command list', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.deepEqual(readInstallCommands(markdown), README_COMMANDS)
})

test('the default install block is the install.sh one liner', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.deepEqual(readComposeInstallCommands(markdown), COMPOSE_COMMANDS)
  assert.match(COMPOSE_COMMANDS[0], /install\.sh/)
  assert.equal(COMPOSE_COMMANDS.includes('npm run dev'), false)
  assert.match(markdown, /bash install\.sh/)
  assert.match(markdown, /http:\/\/localhost:5173\/#\/tasks/)
  assert.match(markdown, /Leave `VITE_API_URL` unset/)
})

test('the install script clones this checkout and leaves dev to the caller', () => {
  const plan = buildInstallScript(README_COMMANDS, {
    source: '/src/mission-control',
    workParent: '/tmp/mc-work',
  })
  assert.match(plan.script, /git clone --local '\/src\/mission-control' 'mission-control'/)
  assert.doesNotMatch(plan.script, /github\.com/)
  assert.doesNotMatch(plan.script, /npm run dev/)
  assert.match(plan.script, /cp \.env\.example \.env/)
  assert.equal(plan.cloneDir, '/tmp/mc-work/mission-control')
  assert.deepEqual(plan.afterDev, [])
})

test('a broken README command fails', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-broken-'))
  try {
    writeFileSync(path.join(dir, 'package.json'), '{"name":"broken","private":true}\n')
    const result = await runShell('set -euo pipefail\nnpm run this-script-does-not-exist\n', { cwd: dir })
    assert.notEqual(result.code, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /this-script-does-not-exist/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh install does not seed, and the clone job seeds later', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  const commands = readInstallCommands(markdown)
  assert.equal(commands.includes('npm run seed:demo'), false)
  assert.match(markdown, /npm run seed:clear/)
  assert.match(markdown, /does not load sample data/)
  const clone = readFileSync(path.join(root, 'scripts/fresh-clone.mjs'), 'utf8')
  assert.match(clone, /empty-state\.mjs/)
  assert.match(clone, /run', 'seed:demo'/)
  const smoke = readFileSync(path.join(root, 'scripts/ui-smoke.mjs'), 'utf8')
  assert.match(smoke, /seed-demo\.ts/)
})

test('installer mode is compose, native, or the fresh clone default', () => {
  assert.equal(installMode({}), '')
  assert.equal(installMode({ FRESH_INSTALL_MODE: 'compose' }), 'compose')
  assert.equal(installMode({ FRESH_INSTALL_MODE: 'native' }), 'native')
  assert.throws(() => installMode({ FRESH_INSTALL_MODE: 'windows' }), /compose or native/)
})

test('the installer log yields the password and the dashboard URL', () => {
  const log = 'Dashboard password, shown once: abc_DEF-123\nOpen http://localhost:5173/#/tasks\n'
  assert.equal(parseDashboardPassword(log), 'abc_DEF-123')
  assert.equal(parseInstallerUrl(log), 'http://127.0.0.1:5173/')
  assert.equal(parseDashboardPassword('no password here'), '')
  assert.equal(parseInstallerUrl('Open http://example.com/'), '')
})

test('CI runs Compose and native installs and the fixture bridge', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow, /mode: compose/)
  assert.match(workflow, /os: ubuntu-latest[\s\S]*mode: native/)
  assert.match(workflow, /os: macos-latest[\s\S]*mode: native/)
  assert.match(workflow, /FRESH_INSTALL_MODE: \$\{\{ matrix\.mode \}\}/)
  assert.doesNotMatch(workflow, /macos-latest[\s\S]{0,200}mode: compose/)
  const clone = readFileSync(path.join(root, 'scripts/fresh-clone.mjs'), 'utf8')
  assert.match(clone, /bridge-fixture\.mjs/)
  assert.match(clone, /examples\/fresh-install/)
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.match(readme, /Ubuntu runs the Docker Compose install and the native install/)
  assert.match(readme, /macOS runs the native install only/)
})

test('the ticket auth table does not list a delete route', () => {
  const api = readFileSync(path.join(root, 'docs/API.md'), 'utf8')
  assert.doesNotMatch(api, /Ticket delete/)
  assert.match(api, /There is no ticket delete route/)
  const tickets = api.split('### 4.4 Tickets')[1].split('### 4.5')[0]
  assert.match(tickets, /`POST \/tickets`/)
  assert.match(tickets, /`PATCH \/tickets\/:id`/)
  assert.doesNotMatch(tickets, /DELETE \/tickets/)
})

test('the fresh install fixture dry run maps devices, nodes, approvals, and the gateway', () => {
  const proc = spawnSync(
    'python3',
    ['bridge/mc-bridge-sync.py', '--dry-run', '--from-dir', 'bridge/examples/fresh-install'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(proc.status, 0, proc.stderr)
  const events = proc.stdout
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
  const machines = events.find((event) => event.type === 'devices.snapshot').payload
  const approvals = events.find((event) => event.type === 'approvals.snapshot').payload.approvals
  const gateway = events.find((event) => event.type === 'gateway.snapshot').payload
  assert.deepEqual(
    machines.devices.map((row) => row.id),
    ['fresh-studio', 'pending:req-fresh'],
  )
  assert.deepEqual(
    machines.nodes.map((row) => row.id),
    ['fresh-node'],
  )
  assert.equal(machines.nodes[0].online, true)
  assert.equal(approvals[0].tag, 'FreshInstall')
  assert.equal(gateway.host, '127.0.0.1')
  assert.equal(typeof gateway.up, 'boolean')
})

test('a README without npm run dev is rejected', () => {
  assert.throws(
    () => buildInstallScript(['git clone https://example.com/repo.git mission-control', 'npm ci'], {
      source: '/src/mission-control',
      workParent: '/tmp/mc-work',
    }),
    /npm run dev/,
  )
})
