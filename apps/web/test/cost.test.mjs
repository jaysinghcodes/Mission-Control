/**
 * One cost display for the System header and Usage (#116).
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

const { costSummary, costText, dayCostText, priceNote, spendPhrase, PRICE_NOT_SET_SOME } = await loadTs('../src/lib/cost.ts')

test('the note is exact', () => {
  assert.equal(PRICE_NOT_SET_SOME, 'Price not set for some models')
})

test('an unpriced model shows the known total plus the note', () => {
  const usage = { totalCost: 0.3, priceLabel: null, priceNote: 'Price not set for some models' }
  assert.deepEqual(costSummary(usage), { text: '$0.30', note: 'Price not set for some models' })
})

test('a row marked Price not set sets the note even without priceNote', () => {
  const usage = { totalCost: 2, priceLabel: null, providers: [{ priceLabel: null }, { priceLabel: 'Price not set' }] }
  assert.equal(priceNote(usage), 'Price not set for some models')
  const groups = { totalCost: 2, groups: [{ priceLabel: 'Price not set' }] }
  assert.equal(priceNote(groups), 'Price not set for some models')
})

test('nothing priced reads Price not set with the note, never a plain $0', () => {
  const usage = { totalCost: 0, priceLabel: 'Price not set', priceNote: 'Price not set for some models' }
  assert.deepEqual(costSummary(usage), { text: 'Price not set', note: 'Price not set for some models' })
})

test('all local or priced reads $0.00 with no note', () => {
  assert.deepEqual(costSummary({ totalCost: 0, priceLabel: null, priceNote: null, providers: [{ priceLabel: null }] }), {
    text: '$0.00',
    note: null,
  })
})

test('amounts format the same everywhere', () => {
  assert.equal(costText(1.5), '$1.50')
  assert.equal(costText(0.0042), '$0.0042')
  assert.equal(costText(null), 'Price not set')
  assert.equal(costText(null, null, 'No data'), 'No data')
  assert.equal(costText(3, 'Price not set'), 'Price not set')
})

test('System and Usage both use lib/cost and keep no copy of their own', async () => {
  for (const rel of ['../src/pages/System.tsx', '../src/pages/Usage.tsx']) {
    const page = await readFile(new URL(rel, import.meta.url), 'utf8')
    assert.match(page, /from '\.\.\/lib\/cost'/, rel)
    assert.match(page, /costSummary\(/, rel)
    assert.doesNotMatch(page, /function (money|costText)\(/, rel)
    assert.equal(/[\u2012\u2013\u2014\u2015→←]/.test(page), false, rel)
  }
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(system, /spendPhrase\(periodCost, periodName\)/)
  assert.match(system, /dayCostText\(d\)/)
  assert.doesNotMatch(system, /costText\(d\.totalCost/)
})

test('the header reads naturally when nothing is priced and keeps the note', () => {
  assert.equal(spendPhrase({ text: '$1.32', note: null }, 'today'), ' · $1.32 spent today')
  assert.equal(
    spendPhrase({ text: '$1.32', note: 'Price not set for some models' }, 'month to date'),
    ' · $1.32 spent month to date · Price not set for some models',
  )
  assert.equal(
    spendPhrase({ text: 'Price not set', note: 'Price not set for some models' }, 'month to date'),
    ' · Price not set for month to date · Price not set for some models',
  )
})

test('a spend bar day with nothing priced reads Price not set, never $0.00', () => {
  assert.equal(dayCostText({ totalCost: 0, priceLabel: 'Price not set', priceNote: 'Price not set for some models' }), 'Price not set')
  assert.equal(dayCostText({ totalCost: 1.32, priceLabel: null, priceNote: null }), '$1.32')
  assert.equal(dayCostText({ totalCost: 1.32, priceLabel: null, priceNote: 'Price not set for some models' }), '$1.32, price not set for some models')
  assert.equal(dayCostText({ totalCost: 0, priceLabel: null, priceNote: null }), '$0.00')
})
