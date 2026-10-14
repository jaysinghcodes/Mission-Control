/**
 * Live Office. A ticket moves through build, qa, review, and done.
 * The bot changes rooms and the counts change with no reload.
 * A heartbeat currentTask updates the subtitle. An idle bot returns
 * to Commons. Activity names the agent.
 *
 * The API and the web app must already be running.
 */

import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { io } from 'socket.io-client'

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const token = process.env.INGEST_TOKEN || ''
const artifactDir = process.env.MC_ARTIFACT_DIR || '/opt/cursor/artifacts/office-live'
const agentId = 'live_quill'
const agentName = 'Live Quill'
const title = 'Live office notes'

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
  throw new Error('the API did not keep a live socket')
}

function shot(page, name) {
  mkdirSync(artifactDir, { recursive: true })
  return page.screenshot({ path: path.join(artifactDir, name) })
}

function bot(page) {
  return page.locator(`[data-agent-id="${agentId}"]`).first()
}

async function navCount(page) {
  return page.evaluate(() => performance.getEntriesByType('navigation').length)
}

async function waitLive(page, room, subtitle) {
  const deadline = Date.now() + 10000
  let last = ''
  while (Date.now() < deadline) {
    const el = bot(page)
    if (await el.count()) {
      const gotRoom = await el.getAttribute('data-live-room')
      const gotSub = await el.getAttribute('data-live-subtitle')
      last = `${gotRoom} | ${gotSub}`
      if (gotRoom === room && gotSub === subtitle) return
    }
    await sleep(100)
  }
  throw new Error(`expected ${room} / ${subtitle}, last saw ${last}`)
}

async function cardText(page) {
  return bot(page).locator('xpath=ancestor::*[contains(@class,"mc-card")][1]').innerText()
}

async function pipelineCount(page, stage) {
  const raw = await page.locator(`[data-pipeline-stage="${stage}"]`).getAttribute('data-pipeline-count')
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`pipeline ${stage} count was ${raw}`)
  return n
}

async function stablePipelines(page) {
  const stages = ['build', 'qa', 'ship', 'deploy']
  let last = ''
  let same = 0
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const counts = []
    for (const stage of stages) counts.push(await pipelineCount(page, stage))
    const key = counts.join(',')
    if (key === last) {
      same += 1
      if (same >= 3) return counts
    } else {
      last = key
      same = 0
    }
    await sleep(200)
  }
  throw new Error(`pipeline counts did not settle (${last})`)
}

async function move(id, status) {
  const res = await apiSend('PATCH', `/tickets/${id}`, { status })
  if (res.status !== 200) throw new Error(`PATCH ${status} returned ${res.status} ${res.text}`)
}

