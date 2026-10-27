/**
 * Ticket 150. Pair a device is a form on Team that posts a manual device,
 * each row can be removed, and a devices.snapshot refetches open tabs.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/

async function loadTs(rel) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const form = await loadTs('../src/lib/device-form.ts')

test('the allowed types match the API ruling', () => {
  assert.deepEqual([...form.DEVICE_TYPES], ['browser', 'server', 'laptop', 'phone', 'other'])
  assert.equal(form.DEVICE_NAME_MAX, 80)
})

test('a draft needs a trimmed name of at most 80 characters and a known type', () => {
  assert.equal(form.deviceDraftError('  Kitchen laptop ', 'laptop'), null)
  assert.equal(form.deviceDraftError('x'.repeat(80), 'other'), null)
  assert.equal(form.deviceDraftError('   ', 'laptop'), form.DEVICE_COPY.nameRequired)
  assert.equal(form.deviceDraftError('x'.repeat(81), 'laptop'), form.DEVICE_COPY.nameTooLong)
  assert.notEqual(form.deviceDraftError('Laptop', 'tablet'), null)
})

test('a devices.snapshot newer than the last refetch triggers one', () => {
  assert.equal(form.devicesRefreshTs(1000, [{ type: 'agents.snapshot', ts: 5000 }]), null)
  assert.equal(form.devicesRefreshTs(1000, [{ type: 'devices.snapshot', ts: 900 }]), null)
  assert.equal(
    form.devicesRefreshTs(1000, [
      { type: 'devices.snapshot', ts: 2000 },
      { type: 'devices.snapshot', ts: 3000 },
    ]),
    3000,
  )
})

test('copy is short and has no dash punctuation or arrows', () => {
  for (const [key, text] of Object.entries(form.DEVICE_COPY)) {
    assert.equal(DASH.test(text), false, key)
    assert.equal(text.includes('->'), false, key)
    assert.equal(text.includes(' - '), false, key)
    const sentences = text.split(/[.!?](\s|$)/).filter((bit) => bit && bit.trim()).length
    assert.ok(sentences <= 2, key)
  }
})

test('Team posts and deletes devices and refetches on devices.snapshot', async () => {
  const team = await readFile(new URL('../src/pages/Team.tsx', import.meta.url), 'utf8')
  assert.match(team, /apiSend<\{ device: DeviceRow \}>\('POST', '\/devices'/)
  assert.match(team, /apiSend<null>\('DELETE', `\/devices\/\$\{encodeURIComponent\(id\)\}`\)/)
  assert.match(team, /useDevicesLive\(events, devicesQ\.refetch\)/)
  assert.match(team, /<form/)
  assert.equal(DASH.test(team), false)
  assert.equal(team.includes('->'), false)
})
