/**
 * Every /connect step is a title, one or two short sentences, at most one
 * command, and one link to the docs section that holds the rest (#139).
 * The facts the page used to carry live in docs/INSTALL.md and docs/REMOTE.md.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/
const REPO = 'https://github.com/jaysinghcodes/Mission-Control/blob/main/'
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8')

function stepBlock(source, id) {
  const start = source.indexOf(`    id: ${id},`)
  assert.ok(start >= 0, `step ${id}`)
  const end = source.indexOf(`    id: ${id + 1},`, start)
  return source.slice(start, end === -1 ? source.indexOf('\n]\n', start) : end)
}

function strings(text) {
  return [...text.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2])
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).filter(Boolean)
}

/** GitHub heading anchors: lower case, punctuation dropped, spaces become hyphens. */
function anchors(markdown) {
  return markdown
    .split('\n')
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) => l.replace(/^#+ /, '').toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-'))
}

test('each step has one or two sentences, at most one command, and one docs link', async () => {
  const src = await read('../src/components/ConnectSteps.tsx')
  const notes = [...src.matchAll(/note: '([^']+)'/g)].map((m) => m[1])
  assert.equal(notes.length, 4)
  for (let id = 1; id <= 8; id++) {
    const step = stepBlock(src, id)
    const body = strings(step.split('body: [')[1].split('\n    ],')[0].split(/\],\n/)[0])
    let count = body.reduce((n, line) => n + sentences(line).length, 0)
    // Step 7 adds the OS note under its command.
    if (id === 7) for (const note of notes) assert.equal(sentences(note).length, 1, note)
    if (id === 7) count += 1
    assert.ok(count >= 1 && count <= 2, `step ${id} has ${count} sentences`)
    const cmds = [...step.matchAll(/cmd: '([^']+)'/g)].map((m) => m[1])
    assert.ok(cmds.length <= 1, `step ${id} commands`)
    for (const cmd of cmds) {
      for (const line of cmd.split('\\n')) {
        assert.doesNotMatch(line, /^\s*[$#>]/, `step ${id} prompt sign`)
        assert.doesNotMatch(line, /\.\s*$/, `step ${id} ending period`)
        assert.doesNotMatch(line, /[<>]/, `step ${id} placeholder that the shell reads as a redirect`)
      }
    }
    const links = step.split('links: [')[1]
    assert.ok(links, `step ${id} link`)
    assert.equal((links.match(/label: /g) ?? []).length, 1, `step ${id} has one link`)
    assert.doesNotMatch(step, /secrets|vars:/)
  }
  // Step 7 keeps the per OS SSH command, which copies as is.
  assert.match(src, /return `ssh -L \$\{port\}:127\.0\.0\.1:\$\{port\} ubuntu@your-server-ip`/)
  assert.doesNotMatch(src, /<your-server-ip>/)
  assert.equal(DASH.test(src), false)
  const page = await read('../src/pages/Connect.tsx')
  assert.doesNotMatch(page, /SecretsCallout|bridgeChoice/)
  assert.equal(DASH.test(page), false)
})

test('every step link opens a heading that exists in the docs', async () => {
  const src = await read('../src/components/ConnectSteps.tsx')
  const install = await read('../../../docs/INSTALL.md')
  const remote = await read('../../../docs/REMOTE.md')
  const docs = { 'docs/INSTALL.md': anchors(install), 'docs/REMOTE.md': anchors(remote) }
  const slugs = [...src.matchAll(/stepDoc\('([^']+)'\)/g)].map((m) => m[1])
  assert.equal(slugs.length, 6)
  for (const slug of slugs) assert.ok(docs['docs/INSTALL.md'].includes(slug), slug)
  assert.ok(src.includes(`${REPO}docs/REMOTE.md#from-the-connect-page`))
  assert.ok(docs['docs/REMOTE.md'].includes('from-the-connect-page'))
})

test('the facts cut from the page live in the docs', async () => {
  const install = await read('../../../docs/INSTALL.md')
  const remote = await read('../../../docs/REMOTE.md')
  for (const fact of [
    'One command installs Mission Control, and the browser uses one port.',
    'A running OpenClaw instance is the live data source',
    'Docker Compose reads exactly one env file, the root `.env` next to `docker-compose.yml`.',
    'Never invent or guess credentials. Ask the human who owns them.',
    'redact secrets in any echoed output',
    '`.env` is git ignored. Never commit it.',
    '`SESSION_STATE_PATH`',
    '`LOGIN_FAIL_LIMIT`',
    '`LOGIN_WINDOW_SECONDS`',
    '`LOGIN_BACKOFF_MAX_SECONDS`',
    'Do not set it to the Docker bridge.',
    'Compose does not invent a token.',
    '`docker compose ps` shows the status of each service',
    'Inside Compose the log line stays `mission-control api listening on 0.0.0.0:3000`.',
    'Crew seats are saved by agent id.',
    'Health on this same origin shows uptime, client count, and database state.',
    'If the dot stays red, the API is down or this browser has no session.',
    'start the stack on the host with steps 1 to 4, then retry',
    'labeled sample agents, jobs, and tickets',
    'It does not start the OpenClaw gateway.',
    'Approvals stay empty until `MC_BRIDGE_APPROVALS_CMD` prints them.',
    'A future checkedAt is counted from the time the API stored the report.',
    'add the user to the docker group and start a new login session',
    '`maxConcurrent` to 4',
    'There is no ticket delete route.',
    'Office bots that move on real `run.*` events',
  ]) {
    assert.ok(install.includes(fact), fact)
  }
  for (const fact of [
    'On Windows, open PowerShell, which has OpenSSH built in.',
    'keep the SSH session open, run the tunnel again, then retry',
    '`MC_REMOTE_PORT` (default 3011)',
    'Leave `TRUSTED_PROXY` unset.',
    'The page calls the API on that same origin.',
  ]) {
    assert.ok(remote.includes(fact), fact)
  }
  assert.equal(DASH.test(install), false)
  assert.equal(DASH.test(remote), false)
})