async function main() {
  await waitForLiveFeed()
  const removed = await apiSend('DELETE', `/agents/${agentId}`)
  if (removed.status !== 204 && removed.status !== 404) {
    throw new Error(`cleanup DELETE returned ${removed.status} ${removed.text}`)
  }
  const createdAgent = await apiSend('POST', '/agents/register', {
    id: agentId,
    name: agentName,
    role: 'writer',
  })
  if (createdAgent.status !== 201 && createdAgent.status !== 200) {
    throw new Error(`register returned ${createdAgent.status} ${createdAgent.text}`)
  }

  const browser = await chromium.launch(launchOptions())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(`${web}/#/office`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      try {
        localStorage.setItem('mc-show-sample-bots', '0')
      } catch {
        // The switch defaults to off.
      }
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Office' }).waitFor({ timeout: 30000 })
    await page.getByText(/^Connected/).first().waitFor({ timeout: 20000 })
    await waitLive(page, 'commons', 'Idle')

    const created = await apiSend('POST', '/tickets', {
      title,
      assignee: agentName,
      status: 'todo',
    })
    if (created.status !== 201) throw new Error(`create ticket returned ${created.status} ${created.text}`)
    const ticket = created.json?.ticket
    if (!ticket?.id) throw new Error('create ticket did not return an id')

    const [buildBefore, qaBefore, shipBefore, deployBefore] = await stablePipelines(page)

    await move(ticket.id, 'build')
    await waitLive(page, 'build', title)
    const inBuild = await cardText(page)
    if (!inBuild.includes('Build') || !inBuild.includes(title) || !inBuild.includes('1 in progress')) {
      throw new Error(`build room did not show the live subtitle (${inBuild.slice(0, 180)})`)
    }
    if ((await pipelineCount(page, 'build')) !== buildBefore + 1) {
      throw new Error('build pipeline count did not increase')
    }
    await page.locator('[data-activity-agent="Live Quill"]').first().waitFor({ timeout: 10000 })
    await shot(page, 'office-before-build.png')

    const loads = await navCount(page)
    await move(ticket.id, 'qa')
    await waitLive(page, 'qa', title)
    if ((await navCount(page)) !== loads) throw new Error('the office page reloaded while the ticket moved')
    const inQa = await cardText(page)
    if (!inQa.includes('QA') || !inQa.includes(title) || !inQa.includes('1 testing')) {
      throw new Error(`qa room did not show the live subtitle (${inQa.slice(0, 180)})`)
    }
    if ((await pipelineCount(page, 'build')) !== buildBefore) throw new Error('build pipeline count did not fall')
    if ((await pipelineCount(page, 'qa')) !== qaBefore + 1) throw new Error('qa pipeline count did not increase')
    const buildEmpty = await page.locator('.mc-card').filter({ hasText: 'Build' }).first().innerText()
    if (!buildEmpty.includes('Idle') && !buildEmpty.includes('Empty')) {
      throw new Error(`build room was not empty after the move (${buildEmpty.slice(0, 120)})`)
    }
    const activity = await page.locator('[data-activity-rail="true"]').innerText()
    if (/\bsystem\b/i.test(activity)) throw new Error(`activity still named system\n${activity.slice(0, 500)}`)
    if (!activity.includes(agentName)) throw new Error('activity did not name Live Quill')
    await shot(page, 'office-after-qa.png')
    await shot(page, 'office-activity.png')

    await page.goto(`${web}/#/agents`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor()
    await waitLive(page, 'qa', title)
    await shot(page, 'agents-same-state.png')

    await page.goto(`${web}/#/team`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Team' }).waitFor()
    await waitLive(page, 'qa', title)
    const teamText = await bot(page).innerText()
    if (!teamText.includes(title)) throw new Error(`team did not show the live subtitle (${teamText})`)
    await shot(page, 'team-same-state.png')

    await page.goto(`${web}/#/office`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Office' }).waitFor()
    await waitLive(page, 'qa', title)
    const stay = await navCount(page)

    await move(ticket.id, 'review')
    await waitLive(page, 'ship', title)
    const inShip = await cardText(page)
    if (!inShip.includes('Ship') || !inShip.includes('1 ready')) {
      throw new Error(`ship room did not update (${inShip.slice(0, 160)})`)
    }
    if ((await pipelineCount(page, 'ship')) !== shipBefore + 1) throw new Error('ship pipeline count did not increase')

    await move(ticket.id, 'done')
    await waitLive(page, 'deploy', title)
    const inDeploy = await cardText(page)
    if (!inDeploy.includes('Deploy') || !inDeploy.includes('1 deploying')) {
      throw new Error(`deploy room did not update (${inDeploy.slice(0, 160)})`)
    }
    if ((await pipelineCount(page, 'deploy')) !== deployBefore + 1) throw new Error('deploy pipeline count did not increase')
    if ((await navCount(page)) !== stay) throw new Error('the office page reloaded during later stage moves')

    await move(ticket.id, 'todo')
    await waitLive(page, 'commons', 'Idle')
    const inCommons = await cardText(page)
    if (!inCommons.includes('Commons')) throw new Error(`idle bot did not return to Commons (${inCommons.slice(0, 160)})`)
    if ((await navCount(page)) !== stay) throw new Error('the office page reloaded when the bot returned to Commons')

    const beat = await apiSend('POST', `/agents/${agentId}/heartbeat`, {
      currentTask: 'Writing the live notes',
      status: 'working',
    })
    if (beat.status !== 204) throw new Error(`heartbeat returned ${beat.status} ${beat.text}`)
    await waitLive(page, 'commons', 'Writing the live notes')
    if ((await navCount(page)) !== stay) throw new Error('the office page reloaded when the heartbeat arrived')

    console.log('Live Office passed.')
  } finally {
    await browser.close()
    await apiSend('DELETE', `/agents/${agentId}`).catch(() => {})
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
