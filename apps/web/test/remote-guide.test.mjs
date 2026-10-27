/**
 * Settings and System link to the remote access guide.
 * The old SSH only sentence is gone.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const GUIDE = 'https://github.com/jaysinghcodes/Mission-Control/blob/main/docs/REMOTE.md'
const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

test('settings, system, and the pair dialog link to the remote access guide', async () => {
  const settings = await readFile(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  const connect = await readFile(new URL('../src/components/ConnectSteps.tsx', import.meta.url), 'utf8')
  const team = await readFile(new URL('../src/pages/Team.tsx', import.meta.url), 'utf8')
  for (const text of [settings, system, connect, team]) {
    assert.equal(text.includes(GUIDE), true)
    assert.equal(DASH.test(text), false)
    assert.equal(text.includes('->'), false)
    assert.equal(text.includes('sanctioned'), false)
  }
  assert.equal(settings.includes('check your SSH tunnel'), false)
  assert.equal(system.includes('use the SSH tunnel'), false)
  assert.equal(system.includes('SSH tunnel'), false)
  assert.match(system, /Remote access guide/)
  assert.match(system, /Remote access/)
  assert.match(connect, /ssh -L \$\{port\}:127\.0\.0\.1:\$\{port\} ubuntu@your-server-ip/)
  assert.match(connect, /MC_WEB_PORT/)
  assert.match(connect, /localhost:\$\{WEB_PORT\}/)
  assert.doesNotMatch(connect, /-L 3000:127\.0\.0\.1:3000/)
  assert.doesNotMatch(connect, /ssh -L 5173:127\.0\.0\.1:5173/)
  assert.match(team, /Pair a device/)
  assert.match(team, /remote access guide/)
})
