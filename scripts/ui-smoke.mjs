/**
 * Browser check against the running dev server.
 * Office, Tickets, Runs, and System must render with no console errors.
 * A task created from the page is a write through the UI. The page does not
 * send x-ingest-token. The dev proxy attaches it from the example env.
 */

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')

function launchOptions() {
  const options = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }
  if (process.env.MC_CHROME_CHANNEL) options.channel = process.env.MC_CHROME_CHANNEL
  else if (process.env.MC_CHROME_PATH && existsSync(process.env.MC_CHROME_PATH)) {
    options.executablePath = process.env.MC_CHROME_PATH
  }
  return options
}

const errors = []

function note(kind, text) {
  const line = text.trim()
  if (!line) return
  errors.push(`${kind}: ${line}`)
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

async function main() {
  const browser = await chromium.launch(launchOptions())
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', (msg) => {
    if (msg.type() === 'error') note('console', msg.text())
  })
  page.on('pageerror', (err) => note('pageerror', String(err)))

  async function visit(hash, heading) {
    await page.goto(`${web}/${hash}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 30000 })
    await settle()
  }

  try {
    await visit('#/office', 'Office')
    await page.getByRole('button', { name: /Forge/ }).first().waitFor({ timeout: 20000 })

    await visit('#/tickets', 'Tasks')
    if (!page.url().includes('#/tasks')) {
      throw new Error(`/#/tickets did not land on the tasks board. URL is ${page.url()}`)
    }
    await page.getByRole('button', { name: 'Wire calendar week view' }).click()
    const runs = page.getByRole('list', { name: 'Runs' })
    await runs.waitFor({ timeout: 20000 })
    await runs.getByText('Wire calendar week view').waitFor({ timeout: 20000 })
    await settle()

    await visit('#/system', 'System')

    const title = `Fresh clone ${Date.now()}`
    await visit('#/tasks', 'Tasks')
    await page.getByLabel('New task title').fill(title)
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByRole('button', { name: title }).waitFor({ timeout: 20000 })
    await settle()

    const listed = await fetch(`${api}/tickets`).then((res) => res.json())
    const saved = Array.isArray(listed.tickets) && listed.tickets.some((ticket) => ticket.title === title)
    if (!saved) throw new Error('The task created in the browser was not returned by GET /tickets.')
    console.log(`UI write saved: ${title}`)

    if (errors.length) {
      throw new Error(`Console errors:\n${errors.join('\n')}`)
    }
    console.log('Office, Tickets, Runs, and System rendered with no console errors.')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
