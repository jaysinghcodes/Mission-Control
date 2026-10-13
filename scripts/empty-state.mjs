/**
 * Browser check for a database that has not been seeded.
 * Run this before `npm run seed:demo`. Sample cards mean the check failed.
 */

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')

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

const WINDOW_DOTS = ['rgb(255, 95, 87)', 'rgb(254, 188, 46)', 'rgb(40, 200, 64)']

async function assertNoWindowDots(page) {
  const hits = await page.locator('#app-sidebar span').evaluateAll((els, banned) => {
    return els.filter((el) => {
      const style = getComputedStyle(el)
      const width = Number.parseFloat(style.width)
      return width >= 10 && banned.includes(style.backgroundColor)
    }).length
  }, WINDOW_DOTS)
  if (hits > 0) throw new Error('The sidebar still shows window dots.')
}

async function main() {
  const browser = await chromium.launch(launchOptions())
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  const pages = [
    ['#/tasks', 'Tasks', 'No tasks yet'],
    ['#/agents', 'Agents', 'No agents yet'],
    ['#/office', 'Office', 'Nobody is in the office'],
    ['#/projects', 'Projects', 'No projects yet'],
  ]

  try {
    for (const [hash, heading, empty] of pages) {
      await page.goto(`${web}/${hash}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 30000 })
      // The empty card title is its own line. A page summary can repeat the
      // same words, so match that title exactly.
      const exact = new RegExp(`^${empty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
      await page.locator('div').filter({ hasText: exact }).waitFor({ timeout: 20000 })
      await assertNoWindowDots(page)
    }
    if (errors.length) throw new Error(`Console errors:\n${errors.join('\n')}`)
    console.log('Empty states rendered with no window dots and no console errors.')
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
