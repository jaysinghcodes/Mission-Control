import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('System period tabs fit their card on narrow screens and keep their labels', async () => {
  const shell = await readFile(new URL('../src/components/shell.tsx', import.meta.url), 'utf8')
  const system = await readFile(new URL('../src/pages/System.tsx', import.meta.url), 'utf8')
  assert.match(system, /ariaLabel="Spend period"\s+fit\s*\/>/)
  assert.match(system, /\{ id: '24h', label: 'Today' \}/)
  assert.match(system, /\{ id: '7d', label: 'Last 7 days' \}/)
  assert.match(system, /\{ id: 'month', label: 'Month to date' \}/)
  assert.match(shell, /fit \? 'flex w-full min-w-0 sm:inline-flex sm:w-auto' : 'inline-flex shrink-0'/)
  assert.match(shell, /fit \? 'min-w-0 flex-auto px-2 sm:flex-none sm:min-w-\[84px\] sm:px-3' : 'min-w-\[84px\] px-3'/)
})

test('other segmented controls keep their fixed width tabs', async () => {
  const shell = await readFile(new URL('../src/components/shell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /fit = false,/)
})
