/**
 * Gateway states on System. Unknown has the bridge hint.
 * Down is a real check and does not use that hint.
 * The header does not say everything is running for Down or Unknown.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

const gen = new URL('./_gen/', import.meta.url)
await mkdir(gen, { recursive: true })

const src = await readFile(new URL('../src/lib/gateway-status.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
})
const out = new URL('gateway-status.js', gen)
await writeFile(out, outputText)

const { GATEWAY_UNKNOWN_HINT, gatewayLine, systemHeadline, systemSummaryLead } = await import(out)

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

test('unknown shows the bridge hint and is not Down', () => {
  const unknown = gatewayLine({ host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'unknown' })
  assert.equal(unknown.ok, false)
  assert.equal(unknown.value, 'Unknown')
  assert.equal(unknown.hint, GATEWAY_UNKNOWN_HINT)
  assert.equal(unknown.hint, 'Gateway status comes from the bridge. Run the bridge to check it.')
  assert.equal(DASH.test(unknown.hint), false)
  assert.equal(systemHeadline(true, { host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'unknown' }), 'Gateway status is unknown')
  assert.equal(systemSummaryLead(true, { host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'unknown' }), 'Gateway status is unknown')
})

test('a real down check names the address and does not claim everything is running', () => {
  const down = gatewayLine({ host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'down' })
  assert.equal(down.ok, false)
  assert.equal(down.value, 'Down at 127.0.0.1:18789')
  assert.equal(down.hint, '')
  assert.equal(systemHeadline(true, { host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'down' }), 'The gateway is down')
  assert.equal(systemSummaryLead(true, { host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'down' }), 'The gateway is down')
  const legacy = gatewayLine({ host: '127.0.0.1', port: 19001, up: false, latencyMs: null })
  assert.equal(legacy.value, 'Down at 127.0.0.1:19001')
  assert.equal(legacy.hint, '')
})

test('an up gateway can say everything is running, and a bad API still wins', () => {
  const up = gatewayLine({ host: '127.0.0.1', port: 18789, up: true, latencyMs: 4, state: 'up' })
  assert.equal(up.ok, true)
  assert.equal(up.hint, '')
  assert.equal(up.value, 'Up at 127.0.0.1:18789, 4 ms')
  const gw = { host: '127.0.0.1', port: 18789, up: true, latencyMs: 4, state: 'up' }
  assert.equal(systemHeadline(true, gw), "Everything's running")
  assert.equal(systemSummaryLead(true, gw), 'All systems normal')
  assert.equal(systemHeadline(false, gw), 'The API is unhappy')
  assert.equal(systemSummaryLead(false, { host: '127.0.0.1', port: 18789, up: false, latencyMs: null, state: 'down' }), 'Degraded')
  const waiting = gatewayLine(undefined)
  assert.equal(waiting.value, 'Waiting')
  assert.equal(waiting.hint, '')
  assert.equal(systemHeadline(true, undefined), 'Checking…')
  assert.equal(systemHeadline(null, gw), 'Checking…')
})

test('System renders the hint and the headline from gateway state', async () => {
  const page = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(page, /gatewayLine\(sys\.data\?\.gateway\)/)
  assert.match(page, /systemHeadline\(/)
  assert.match(page, /systemSummaryLead\(/)
  assert.match(page, /data-testid="gateway-hint"/)
  assert.match(page, /data-testid="system-headline"/)
  assert.match(page, /\{gateway\.hint \?/)
  assert.equal(page.includes('MC_GATEWAY_URL'), false)
  assert.equal(page.includes("health.data.status === 'ok' ? \"Everything's running\""), false)
})
