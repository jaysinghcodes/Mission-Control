/**
 * Ticket sheet, priority, delete, and column sort.
 * The API and the web app must already be running.
 * Run: node scripts/ticket-edit.e2e.mjs
 */

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const token = process.env.INGEST_TOKEN || ''
const artifactDir = process.env.MC_ARTIFACT_DIR || '/opt/cursor/artifacts/issue-171'
const actor = 'ticketeditbot'
const stamp = Date.now().toString(36)

function launchOptions() {
  const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  if (process.env.MC_CHROME_CHANNEL) options.channel = process.env.MC_CHROME_CHANNEL
  else if (process.env.MC_CHROME_PATH && existsSync(process.env.MC_CHROME_PATH)) {
    options.executablePath = process.env.MC_CHROME_PATH
  }
  return options
}

function headers(json = false) {
  const out = {}
  if (json) out['content-type'] = 'application/json'
  if (token) out['x-ingest-token'] = token
  return out
}

async function apiSend(method, pathname, body, extra) {
  const hdrs = headers(body !== undefined)
  if (extra) Object.assign(hdrs, extra)
  const res = await fetch(`${api}${pathname}`, {
    method,
    headers: hdrs,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readHealth() {
  try {
    const res = await fetch(`${api}/health`, { cache: 'no-store' })
    const json = await res.json()
    if (json?.status !== 'ok' || json?.database !== 'connected') return null
    return json
  } catch {
    return null
  }
}

const created = []
let previousManual = undefined

async function ensureReady() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (await readHealth()) return
    await sleep(200)
  }
  throw new Error('the API is not up')
}

async function rememberSettings() {
  const settings = await apiSend('GET', '/settings')
  if (settings.status !== 200) throw new Error(`settings ${settings.status}`)
  previousManual = settings.json?.manualMoves ?? null
  if (settings.json?.setupDone !== true) {
    const saved = await apiSend('PUT', '/settings', { setupDone: true })
    if (saved.status !== 200) throw new Error(`setup ${saved.status} ${saved.text}`)
  }
  const unlocked = await apiSend('PUT', '/settings', { manualMoves: true })
  if (unlocked.status !== 200) throw new Error(`manual moves ${unlocked.status} ${unlocked.text}`)
}

async function restoreSettings() {
  if (previousManual === undefined) return
  await apiSend('PUT', '/settings', { manualMoves: previousManual })
  await apiSend('DELETE', `/agents/${actor}`)
  for (const id of created) {
    await apiSend('DELETE', `/tickets/${id}`)
  }
}

async function makeTicket(title, priority, status) {
  const res = await apiSend('POST', '/tickets', { title, priority, status })
  if (res.status !== 201) throw new Error(`create ${res.status} ${res.text}`)
  created.push(res.json.ticket.id)
  return res.json.ticket
}

function watchConsole(page, errors) {
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
}

async function openBoard(page) {
  await page.goto(`${web}/#/tasks`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Tasks' }).waitFor()
}

function column(page, status) {
  return page.locator(`[data-board-column="${status}"]`)
}

async function titlesIn(page, status) {
  return column(page, status).locator('[data-ticket-open]').allTextContents()
}

function chip(page, label) {
  return page.locator('span').filter({ hasText: new RegExp(`^${label}$`) }).first()
}

function shot(page, name) {
  mkdirSync(artifactDir, { recursive: true })
  return page.screenshot({ path: path.join(artifactDir, name) })
}

async function flow(page, width) {
  const title = `Edit me ${stamp} ${width}`
  await openBoard(page)
  await page.getByLabel('New task title').fill(title)
  await page.getByLabel('New task priority').selectOption('high')
  await shot(page, `new-task-priority-${width}.png`)
  await page.getByRole('button', { name: 'New task' }).click()
  const button = page.getByRole('button', { name: title, exact: true })
  await button.waitFor()
  const card = page.locator('.mc-card').filter({ has: button })
  await card.getByText('High', { exact: true }).waitFor()
  if ((await page.getByLabel('New task priority').inputValue()) !== 'med') {
    throw new Error('new task priority did not reset to Medium')
  }
  const createdRes = await apiSend('GET', '/tickets')
  const row = (createdRes.json?.tickets ?? []).find((item) => item.title === title)
  if (!row || row.priority !== 'high') throw new Error('high task was not stored')
  created.push(row.id)

  await button.click()
  const sheet = page.getByRole('dialog', { name: `Edit ${row.key}` })
  await sheet.waitFor()
  await sheet.getByLabel('Title').waitFor()
  await shot(page, `sheet-clean-${width}.png`)
  await sheet.getByLabel('Description').fill('Keep this')
  await shot(page, `sheet-dirty-${width}.png`)
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await sheet.waitFor({ state: 'hidden' })
  await button.click()
  await sheet.waitFor()
  if ((await sheet.getByLabel('Description').inputValue()) !== '') {
    throw new Error('cancel kept the description')
  }
  await sheet.getByLabel('Title').fill('')
  await sheet.getByText('Title is required').waitFor()
  await shot(page, `sheet-errors-${width}.png`)
  await sheet.getByLabel('Title').fill(title)
  const pending = page.waitForRequest((req) => req.method() === 'PATCH' && req.url().includes('/tickets/'))
  await sheet.getByLabel('Priority').selectOption('low')
  await sheet.getByRole('button', { name: 'Save' }).click()
  const body = (await pending).postDataJSON()
  if (JSON.stringify(body) !== JSON.stringify({ priority: 'low' })) {
    throw new Error(`priority patch was ${JSON.stringify(body)}`)
  }
  await page.getByText(`${row.key} saved.`).waitFor()
  await card.getByText('Low', { exact: true }).waitFor()

  await button.click()
  await sheet.waitFor()
  await sheet.getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this ticket' })
  await confirm.getByText(`${row.key} goes away. Its Activity history stays.`).waitFor()
  await shot(page, `delete-confirm-${width}.png`)
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await confirm.waitFor({ state: 'hidden' })
  await button.waitFor()
  await sheet.getByRole('button', { name: 'Delete' }).click()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await page.getByText(`${row.key} deleted.`).waitFor()
  await button.waitFor({ state: 'hidden' })

  const high = await makeTicket(`Sort high ${stamp} ${width}`, 'high', 'todo')
  await sleep(20)
  const low = await makeTicket(`Sort low ${stamp} ${width}`, 'low', 'todo')
  await sleep(20)
  const med = await makeTicket(`Sort med ${stamp} ${width}`, 'med', 'todo')
  await page.reload({ waitUntil: 'networkidle' })
  async function chooseSort(label, value) {
    const box = page.getByRole('combobox', { name: `Sort ${label}` })
    await box.scrollIntoViewIfNeeded()
    await box.selectOption(value)
  }
  await chooseSort('To Do', 'oldest')
  await chooseSort('Build', 'newest')
  await chooseSort('QA', 'priority')
  await chooseSort('Review', 'oldest')
  await page.getByRole('button', { name: 'Show all' }).click()
  await chooseSort('Done', 'oldest')
  const stampButtons = () => page.locator('[data-board-column="todo"] [data-ticket-open]').filter({ hasText: `${stamp} ${width}` })
  const deadline = Date.now() + 5000
  let ordered = []
  while (Date.now() < deadline) {
    ordered = await stampButtons().allTextContents()
    const mine = ordered.filter((text) => text.startsWith('Sort '))
    if (mine.length === 3) {
      ordered = mine
      break
    }
    await sleep(100)
  }
  if (ordered.join('|') !== [`Sort high ${stamp} ${width}`, `Sort low ${stamp} ${width}`, `Sort med ${stamp} ${width}`].join('|')) {
    const ids = await stampButtons().evaluateAll((els) => els.map((el) => el.getAttribute('data-ticket-open')))
    const listed = await apiSend('GET', '/tickets')
    const apiRows = (listed.json?.tickets ?? []).filter((item) => String(item.title).includes(stamp)).map((item) => `${item.id} ${item.title}`)
    throw new Error(`oldest order ${JSON.stringify(ordered)} ids=${JSON.stringify(ids)} api=${JSON.stringify(apiRows)}`)
  }
  await page.getByRole('combobox', { name: 'Sort To Do' }).selectOption('priority')
  const byPriority = (await stampButtons().allTextContents()).filter((text) => text.startsWith('Sort '))
  if (byPriority.join('|') !== [`Sort high ${stamp} ${width}`, `Sort med ${stamp} ${width}`, `Sort low ${stamp} ${width}`].join('|')) {
    throw new Error(`priority order ${JSON.stringify(byPriority)}`)
  }
  await page.locator('[data-board-column="todo"]').scrollIntoViewIfNeeded()
  await shot(page, `column-sort-${width}.png`)
  await page.getByRole('combobox', { name: 'Sort To Do' }).selectOption('newest')
  await page.reload({ waitUntil: 'networkidle' })
  if ((await page.getByRole('combobox', { name: 'Sort To Do' }).inputValue()) !== 'newest') {
    throw new Error('sort did not survive reload')
  }
  if ((await page.getByRole('combobox', { name: 'Sort Build' }).inputValue()) !== 'newest') {
    throw new Error('build sort did not survive reload')
  }
  await page.getByRole('tab', { name: 'Backlog' }).click()
  await page.getByLabel('New backlog item').fill(`Back high ${stamp} ${width}`)
  await page.getByLabel('New task priority').selectOption('high')
  await page.getByRole('button', { name: 'New task' }).click()
  await page.getByRole('button', { name: `Back high ${stamp} ${width}`, exact: true }).waitFor()
  await makeTicket(`Back med ${stamp} ${width}`, 'med', 'backlog')
  await makeTicket(`Back low ${stamp} ${width}`, 'low', 'backlog')
  await page.reload({ waitUntil: 'networkidle' })
  await chip(page, 'High').waitFor()
  await chip(page, 'Medium').waitFor()
  await chip(page, 'Low').waitFor()
  await page.getByRole('combobox', { name: 'Sort Backlog' }).selectOption('oldest')
  await chip(page, 'High').scrollIntoViewIfNeeded()
  await shot(page, `backlog-chips-${width}.png`)
  const listed = await apiSend('GET', '/tickets?status=backlog')
  for (const item of listed.json?.tickets ?? []) {
    if (String(item.title).includes(stamp)) created.push(item.id)
  }
  void high
  void low
  void med
}

async function refusalShot(page, width) {
  const registered = await apiSend('POST', '/agents/register', {
    id: actor,
    name: 'Ticket Edit',
    role: 'writer',
  })
  if (registered.status !== 201 && registered.status !== 200) {
    throw new Error(`register ${registered.status} ${registered.text}`)
  }
  const locked = await apiSend('PUT', '/settings', { manualMoves: false })
  if (locked.status !== 200) throw new Error(`lock ${locked.status}`)
  const ticket = await makeTicket(`Held ${stamp} ${width}`, 'med', 'backlog')
  const moved = await apiSend('PATCH', `/tickets/${ticket.id}`, { status: 'todo' })
  if (moved.status !== 200) throw new Error(`to todo ${moved.status} ${moved.text}`)
  const claimed = await apiSend('PATCH', `/tickets/${ticket.id}`, { status: 'build' }, { 'x-actor-id': actor })
  if (claimed.status !== 200) throw new Error(`claim ${claimed.status} ${claimed.text}`)
  await page.goto(`${web}/#/tasks`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: ticket.title, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: `Edit ${ticket.key}` })
  await sheet.getByText('Agents own this ticket. Turn on Manual moves in Settings to delete it.').waitFor()
  const deleteButton = sheet.getByRole('button', { name: 'Delete' })
  if (await deleteButton.isEnabled()) throw new Error('delete should be disabled')
  await shot(page, `delete-refused-${width}.png`)
  await apiSend('PUT', '/settings', { manualMoves: true })
}

async function main() {
  await ensureReady()
  await rememberSettings()
  const browser = await chromium.launch(launchOptions())
  const errors = []
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 1440 ? 900 : 800 },
      })
      watchConsole(page, errors)
      if (width !== 320) await flow(page, width)
      else {
        await openBoard(page)
        await page.getByLabel('New task priority').waitFor()
        await shot(page, `new-task-priority-${width}.png`)
        const ticket = await makeTicket(`Sheet ${stamp} ${width}`, 'high', 'todo')
        await page.reload({ waitUntil: 'networkidle' })
        await page.getByRole('button', { name: ticket.title, exact: true }).click()
        const sheet = page.getByRole('dialog', { name: `Edit ${ticket.key}` })
        await sheet.waitFor()
        await shot(page, `sheet-clean-${width}.png`)
        await sheet.getByLabel('Description').fill('Dirty on a phone')
        await shot(page, `sheet-dirty-${width}.png`)
        await sheet.getByLabel('Title').fill('')
        await sheet.getByText('Title is required').waitFor()
        await shot(page, `sheet-errors-${width}.png`)
        await sheet.getByLabel('Title').fill(ticket.title)
        await sheet.getByRole('button', { name: 'Delete' }).click()
        await page.getByRole('dialog', { name: 'Delete this ticket' }).waitFor()
        await shot(page, `delete-confirm-${width}.png`)
        await page.getByRole('dialog', { name: 'Delete this ticket' }).getByRole('button', { name: 'Cancel' }).click()
        await page.getByRole('button', { name: 'Close task' }).click()
        await page.getByRole('combobox', { name: 'Sort To Do' }).selectOption('priority')
        await page.locator('[data-board-column="todo"]').scrollIntoViewIfNeeded()
        await shot(page, `column-sort-${width}.png`)
        await page.getByRole('tab', { name: 'Backlog' }).click()
        await makeTicket(`Back high ${stamp} 320`, 'high', 'backlog')
        await makeTicket(`Back med ${stamp} 320`, 'med', 'backlog')
        await makeTicket(`Back low ${stamp} 320`, 'low', 'backlog')
        await page.reload({ waitUntil: 'networkidle' })
        await chip(page, 'High').scrollIntoViewIfNeeded()
        await shot(page, `backlog-chips-${width}.png`)
      }
      await refusalShot(page, width)
      await page.close()
    }
  } finally {
    await browser.close()
    await restoreSettings()
  }
  if (errors.length) throw new Error(`console errors:\n${errors.join('\n')}`)
  console.log('Ticket edit passed.')
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
