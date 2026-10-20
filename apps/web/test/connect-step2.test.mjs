/**
 * /connect step 2 stays short: one or two sentences, the clone and install
 * commands, and a link to docs/INSTALL.md, which holds the install internals.
 * Every step card grows to fit its content, with no nested scroll area.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const INSTALL_GUIDE = 'https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/INSTALL.md'
const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8')

function stepBlock(source, id) {
  const start = source.indexOf(`    id: ${id},`)
  assert.ok(start >= 0, `step ${id}`)
  const end = source.indexOf(`    id: ${id + 1},`, start)
  return source.slice(start, end === -1 ? undefined : end)
}

test('step 2 is one or two sentences, the clone and install commands, and the install guide link', async () => {
  const connect = await read('../src/components/ConnectSteps.tsx')
  const step = stepBlock(connect, 2)
  const body = step.split('body: [')[1].split('],')[0]
  const lines = [...body.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
  assert.equal(lines.length, 1, body)
  const sentences = lines[0].split(/(?<=\.)\s+/).filter(Boolean)
  assert.ok(sentences.length >= 1 && sentences.length <= 2, lines[0])
  assert.match(lines[0], /sets everything up/)
  assert.match(lines[0], /address/)
  assert.match(lines[0], /password/)
  const cmd = step.match(/cmd: '([^']+)'/)[1].split('\\n')
  assert.deepEqual(cmd, [
    'git clone https://github.com/jaysinghcodes/Mission-Control.git mission-control',
    'cd mission-control',
    'bash install.sh',
  ])
  assert.match(step, /label: 'How install works', to: INSTALL_GUIDE, external: true/)
  assert.ok(connect.includes(`export const INSTALL_GUIDE = '${INSTALL_GUIDE}'`))
  assert.equal(DASH.test(connect), false)
  assert.equal(connect.includes('->'), false)
})

test('docs/INSTALL.md holds what step 2 used to say', async () => {
  const install = await read('../../../docs/INSTALL.md')
  for (const fact of [
    'install.log',
    'The run ends with the URL, the password on the first install, and the reset command.',
    'A second run does not print or change the password.',
    'docker compose exec api npm run password:reset',
    'That wait polls /health with curl from the host.',
    'If curl is missing on the host, it runs curl inside the api container',
    'On the Docker path that check runs inside the api container with `docker compose exec`, whether or not Node is on the host.',
    '`MC_API_PORT`, `MC_WEB_PORT`, `MC_DB_PORT`, or `MC_REMOTE_PORT`',
    'Each problem prints on its own line.',
    'It clones into `./mission-control` when you use the one line above.',
    'The macOS runner does not use Docker.',
    'That user can delete the checkout, including `data/docs`.',
    '`npm run seed:demo` on the host writes sample markdown as that same user.',
    'run `npm ci` in the checkout before `npm run seed:demo` or `npm run seed:clear`',
    'A second run keeps every value already in `.env`.',
    'Linux uses a systemd user timer, or cron when that user timer is not available. macOS uses launchd.',
    '`bash install.sh --uninstall-schedule`',
  ]) {
    assert.ok(install.includes(fact), fact)
  }
  assert.equal(DASH.test(install), false)
})

test('the connect sheet grows to fit its content and has no nested scroll area', async () => {
  const page = await read('../src/pages/Connect.tsx')
  const steps = await read('../src/components/ConnectSteps.tsx')
  assert.match(page, /className="flex h-full min-h-0 items-start justify-center overflow-y-auto/)
  assert.equal(/overflow-(x|y)-auto/.test(steps), false)
  assert.equal((page.match(/overflow-(x|y)-auto/g) ?? []).length, 1)
  assert.match(steps, /<pre className="whitespace-pre-wrap [^"]*\[overflow-wrap:anywhere\]/)
  assert.match(page, /flex w-6 flex-col items-center sm:w-16/)
  assert.match(page, /mt-2 hidden whitespace-nowrap text-center text-\[11px\] leading-tight sm:block/)
})
