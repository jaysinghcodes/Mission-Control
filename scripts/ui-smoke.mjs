/**
 * Browser check against the running dev server.
 * Office, Tickets, Runs, and System must render with no console errors.
 * A task created from the page is a write through the UI. The page does not
 * send x-ingest-token. The dev proxy attaches it from the example env.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { assertFullBleed } from './full-bleed.mjs'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

async function seedDemo() {
  // prisma generate rewrites the client and restarts `nest start --watch`.
  // The client is already built. This writes the sample rows only.
  await run('npx', ['ts-node', '--transpile-only', 'scripts/seed-demo.ts'], path.join(root, 'apps', 'api'))
}

const WINDOW_DOTS = new Set(['rgb(255, 95, 87)', 'rgb(254, 188, 46)', 'rgb(40, 200, 64)'])

async function assertNoWindowDots(page) {
  const hits = await page.locator('#app-sidebar span').evaluateAll((els, banned) => {
    return els.filter((el) => {
      const style = getComputedStyle(el)
      const width = Number.parseFloat(style.width)
      return width >= 10 && banned.includes(style.backgroundColor)
    }).length
  }, [...WINDOW_DOTS])
  if (hits > 0) throw new Error('The sidebar still shows window dots.')
}

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
  await seedDemo()
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
    await assertFullBleed(page)
  }

  try {
    await visit('#/office', 'Office')
    await assertNoWindowDots(page)
    await page.getByRole('button', { name: /Forge/ }).first().waitFor({ timeout: 20000 })

    await visit('#/agents', 'Agents')
    await assertNoWindowDots(page)
    await page.getByRole('button', { name: /Speedy/ }).first().waitFor({ timeout: 20000 })

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
