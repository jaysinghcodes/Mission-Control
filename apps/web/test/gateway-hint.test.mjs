/**
 * A down gateway probe shows how to set the host and port.
 * An up probe does not.
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

const { GATEWAY_DOWN_HINT, gatewayLine } = await import(out)

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

test('a down gateway shows how to set the host and port', () => {
  const down = gatewayLine({ host: '127.0.0.1', port: 18789, up: false, latencyMs: null })
  assert.equal(down.ok, false)
  assert.equal(down.value, 'Down at 127.0.0.1:18789')
  assert.equal(down.hint, GATEWAY_DOWN_HINT)
  assert.match(down.hint, /Gateway not reachable\./)
  assert.match(down.hint, /Set OPENCLAW_GATEWAY_HOST and OPENCLAW_GATEWAY_PORT/)
  assert.match(down.hint, /Under Compose the default host is host\.docker\.internal/)
  assert.match(down.hint, /Outside Compose the default host is 127\.0\.0\.1/)
  assert.match(down.hint, /The default port is 18789/)
  assert.equal(DASH.test(down.hint), false)
  const composeDown = gatewayLine({ host: 'host.docker.internal', port: 18789, up: false, latencyMs: null })
  assert.equal(composeDown.hint, GATEWAY_DOWN_HINT)
  assert.equal(composeDown.value, 'Down at host.docker.internal:18789')
})

test('an up gateway and a missing probe omit the hint', () => {
  const up = gatewayLine({ host: '127.0.0.1', port: 18789, up: true, latencyMs: 4 })
  assert.equal(up.ok, true)
  assert.equal(up.hint, '')
  assert.equal(up.value, 'Up at 127.0.0.1:18789, 4 ms')
  const waiting = gatewayLine(undefined)
  assert.equal(waiting.value, 'Waiting')
  assert.equal(waiting.hint, '')
})

test('System renders the hint only from a down probe', async () => {
  const page = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(page, /gatewayLine\(sys\.data\?\.gateway\)/)
  assert.match(page, /data-testid="gateway-hint"/)
  assert.match(page, /\{gateway\.hint \?/)
  assert.equal(page.includes('MC_GATEWAY_URL'), false)
})
