/**
 * Playwright coverage for roster criteria 1 to 7.
 * Criterion 5 moves a mocked clock 10 minutes past lastSeenAt.
 * The API must already be running, with the demo seed loaded.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { io } from 'socket.io-client'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const token = process.env.INGEST_TOKEN || ''
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const artifactDir = process.env.MC_ARTIFACT_DIR || ''
const readmeDir = process.env.MC_README_DIR || ''

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

function headers(json = false) {
  const out = {}
  if (json) out['content-type'] = 'application/json'
  if (token) out['x-ingest-token'] = token
  return out
}

async function apiSend(method, pathname, body) {
  const res = await fetch(`${api}${pathname}`, {
    method,
    headers: headers(body !== undefined),
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

async function pumpUntil(page, ready) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    await page.clock.runFor(250)
    await sleep(150)
    if (await ready()) return
  }
  throw new Error('criterion 5: the roster did not render under the mocked clock')
}

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`))
    })
  })
}

function bootTime(body) {
  if (!body || typeof body.ts !== 'number' || typeof body.uptimeSeconds !== 'number') return null
  return body.ts - body.uptimeSeconds * 1000
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

function socketConnected(timeoutMs) {
  return new Promise((resolve) => {
    const socket = io(api, { transports: ['websocket'], timeout: timeoutMs, reconnection: false })
    const finish = (ok) => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.close()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.on('connect', () => finish(true))
    socket.on('connect_error', () => finish(false))
  })
}

/**
 * The sidebar says Connected only after /health succeeds and the page's
 * socket connects. The first failed health check sends the operator to
 * /connect and does not try again, so the browser must open against an API
 * that is already staying up.
 */
async function waitForLiveFeed() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const before = await readHealth()
    const booted = bootTime(before)
    if (booted === null) {
      await sleep(100)
      continue
    }
    const up = await socketConnected(2000)
    const after = await readHealth()
    const bootedAfter = bootTime(after)
    if (up && bootedAfter !== null && Math.abs(bootedAfter - booted) < 1500) return
    await sleep(100)
  }
  throw new Error('the API did not keep a live socket after reseed')
}

async function resetRoster() {
  const listed = await apiSend('GET', '/agents')
  if (listed.status !== 200 || !Array.isArray(listed.json?.agents)) {
    throw new Error(`GET /agents failed: ${listed.status} ${listed.text}`)
  }
  for (const agent of listed.json.agents) {
    if (agent.source !== 'registered') continue
    const removed = await apiSend('DELETE', `/agents/${agent.id}`)
    if (removed.status !== 204) {
      throw new Error(`DELETE /agents/${agent.id} returned ${removed.status} ${removed.text}`)
    }
  }
  const snap = await apiSend('POST', '/events', { type: 'agents.snapshot', payload: { agents: [] } })
  if (snap.status !== 202) throw new Error(`empty snapshot returned ${snap.status} ${snap.text}`)
  // npm run seed:demo also runs prisma generate. That rewrites
  // node_modules/.prisma/client, and nest start --watch compiles twice and
  // restarts the API. Skip generate here. The client is already built.
  await run('npx', ['ts-node', '--transpile-only', 'scripts/seed-demo.ts'], path.join(root, 'apps', 'api'))
}

async function shot(page, dir, name) {
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name) })
}

async function openPage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  await page.goto(web, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    try {
      localStorage.removeItem('mc-show-sample-bots')
    } catch {
      // The switch defaults to off when storage is blocked.
    }
  })
  return page
}

