/**
 * Live Office. A ticket moves through build, qa, and review.
 * Done returns the bot to Commons. Pipeline still counts that ticket
 * in Deploy. An active run on the done ticket seats Deploy until the
 * run finishes. A heartbeat can set a task. Idle, null, or blank clears
 * it and sets status idle, including when the bot was working. Register
 * and delete show on the Office rail without waiting for the poll.
 * Teardown removes the agents and the ticket.
 *
 * The API and the web app must already be running.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { io } from 'socket.io-client'

const require = createRequire(new URL('../apps/api/package.json', import.meta.url))

const web = (process.env.MC_WEB_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const api = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const token = process.env.INGEST_TOKEN || ''
const artifactDir = process.env.MC_ARTIFACT_DIR || '/opt/cursor/artifacts/office-live'
const agentId = 'live_quill'
const agentName = 'Live Quill'
const railId = 'rail_quill'
const railName = 'Rail Quill'
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

async function waitLive(page, room, subtitle, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const el = bot(page)
    if (await el.count()) {
      const gotRoom = await el.getAttribute('data-live-room')
      const gotSub = await el.getAttribute('data-live-subtitle')
      last = `${gotRoom} | ${gotSub}`
      if (gotRoom === room && gotSub === subtitle) return
    }
    await sleep(50)
  }
  throw new Error(`expected ${room} / ${subtitle}, last saw ${last}`)
}

async function expectAll(pages, room, subtitle, timeoutMs = 2000) {
  await Promise.all(pages.map((page) => waitLive(page, room, subtitle, timeoutMs)))
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

async function taskOf(id) {
  const res = await apiSend('GET', `/agents/${id}`)
  return { status: res.status, task: res.json?.agent?.currentTask, agentStatus: res.json?.agent?.status }
}

async function doneTickets() {
  const res = await apiSend('GET', '/tickets')
  if (res.status !== 200) throw new Error(`GET /tickets returned ${res.status}`)
  return (res.json?.tickets ?? []).filter((row) => row.status === 'done').length
}

async function waitRail(page, text, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    last = await page.locator('[data-activity-rail="true"]').innerText()
    if (last.includes(text)) return
    await sleep(50)
  }
  throw new Error(`rail did not show "${text}" within ${timeoutMs}ms\n${last.slice(0, 400)}`)
}

async function cleanup(state) {
  for (const id of state.agentIds) {
    const removed = await apiSend('DELETE', `/agents/${id}`).catch(() => ({ status: 0, text: '' }))
    if (removed.status !== 204 && removed.status !== 404) {
      throw new Error(`cleanup DELETE ${id} returned ${removed.status} ${removed.text}`)
    }
  }
  const url = process.env.DATABASE_URL
  if (state.ticketId && !url) {
    throw new Error('live office teardown needs DATABASE_URL to remove the ticket')
  }
  if (url && (state.ticketId || state.runId)) {
    const { Client } = require('pg')
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      if (state.runId) await client.query(`DELETE FROM "Run" WHERE id = $1`, [state.runId])
      if (state.ticketId) await client.query(`DELETE FROM "Run" WHERE "ticketId" = $1`, [state.ticketId])
      await client.query(
        `DELETE FROM "ActivityEvent"
         WHERE ($1 <> '' AND payload->>'ticket' = $1)
            OR payload->>'id' = ANY($2::text[])
            OR payload->>'agent' = ANY($3::text[])`,
        [state.ticketKey || '', state.agentIds, state.agentNames],
      )
      if (state.ticketId) await client.query(`DELETE FROM "Ticket" WHERE id = $1`, [state.ticketId])
    } finally {
      await client.end()
    }
  }
  for (const id of state.agentIds) {
    const left = await apiSend('GET', `/agents/${id}`)
    if (left.status !== 404) throw new Error(`teardown left agent ${id} (${left.status})`)
  }
  if (state.ticketId) {
    const tickets = await apiSend('GET', '/tickets')
    const still = (tickets.json?.tickets ?? []).some((row) => row.id === state.ticketId)
    if (still) throw new Error('teardown left the live ticket')
  }
}

async function openPage(browser, hash, heading) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${web}/#/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    try {
      localStorage.setItem('mc-show-sample-bots', '0')
    } catch {
      // The switch defaults to off.
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: heading }).waitFor({ timeout: 30000 })
  await page.getByText(/^Connected/).first().waitFor({ timeout: 20000 })
  return page
}

async function loadsOf(pages) {
  return Promise.all(pages.map((page) => navCount(page)))
}

function sameLoads(before, after) {
  return before.every((count, index) => count === after[index])
}

async function main() {
  await waitForLiveFeed()
  const state = {
    ticketId: '',
    ticketKey: '',
    runId: '',
    agentIds: [agentId, railId],
    agentNames: [agentName, railName],
  }
  let browser
  try {
    for (const id of state.agentIds) {
      const removed = await apiSend('DELETE', `/agents/${id}`)
      if (removed.status !== 204 && removed.status !== 404) {
        throw new Error(`cleanup DELETE ${id} returned ${removed.status} ${removed.text}`)
      }
    }
    const createdAgent = await apiSend('POST', '/agents/register', {
      id: agentId,
      name: agentName,
      role: 'writer',
    })
    if (createdAgent.status !== 201 && createdAgent.status !== 200) {
      throw new Error(`register returned ${createdAgent.status} ${createdAgent.text}`)
    }

    browser = await chromium.launch(launchOptions())
    const office = await openPage(browser, 'office', 'Office')
    const agents = await openPage(browser, 'agents', 'Agents')
    const team = await openPage(browser, 'team', 'Team')
    const pages = [office, agents, team]
    await expectAll(pages, 'commons', 'Idle', 15000)

    const created = await apiSend('POST', '/tickets', {
      title,
      assignee: agentName,
      status: 'todo',
    })
    if (created.status !== 201) throw new Error(`create ticket returned ${created.status} ${created.text}`)
    const ticket = created.json?.ticket
    if (!ticket?.id) throw new Error('create ticket did not return an id')
    state.ticketId = ticket.id
    state.ticketKey = ticket.key || ''

    const [buildBefore, qaBefore, shipBefore, deployBefore] = await stablePipelines(office)

    await move(ticket.id, 'build')
    await expectAll(pages, 'build', title, 10000)
    const inBuild = await cardText(office)
    if (!inBuild.includes('Build') || !inBuild.includes(title) || !inBuild.includes('1 in progress')) {
      throw new Error(`build room did not show the live subtitle (${inBuild.slice(0, 180)})`)
    }
    if ((await pipelineCount(office, 'build')) !== buildBefore + 1) {
      throw new Error('build pipeline count did not increase')
    }
    await office.locator('[data-activity-agent="Live Quill"]').first().waitFor({ timeout: 10000 })

    const stay = await loadsOf(pages)
    await move(ticket.id, 'qa')
    await expectAll(pages, 'qa', title, 10000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded while the ticket moved')
    const inQa = await cardText(office)
    if (!inQa.includes('QA') || !inQa.includes(title) || !inQa.includes('1 testing')) {
      throw new Error(`qa room did not show the live subtitle (${inQa.slice(0, 180)})`)
    }
    if ((await pipelineCount(office, 'build')) !== buildBefore) throw new Error('build pipeline count did not fall')
    if ((await pipelineCount(office, 'qa')) !== qaBefore + 1) throw new Error('qa pipeline count did not increase')
    const buildEmpty = await office.locator('.mc-card').filter({ hasText: 'Build' }).first().innerText()
    if (!buildEmpty.includes('Idle') && !buildEmpty.includes('Empty')) {
      throw new Error(`build room was not empty after the move (${buildEmpty.slice(0, 120)})`)
    }
    const activity = await office.locator('[data-activity-rail="true"]').innerText()
    if (/\bsystem\b/i.test(activity)) throw new Error(`activity still named system\n${activity.slice(0, 500)}`)
    if (!activity.includes(agentName)) throw new Error('activity did not name Live Quill')
    if (/\b(?:agents|agent|run|ticket)\.[a-z]/.test(activity)) {
      throw new Error(`activity showed an event type\n${activity.slice(0, 500)}`)
    }
    const teamText = await bot(team).innerText()
    if (!teamText.includes(title)) throw new Error(`team did not show the live subtitle (${teamText})`)

    await move(ticket.id, 'review')
    await expectAll(pages, 'ship', title, 10000)
    const inShip = await cardText(office)
    if (!inShip.includes('Ship') || !inShip.includes('1 ready')) {
      throw new Error(`ship room did not update (${inShip.slice(0, 160)})`)
    }
    if ((await pipelineCount(office, 'ship')) !== shipBefore + 1) throw new Error('ship pipeline count did not increase')

    await move(ticket.id, 'done')
    await expectAll(pages, 'commons', 'Idle', 2000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded when the ticket moved to Done')
    const inCommons = await cardText(office)
    if (!inCommons.includes('Commons')) throw new Error(`done ticket did not return the bot to Commons (${inCommons.slice(0, 160)})`)
    const deployCard = await office.locator('.mc-card').filter({ hasText: 'Deploy' }).first().innerText()
    if (deployCard.includes(agentName)) throw new Error('a done ticket seated the bot in Deploy')
    const uiDeploy = await pipelineCount(office, 'deploy')
    if (uiDeploy !== deployBefore + 1) throw new Error('deploy pipeline count did not increase')
    if (uiDeploy !== (await doneTickets())) throw new Error('deploy pipeline count did not match done tickets')
    await bot(office).scrollIntoViewIfNeeded()
    await shot(office, 'office-done-commons.png')

    const started = await apiSend('POST', '/runs', {
      name: 'Ship the live notes',
      agent: agentName,
      status: 'running',
      ticketId: ticket.id,
    })
    if (started.status !== 201) throw new Error(`create run returned ${started.status} ${started.text}`)
    state.runId = started.json?.run?.id || ''
    if (!state.runId) throw new Error('create run did not return an id')
    await expectAll(pages, 'deploy', title, 2000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded when the run started')
    const inDeploy = await cardText(office)
    if (!inDeploy.includes('Deploy') || !inDeploy.includes('1 deploying') || !inDeploy.includes(title)) {
      throw new Error(`active run did not seat Deploy (${inDeploy.slice(0, 180)})`)
    }
    await bot(office).scrollIntoViewIfNeeded()
    await shot(office, 'office-done-run-deploy.png')

    const finished = await apiSend('PATCH', `/runs/${state.runId}`, { status: 'done' })
    if (finished.status !== 200) throw new Error(`finish run returned ${finished.status} ${finished.text}`)
    await expectAll(pages, 'commons', 'Idle', 2000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded when the run finished')
    await bot(office).scrollIntoViewIfNeeded()
    await shot(office, 'office-run-finished-commons.png')

    const beat = await apiSend('POST', `/agents/${agentId}/heartbeat`, {
      currentTask: 'Writing the live notes',
      status: 'working',
    })
    if (beat.status !== 204) throw new Error(`heartbeat returned ${beat.status} ${beat.text}`)
    await expectAll(pages, 'commons', 'Writing the live notes', 2000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded when the heartbeat arrived')

    const idle = await apiSend('POST', `/agents/${agentId}/heartbeat`, { status: 'idle' })
    if (idle.status !== 204) throw new Error(`idle heartbeat returned ${idle.status} ${idle.text}`)
    const cleared = await taskOf(agentId)
    if (cleared.task !== null || cleared.agentStatus !== 'idle') {
      throw new Error(`idle heartbeat did not clear the task (${JSON.stringify(cleared)})`)
    }
    await expectAll(pages, 'commons', 'Idle', 2000)
    await bot(agents).scrollIntoViewIfNeeded()
    await shot(agents, 'agents-cleared-task.png')

    const again = await apiSend('POST', `/agents/${agentId}/heartbeat`, {
      currentTask: 'Notes again',
      status: 'working',
    })
    if (again.status !== 204) throw new Error(`task heartbeat returned ${again.status} ${again.text}`)
    await expectAll(pages, 'commons', 'Notes again', 2000)
    const asNull = await apiSend('POST', `/agents/${agentId}/heartbeat`, { currentTask: null })
    if (asNull.status !== 204) throw new Error(`null currentTask returned ${asNull.status} ${asNull.text}`)
    const afterNull = await taskOf(agentId)
    if (afterNull.task !== null || afterNull.agentStatus !== 'idle') {
      throw new Error(`null currentTask left the bot working (${JSON.stringify(afterNull)})`)
    }
    await expectAll(pages, 'commons', 'Idle', 2000)

    const restore = await apiSend('POST', `/agents/${agentId}/heartbeat`, {
      currentTask: 'Notes again',
      status: 'working',
    })
    if (restore.status !== 204) throw new Error(`restore heartbeat returned ${restore.status} ${restore.text}`)
    await expectAll(pages, 'commons', 'Notes again', 2000)
    const blank = await apiSend('POST', `/agents/${agentId}/heartbeat`, { currentTask: '' })
    if (blank.status !== 204) throw new Error(`blank currentTask returned ${blank.status} ${blank.text}`)
    const afterBlank = await taskOf(agentId)
    if (afterBlank.task !== null || afterBlank.agentStatus !== 'idle') {
      throw new Error(`blank currentTask left the bot working (${JSON.stringify(afterBlank)})`)
    }
    await expectAll(pages, 'commons', 'Idle', 2000)

    const rail = await apiSend('POST', '/agents/register', {
      id: railId,
      name: railName,
      role: 'writer',
    })
    if (rail.status !== 201 && rail.status !== 200) {
      throw new Error(`rail register returned ${rail.status} ${rail.text}`)
    }
    await waitRail(office, `${railName} registered`, 2000)
    const gone = await apiSend('DELETE', `/agents/${railId}`)
    if (gone.status !== 204) throw new Error(`rail delete returned ${gone.status} ${gone.text}`)
    await waitRail(office, `${railName} went offline`, 2000)
    if (!sameLoads(stay, await loadsOf(pages))) throw new Error('a page reloaded during register or delete')

    console.log('Live Office passed.')
  } finally {
    if (browser) await browser.close()
    await cleanup(state)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
