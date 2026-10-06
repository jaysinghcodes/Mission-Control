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

const days = await loadTs('../src/lib/chicago-day.ts')
const started = await loadTs('../src/lib/started.ts')
const groups = await loadTs('../src/lib/memory-groups.ts')

test('23:58 and 00:02 Central land on different days, including DST', () => {
  assert.equal(days.chicagoDay('2026-01-16T05:58:00.000Z'), '2026-01-15')
  assert.equal(days.chicagoDay('2026-01-16T06:02:00.000Z'), '2026-01-16')
  assert.equal(days.chicagoDay('2026-07-16T04:58:00.000Z'), '2026-07-15')
  assert.equal(days.chicagoDay('2026-07-16T05:02:00.000Z'), '2026-07-16')
  assert.equal(days.chicagoDay('2026-03-08T05:58:00.000Z'), '2026-03-07')
  assert.equal(days.chicagoDay('2026-03-08T06:02:00.000Z'), '2026-03-08')
  assert.equal(days.chicagoDay('2026-11-01T04:58:00.000Z'), '2026-10-31')
  assert.equal(days.chicagoDay('2026-11-01T05:02:00.000Z'), '2026-11-01')
})

test('Decided today is a Chicago calendar day, not a rolling 24 hours', () => {
  // 00:30 CDT on Oct 6. A note from 11:00 PM the night before is inside
  // 24 hours and on the previous calendar day.
  const now = new Date('2026-10-06T05:30:00.000Z')
  const rows = [
    { createdAt: '2026-10-06T04:00:00.000Z' }, // Oct 5, 11:00 PM CDT — within 24h
    { createdAt: '2026-10-06T05:10:00.000Z' }, // Oct 6, 12:10 AM CDT
    { createdAt: '2026-10-05T06:00:00.000Z' }, // Oct 5, 1:00 AM CDT — also within 24h of 00:30
  ]
  assert.equal(days.countOnChicagoDay(rows, now), 1)
  const rolling = rows.filter((row) => now.getTime() - new Date(row.createdAt).getTime() < 86_400_000)
  assert.equal(rolling.length, 3)
})

test('Started matches the run by ticket id and uses startedAt', () => {
  const ticket = { id: 'demo-ticket-3', title: 'Wire calendar week view', key: 'DEMO-3', createdAt: '2026-10-01T12:00:00.000Z' }
  const byTitle = { name: 'Wire calendar week view', ticketId: null, startedAt: '2026-10-02T12:00:00.000Z' }
  assert.equal(started.startedIso(ticket, [byTitle]), ticket.createdAt)
  const byKey = { name: 'working on DEMO-3', ticketId: 'other', startedAt: '2026-10-03T12:00:00.000Z' }
  assert.equal(started.startedIso(ticket, [byKey]), ticket.createdAt)
  const real = { ticketId: 'demo-ticket-3', startedAt: '2026-10-04T15:00:00.000Z', name: 'unrelated title' }
  assert.equal(started.startedIso(ticket, [byTitle, real]), '2026-10-04T15:00:00.000Z')
  const unstarted = { ticketId: 'demo-ticket-3', startedAt: null }
  assert.equal(started.startedIso(ticket, [unstarted]), '')
})

test('saved time names the Chicago date and the zone, so the two 1:30s differ', () => {
  // Fall back is 2026-11-01 02:00 CDT → 01:00 CST.
  // 01:30 CDT is 06:30 UTC. 01:30 CST is 07:30 UTC.
  const cdt = days.formatChicagoSaved('2026-11-01T06:30:00.000Z')
  const cst = days.formatChicagoSaved('2026-11-01T07:30:00.000Z')
  assert.match(cdt, /Nov 1, 2026/)
  assert.match(cdt, /1:30/)
  assert.match(cdt, /AM/)
  assert.match(cdt, /CDT/)
  assert.match(cst, /1:30/)
  assert.match(cst, /CST/)
  assert.notEqual(cdt, cst)
})

test('memory groups keep newest day first and skip empty days', () => {
  const grouped = groups.groupMemoryByDay([
    { id: 'a', day: '2026-10-06' },
    { id: 'b', day: '2026-10-06' },
    { id: 'c', day: '2026-10-04' },
    { id: 'd', day: '2026-01-15' },
  ])
  assert.deepEqual(grouped.map((group) => group.day), ['2026-10-06', '2026-10-04', '2026-01-15'])
  assert.deepEqual(grouped[0].entries.map((entry) => entry.id), ['a', 'b'])
  assert.equal(grouped.every((group) => group.entries.length > 0), true)
})