async function visit(page, hash, heading) {
  await page.goto(`${web}/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 30000 })
  await sleep(400)
}

async function waitSampleCount(page, min) {
  await page.waitForFunction(
    (need) => document.querySelectorAll('[data-sample-tag="true"]').length >= need,
    min,
    { timeout: 20000 },
  )
}

async function waitConnected(page) {
  const chip = page.getByText(/^Connected/).first()
  try {
    await chip.waitFor({ timeout: 20000 })
  } catch (err) {
    const sidebar = await page.locator('aside').innerText().catch(() => '')
    throw new Error(`live feed was not connected at ${page.url()}\n${sidebar.slice(0, 400)}\n${err instanceof Error ? err.message : err}`)
  }
}

function agent(page, id) {
  return page.locator(`[data-agent-id="${id}"]`).first()
}

async function assertDimmed(page, label) {
  const opacity = await agent(page, 'ribbon').locator('[data-dim="true"]').first().evaluate((el) => getComputedStyle(el).opacity)
  if (Number(opacity) >= 0.6) throw new Error(`${label} opacity was ${opacity}`)
}

async function main() {
  // seed:demo and seed:clear regenerate the Prisma client. nest --watch
  // restarts, sometimes twice. Wait until that process stays up, then reseed.
  await waitForLiveFeed()
  await resetRoster()
  await waitForLiveFeed()
  const browser = await chromium.launch(launchOptions())
  const page = await openPage(browser)
  try {
    await visit(page, '#/agents', 'Agents')
    await waitConnected(page)
    const sampleTags = page.locator('[data-sample-tag="true"]')
    await sampleTags.first().waitFor({ timeout: 20000 })
    const sampleCount = await sampleTags.count()
    if (sampleCount < 12) throw new Error(`criterion 1: expected 12 Sample tags, saw ${sampleCount}`)
    const names = ['Speedy', 'Forge', 'Sentinel', 'Scout']
    for (const name of names) {
      await page.getByRole('button', { name: new RegExp(name) }).first().waitFor()
    }
    await shot(page, artifactDir, 'agents_samples_only.png')
    await shot(page, readmeDir, 'agents.png')

    await visit(page, '#/office', 'Office')
    await waitSampleCount(page, 12)
    await page.getByRole('button', { name: /Forge/ }).first().waitFor()
    await shot(page, artifactDir, 'office_samples_only.png')
    await shot(page, readmeDir, 'office.png')

    await visit(page, '#/team', 'Team')
    await waitSampleCount(page, 12)
    await shot(page, artifactDir, 'team_samples_only.png')
    await shot(page, readmeDir, 'team.png')

    if (readmeDir) await captureGallery(page)

    await visit(page, '#/agents', 'Agents')
    await waitConnected(page)
    const created = await apiSend('POST', '/agents/register', {
      id: 'ribbon',
      name: 'Ribbon',
      role: 'assistant',
    })
    if (created.status !== 201) throw new Error(`criterion 2: register returned ${created.status} ${created.text}`)
    const started = Date.now()
    await agent(page, 'ribbon').waitFor({ timeout: 2000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-sample-tag="true"]').length === 0, null, { timeout: 2000 })
    const elapsed = Date.now() - started
    if (elapsed >= 2000) throw new Error(`criterion 2: roster updated in ${elapsed}ms`)
    if (await page.locator('[data-agent-id="speedy"]').count()) {
      throw new Error('criterion 2: a sample bot was still on Agents')
    }
    await shot(page, artifactDir, 'agents_samples_hidden.png')
    await shot(page, readmeDir, 'agents-real.png')
    await visit(page, '#/office', 'Office')
    await agent(page, 'ribbon').waitFor({ timeout: 5000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-sample-tag="true"]').length === 0, null, { timeout: 5000 })
    await shot(page, artifactDir, 'office_samples_hidden.png')
    await shot(page, readmeDir, 'office-real.png')
    await visit(page, '#/team', 'Team')
    await agent(page, 'ribbon').waitFor({ timeout: 5000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-sample-tag="true"]').length === 0, null, { timeout: 5000 })
    await shot(page, artifactDir, 'team_samples_hidden.png')
    await shot(page, readmeDir, 'team-real.png')

    const before = await apiSend('GET', '/agents/forge')
    const beforeAgent = before.json?.agent
    if (!beforeAgent || beforeAgent.source !== 'default') {
      throw new Error(`criterion 3: forge was not a default before register (${before.status})`)
    }
    const claim = await apiSend('POST', '/agents/register', {
      id: 'forge',
      name: 'Forge',
      role: 'engineer',
    })
    if (claim.status !== 200) throw new Error(`criterion 3: claim returned ${claim.status} ${claim.text}`)
    await visit(page, '#/agents', 'Agents')
    await agent(page, 'forge').waitFor({ timeout: 2000 })
    if (await agent(page, 'forge').locator('[data-sample-tag="true"]').count()) {
      throw new Error('criterion 3: Forge still showed Sample')
    }
    await visit(page, '#/office', 'Office')
    const forgeCard = agent(page, 'forge')
    await forgeCard.waitFor({ timeout: 2000 })
    const buildText = await forgeCard.locator('xpath=ancestor::*[contains(@class,"mc-card")][1]').innerText()
    if (!buildText.includes('Build')) throw new Error(`criterion 3: Forge was not in Build (${buildText.slice(0, 80)})`)
    const after = await apiSend('GET', '/agents/forge')
    if (after.json?.agent?.position !== beforeAgent.position) {
      throw new Error('criterion 3: Forge position changed')
    }
    if (after.json?.agent?.source !== 'registered') throw new Error('criterion 3: Forge was not registered')

    await visit(page, '#/system', 'System')
    const toggle = page.getByRole('switch', { name: 'Show sample bots' })
    await toggle.waitFor()
    if (await toggle.isChecked()) throw new Error('criterion 4: Show sample bots was on before the click')
    await toggle.check()
    if (!(await toggle.isChecked())) throw new Error('criterion 4: the switch did not turn on')
    await shot(page, artifactDir, 'system_show_sample_bots.png')
    await visit(page, '#/agents', 'Agents')
    await agent(page, 'speedy').locator('[data-sample-tag="true"]').waitFor({ timeout: 5000 })
    if (await agent(page, 'forge').locator('[data-sample-tag="true"]').count()) {
      throw new Error('criterion 4: claimed Forge showed Sample')
    }
    if (await agent(page, 'ribbon').locator('[data-sample-tag="true"]').count()) {
      throw new Error('criterion 4: Ribbon showed Sample')
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor()
    const stored = await page.evaluate(() => localStorage.getItem('mc-show-sample-bots'))
    if (stored !== '1') throw new Error(`criterion 4: storage was ${stored}`)
    await agent(page, 'speedy').locator('[data-sample-tag="true"]').waitFor()
    await shot(page, artifactDir, 'agents_sample_tags.png')
    await shot(page, readmeDir, 'agents-samples-on.png')
    await visit(page, '#/office', 'Office')
    await agent(page, 'speedy').locator('[data-sample-tag="true"]').waitFor()
    await shot(page, artifactDir, 'office_sample_tags.png')
    await shot(page, readmeDir, 'office-samples-on.png')
    await visit(page, '#/team', 'Team')
    await agent(page, 'speedy').locator('[data-sample-tag="true"]').waitFor()
    await shot(page, artifactDir, 'team_sample_tags.png')
    await shot(page, readmeDir, 'team-samples-on.png')
    await visit(page, '#/system', 'System')
    if (!(await page.getByRole('switch', { name: 'Show sample bots' }).isChecked())) {
      throw new Error('criterion 4: the switch was off after reload')
    }
    await page.getByRole('switch', { name: 'Show sample bots' }).uncheck()

    await visit(page, '#/agents', 'Agents')
    await page.waitForFunction(() => document.querySelectorAll('[data-sample-tag="true"]').length === 0)
    const snap = await apiSend('POST', '/events', {
      type: 'agents.snapshot',
      payload: { agents: [{ id: 'snap_only', name: 'Snap Only', status: 'idle', role: 'assistant' }] },
    })
    if (snap.status !== 202) throw new Error(`criterion 7: snapshot returned ${snap.status} ${snap.text}`)
    await agent(page, 'ribbon').waitFor({ timeout: 2000 })
    await agent(page, 'forge').waitFor({ timeout: 2000 })
    await agent(page, 'snap_only').waitFor({ timeout: 2000 })
    const cleared = await apiSend('POST', '/events', { type: 'agents.snapshot', payload: { agents: [] } })
    if (cleared.status !== 202) throw new Error(`criterion 7: empty snapshot returned ${cleared.status}`)
    await page.waitForFunction(() => !document.querySelector('[data-agent-id="snap_only"]'), null, { timeout: 2000 })
    await agent(page, 'ribbon').waitFor()
    await agent(page, 'forge').waitFor()

    await showOffline(browser)

    for (const id of ['ribbon', 'forge']) {
      const removed = await apiSend('DELETE', `/agents/${id}`)
      if (removed.status !== 204) throw new Error(`criterion 6: DELETE ${id} returned ${removed.status} ${removed.text}`)
    }
    await visit(page, '#/agents', 'Agents')
    await agent(page, 'speedy').locator('[data-sample-tag="true"]').waitFor({ timeout: 15000 })
    if (await page.locator('[data-agent-id="ribbon"]').count()) throw new Error('criterion 6: Ribbon was still listed')
    const restored = await page.locator('[data-sample-tag="true"]').count()
    if (restored < 10) throw new Error(`criterion 6: expected the unclaimed defaults back, saw ${restored} Sample tags`)
    await visit(page, '#/office', 'Office')
    await page.locator('[data-sample-tag="true"]').first().waitFor({ timeout: 15000 })
    await visit(page, '#/team', 'Team')
    await page.locator('[data-sample-tag="true"]').first().waitFor({ timeout: 15000 })

    console.log('Roster UI criteria 1 to 7 passed.')
  } finally {
    await browser.close()
    await resetRoster().catch((err) => {
      console.error(err instanceof Error ? err.message : err)
    })
  }
}

async function showOffline(browser) {
  const listed = await apiSend('GET', '/agents')
  const ribbon = listed.json?.agents?.find((agent) => agent.id === 'ribbon')
  if (!ribbon?.lastSeenAt) throw new Error('criterion 5: Ribbon has no lastSeenAt')
  const seen = Date.parse(ribbon.lastSeenAt)
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('mc-show-sample-bots')
    } catch {
      // Default off.
    }
  })
  try {
    await page.clock.install({ time: seen })
    await page.goto(`${web}/#/agents`, { waitUntil: 'domcontentloaded' })
    await pumpUntil(page, async () => (await agent(page, 'ribbon').count()) > 0)
    if (await agent(page, 'ribbon').getAttribute('data-offline') === 'true') {
      throw new Error('criterion 5: Ribbon was Offline before the clock moved')
    }
    await page.clock.fastForward(10 * 60 * 1000)
    const offDeadline = Date.now() + 5000
    let offline = false
    while (Date.now() < offDeadline) {
      await sleep(100)
      if (await agent(page, 'ribbon').getAttribute('data-offline') === 'true') {
        offline = true
        break
      }
    }
    if (!offline) throw new Error('criterion 5: Ribbon did not show Offline after 10 minutes')
    await page.getByText('Offline', { exact: true }).first().waitFor()
    await assertDimmed(page, 'criterion 5: Agents robot')
    await shot(page, artifactDir, 'agents_offline.png')
    await shot(page, readmeDir, 'agents-offline.png')
    await page.goto(`${web}/#/office`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Office' }).waitFor()
    await pumpUntil(page, async () => (await agent(page, 'ribbon').count()) > 0)
    if (await agent(page, 'ribbon').getAttribute('data-offline') !== 'true') {
      throw new Error('criterion 5: Office did not mark Ribbon Offline')
    }
    await assertDimmed(page, 'criterion 5: Office robot')
    await shot(page, artifactDir, 'office_offline.png')
    await shot(page, readmeDir, 'office-offline.png')
    await page.goto(`${web}/#/team`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Team' }).waitFor()
    await pumpUntil(page, async () => (await agent(page, 'ribbon').count()) > 0)
    await shot(page, artifactDir, 'team_offline.png')
    await shot(page, readmeDir, 'team-offline.png')
  } finally {
    await page.close()
  }
}

async function captureGallery(page) {
  const pages = [
    ['#/tasks', 'heading', 'Tasks', 'tasks.png'],
    ['#/tasks?view=backlog', 'heading', 'Tasks', 'tasks-backlog.png'],
    ['#/approvals', 'heading', 'Approvals', 'approvals.png'],
    ['#/projects', 'heading', 'Projects', 'projects.png'],
    ['#/pipeline', 'heading', 'Pipeline', 'pipeline.png'],
    ['#/calendar', 'heading', 'Calendar', 'calendar.png'],
    ['#/memory', 'heading', 'Memory', 'memory.png'],
    ['#/docs', 'heading', 'Docs', 'docs.png'],
    ['#/system', 'heading', 'System', 'system.png'],
    ['#/system/logs', 'text', 'Gateway Logs', 'system-logs.png'],
    ['#/system/sessions', 'text', 'Sessions', 'system-sessions.png'],
    ['#/system/settings', 'text', 'Log out', 'system-settings.png'],
    ['#/system/connection', 'heading', 'Connection', 'system-connection.png'],
    ['#/system/tools', 'heading', 'Custom tools', 'system-tools.png'],
    ['#/connect', 'text', 'STEP 1 OF 8', 'connect.png'],
  ]
  for (const [hash, kind, label, name] of pages) {
    await page.goto(`${web}/${hash}`, { waitUntil: 'domcontentloaded' })
    const target = kind === 'heading'
      ? page.getByRole('heading', { level: 1, name: label })
      : label.startsWith('STEP')
        ? page.getByText(/STEP 1 OF 8/).first()
        : page.getByText(label, { exact: true }).first()
    await target.waitFor({ timeout: 30000 })
    await sleep(700)
    await shot(page, readmeDir, name)
  }
  const projects = await apiSend('GET', '/projects')
  const id = projects.json?.projects?.[0]?.id
  if (!id) throw new Error('README capture needs a seeded project')
  await page.goto(`${web}/#/projects/${id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 })
  await sleep(700)
  await shot(page, readmeDir, 'project-detail.png')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
