import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

function transpile(src) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const chicagoJs = transpile(await readFile(new URL('../src/lib/chicago-day.ts', import.meta.url), 'utf8'))
const chicagoUrl = 'data:text/javascript;base64,' + Buffer.from(chicagoJs).toString('base64')
let calendarJs = transpile(await readFile(new URL('../src/lib/calendar-days.ts', import.meta.url), 'utf8'))
calendarJs = calendarJs.replace(/from\s+['"]\.\/chicago-day['"]/g, `from ${JSON.stringify(chicagoUrl)}`)
const days = await import('data:text/javascript;base64,' + Buffer.from(calendarJs).toString('base64'))

function stamp(daysList) {
  return daysList.map((day) => `${day.label} ${day.date} ${day.key}`)
}

test('current week labels match each column date', () => {
  // 16:45 UTC on Oct 6 is 11:45 AM CDT. The host zone must not matter.
  const week = days.weekDays(new Date('2026-10-06T16:45:00.000Z'))
  assert.equal(days.labelsMatchDates(week), true)
  assert.deepEqual(stamp(week), [
    'MON 5 2026-10-05',
    'TUE 6 2026-10-06',
    'WED 7 2026-10-07',
    'THU 8 2026-10-08',
    'FRI 9 2026-10-09',
    'SAT 10 2026-10-10',
    'SUN 11 2026-10-11',
  ])
  assert.equal(days.formatWeekRange(week[0].key), 'Oct 5 – Oct 11, 2026')
})

test('a week that spans two months keeps labels on the right dates', () => {
  // Oct 1 2026 is Thursday. Monday start is Sep 28.
  const week = days.weekDays('2026-10-01')
  assert.equal(days.labelsMatchDates(week), true)
  assert.deepEqual(stamp(week), [
    'MON 28 2026-09-28',
    'TUE 29 2026-09-29',
    'WED 30 2026-09-30',
    'THU 1 2026-10-01',
    'FRI 2 2026-10-02',
    'SAT 3 2026-10-03',
    'SUN 4 2026-10-04',
  ])
  assert.equal(week[2].month, 9)
  assert.equal(week[3].month, 10)
  assert.equal(days.formatWeekRange(week[0].key), 'Sep 28 – Oct 4, 2026')
})

test('week of Sunday Nov 1 2026 labels the DST fall-back day and places cron times', () => {
  // 11:00 PM CST on Nov 1 is already Nov 2 in UTC. The week is still Mon Oct 26–Sun Nov 1.
  const now = new Date('2026-11-02T05:00:00.000Z')
  const week = days.weekDays(now)
  assert.equal(days.labelsMatchDates(week), true)
  assert.deepEqual(stamp(week), [
    'MON 26 2026-10-26',
    'TUE 27 2026-10-27',
    'WED 28 2026-10-28',
    'THU 29 2026-10-29',
    'FRI 30 2026-10-30',
    'SAT 31 2026-10-31',
    'SUN 1 2026-11-01',
  ])
  const sunday = week[6]
  assert.equal(sunday.label, 'SUN')
  assert.equal(sunday.date, 1)
  assert.equal(sunday.key, '2026-11-01')

  // Security scan is Sunday 02:00 (CronJob.day 6). 02:00 happens once, after the fall-back.
  assert.equal(days.jobOccursOn({ day: 6 }, sunday.key), true)
  assert.equal(days.jobOccursOn({ day: 6 }, week[5].key), false)
  const scan = days.chicagoWallTime('2026-11-01', 2, 0)
  assert.equal(scan.toISOString(), '2026-11-01T08:00:00.000Z')
  assert.equal(days.placedDay('2026-11-01', '02:00'), '2026-11-01')

  // Weekly review is Friday 16:30 (day 4) on Oct 30, not shifted by the Sunday fallback.
  assert.equal(days.jobOccursOn({ day: 4 }, '2026-10-30'), true)
  assert.equal(days.placedDay('2026-10-30', '16:30'), '2026-10-30')
})

test('11:30 PM America/Chicago stays on that calendar day, not the next UTC day', () => {
  // Oct 31 23:30 CDT is Nov 1 04:30 UTC.
  const cdt = days.chicagoWallTime('2026-10-31', 23, 30)
  assert.equal(cdt.toISOString(), '2026-11-01T04:30:00.000Z')
  assert.equal(days.placedDay('2026-10-31', '23:30'), '2026-10-31')

  // Nov 1 23:30 CST is Nov 2 05:30 UTC. The fall-back has already happened.
  const cst = days.chicagoWallTime('2026-11-01', 23, 30)
  assert.equal(cst.toISOString(), '2026-11-02T05:30:00.000Z')
  assert.equal(days.placedDay('2026-11-01', '23:30'), '2026-11-01')

  // An hour before 11:30 PM CDT, the next daily run is still Oct 31, even though UTC is Nov 1.
  const next = days.nextOccurrence({ day: null, time: '23:30' }, new Date('2026-11-01T04:00:00.000Z'))
  assert.deepEqual(next, { dayKey: '2026-10-31', hour: 23, minute: 30 })

  const onSunday = days.nextOccurrence({ day: 6, time: '23:30' }, new Date('2026-11-02T04:00:00.000Z'))
  assert.deepEqual(onSunday, { dayKey: '2026-11-01', hour: 23, minute: 30 })
})

test('labels name the date itself for both Sunday and Monday week starts', () => {
  const monday = days.weekDays('2026-11-01', 1)
  const sunday = days.weekDays('2026-11-01', 0)
  assert.equal(days.labelsMatchDates(monday), true)
  assert.equal(days.labelsMatchDates(sunday), true)
  assert.equal(days.WEEK_STARTS_ON, 1)
  assert.equal(monday[0].key, '2026-10-26')
  assert.equal(sunday[0].key, '2026-11-01')
  assert.equal(monday.find((day) => day.key === '2026-11-01').label, 'SUN')
  assert.equal(sunday.find((day) => day.key === '2026-11-01').label, 'SUN')
  // The Sunday 02:00 job stays on Nov 1 in either layout.
  assert.equal(days.jobOccursOn({ day: 6 }, '2026-11-01'), true)
  assert.equal(monday.find((day) => day.key === '2026-11-01').cronDay, 6)
  assert.equal(sunday.find((day) => day.key === '2026-11-01').column, 0)
  assert.equal(monday.find((day) => day.key === '2026-11-01').column, 6)
})

test('month headers follow the same dates, including the DST week and a month boundary', () => {
  const october = days.monthGrid('2026-10-26')
  assert.equal(october.title, 'October 2026')
  assert.deepEqual(october.header, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
  assert.equal(days.labelsMatchDates(october.cells.map((cell) => cell.day)), true)
  for (const cell of october.cells) {
    assert.equal(october.header[cell.day.column], cell.day.label)
  }
  const nov1 = october.cells.find((cell) => cell.day.key === '2026-11-01')
  assert.equal(nov1.day.label, 'SUN')
  assert.equal(nov1.day.date, 1)
  assert.equal(nov1.inMonth, false)
  const sep30 = october.cells.find((cell) => cell.day.key === '2026-09-30')
  assert.equal(sep30.day.label, 'WED')
  assert.equal(sep30.inMonth, false)

  const november = days.monthGrid('2026-11-02', 0)
  assert.equal(november.title, 'November 2026')
  assert.deepEqual(november.header, ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'])
  const first = november.cells[0]
  assert.equal(first.day.key, '2026-11-01')
  assert.equal(first.day.label, 'SUN')
  assert.equal(first.day.date, 1)
  assert.equal(first.inMonth, true)
})

test('reading the week again does not move the labels', () => {
  const now = new Date('2026-11-02T05:30:00.000Z')
  const first = days.weekDays(now)
  const again = days.weekDays(now)
  assert.deepEqual(stamp(first), stamp(again))
  const shifted = days.weekDays(days.shiftWeek(first[0].key, 1))
  assert.equal(shifted[0].key, '2026-11-02')
  assert.equal(shifted[0].label, 'MON')
  assert.equal(days.labelsMatchDates(shifted), true)
  const back = days.weekDays(days.shiftWeek(shifted[0].key, -1))
  assert.deepEqual(stamp(back), stamp(first))
})
