import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildInstallScript, readComposeInstallCommands, readInstallCommands, runShell } from './fresh-clone.mjs'

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
  'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control',
  'cd mission-control',
  'cp .env.example .env',
  'docker compose up -d --build',
]

test('the install block is the README command list', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.deepEqual(readInstallCommands(markdown), README_COMMANDS)
})

test('the default install block is docker compose on one port', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.deepEqual(readComposeInstallCommands(markdown), COMPOSE_COMMANDS)
  assert.equal(COMPOSE_COMMANDS.includes('npm run dev'), false)
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

test('a README without npm run dev is rejected', () => {
  assert.throws(
    () => buildInstallScript(['git clone https://example.com/repo.git mission-control', 'npm ci'], {
      source: '/src/mission-control',
      workParent: '/tmp/mc-work',
    }),
    /npm run dev/,
  )
})
