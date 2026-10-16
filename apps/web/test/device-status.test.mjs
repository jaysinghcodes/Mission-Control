/**
 * A paired device with no live connection is not online.
 * Pairing time is Paired. A pending request is Requested.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function loadTs(rel) {
  const src = await readFile(new URL(rel, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
}

const { deviceStatus } = await loadTs('../src/lib/device-status.ts')
const format = (iso) => iso

test('a paired device without a connection is not online and is not last seen', () => {
  const status = deviceStatus(
    {
      online: false,
      lastSeenAt: null,
      pairedAt: '2023-07-22T00:00:00.000Z',
      requestedAt: null,
    },
    format,
  )
  assert.equal(status.on, false)
  assert.equal(status.status, 'Paired 2023-07-22T00:00:00.000Z')
  const rows = [
    { online: false },
    { online: true },
  ]
  assert.equal(rows.filter((row) => row.online).length, 1)
})

test('a pending request is Requested and a live connection is Online', () => {
  const requested = deviceStatus(
    {
      online: false,
      lastSeenAt: null,
      pairedAt: null,
      requestedAt: '2026-10-16T12:00:00.000Z',
    },
    format,
  )
  assert.equal(requested.status, 'Requested 2026-10-16T12:00:00.000Z')
  const online = deviceStatus(
    { online: true, lastSeenAt: '2026-10-16T12:00:00.000Z', pairedAt: '2023-01-01T00:00:00.000Z' },
    format,
  )
  assert.equal(online.on, true)
  assert.equal(online.status, 'Online')
  const seen = deviceStatus(
    { online: false, lastSeenAt: '2026-10-16T12:00:00.000Z', pairedAt: '2023-01-01T00:00:00.000Z' },
    format,
  )
  assert.equal(seen.status, 'Last seen 2026-10-16T12:00:00.000Z')
})
