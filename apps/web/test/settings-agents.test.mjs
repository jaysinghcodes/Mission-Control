import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Settings can remove an agent of any source', async () => {
  const src = await readFile(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  assert.match(src, /data-settings-agents/)
  assert.match(src, /data-agent-source/)
  assert.match(src, /apiSend\('DELETE', `\/agents\/\$\{encodeURIComponent\(agent\.id\)\}`\)/)
  assert.match(src, /Remove this agent\?/)
  assert.doesNotMatch(src, /cannot be deleted/)
  assert.doesNotMatch(src, /source !== 'registered'/)
  assert.doesNotMatch(src, /source === 'registered' \? null/)
  assert.equal(/[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/.test(src), false)
})
