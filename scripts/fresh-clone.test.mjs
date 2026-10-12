import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildInstallScript, readInstallCommands, runShell } from './fresh-clone.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const README_COMMANDS = [
  'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control',
  'cd mission-control',
  'npm ci',
  'cp .env.example .env',
  'set -a; . ./.env; set +a',
  '(cd apps/api && npx prisma generate)',
  '(cd apps/api && npx prisma migrate deploy)',
  'npm run seed:demo',
  'npm run dev',
]

test('the install block is the README command list', () => {
  const markdown = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.deepEqual(readInstallCommands(markdown), README_COMMANDS)
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

test('a README without npm run dev is rejected', () => {
  assert.throws(
    () => buildInstallScript(['git clone https://example.com/repo.git mission-control', 'npm ci'], {
      source: '/src/mission-control',
      workParent: '/tmp/mc-work',
    }),
    /npm run dev/,
  )
})
