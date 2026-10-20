/**
 * Issue 92 copy. The sign in page and Settings name the revoke and the wait.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

test('login and settings name the rate limit and the revoke control', async () => {
  const session = await readFile(new URL('../src/lib/session.tsx', import.meta.url), 'utf8')
  const settings = await readFile(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  assert.match(session, /Too many tries\. Try again in a minute\. npm run login:reset clears the lock\./)
  assert.match(session, /status === 429/)
  assert.match(session, /Use the password from install\. Reset it with npm run password:reset\. Loopback on this machine does not ask\./)
  assert.match(session, /Use the password from install\. Reset it with docker compose exec api npm run password:reset\. This install asks on this machine too\./)
  assert.match(session, /compose \? COMPOSE_LOGIN_HELP : NATIVE_LOGIN_HELP/)
  const composeHelp = session.split('export const COMPOSE_LOGIN_HELP')[1]?.split('function ')[0] ?? ''
  assert.doesNotMatch(composeHelp, /loopback/i)
  assert.doesNotMatch(composeHelp, /not from this machine/)
  assert.match(settings, /Revoke sessions/)
  assert.match(settings, /data-settings-revoke="true"/)
  assert.match(settings, /A copied cookie stops working, including after a restart\./)
  assert.equal(DASH.test(session), false)
  assert.equal(DASH.test(settings), false)
  assert.equal(session.includes('->'), false)
  assert.equal(settings.includes('->'), false)
})
