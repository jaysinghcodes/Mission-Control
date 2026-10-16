/**
 * Post fixture OpenClaw output through bridge/mc-bridge-sync.py, then read
 * devices, nodes, approvals, and gateway status back from the API.
 *
 * The fixture is bridge/examples/fresh-install. --from-dir does not call the
 * openclaw command. INGEST_TOKEN and MC_API_URL come from the environment.
 * A loopback API answers dashboard reads without a cookie. Compose answers
 * 401 until MC_DASHBOARD_PASSWORD signs in. MC_EXPECT_GATEWAY_SOURCE is
 * probe on a native install and bridge under Compose.
 */

import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(ROOT, 'bridge', 'examples', 'fresh-install')
const BRIDGE = path.join(ROOT, 'bridge', 'mc-bridge-sync.py')

function apiBase() {
  const raw = (process.env.MC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
  return raw
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function parseEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    events.push(JSON.parse(line))
  }
  return events
}

function tcpOpen(host, port, ms = 800) {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.connect({ host, port })
    const done = (open) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(open)
    }
    const timer = setTimeout(() => done(false), ms)
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}

async function request(url, { method = 'GET', token, cookie, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers['x-ingest-token'] = token
  if (cookie) headers.cookie = cookie
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text, headers: res.headers }
}

function sessionCookie(headers) {
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  const raw = lines.find((line) => line.startsWith('mc_session=')) || headers.get('set-cookie') || ''
  const match = /mc_session=([^;]+)/.exec(raw)
  if (!match) return ''
  return `mc_session=${match[1]}`
}

async function login(base, password) {
  const res = await request(`${base}/auth/login`, {
    method: 'POST',
    body: { password },
  })
  if (res.status !== 204) {
    throw new Error(`Dashboard login returned ${res.status}.`)
  }
  const cookie = sessionCookie(res.headers)
  if (!cookie) throw new Error('Dashboard login did not set a session cookie.')
  return cookie
}

function sameInstant(left, right) {
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  const a = new Date(left).getTime()
  const b = new Date(right).getTime()
  return Number.isFinite(a) && a === b
}

function expectMachine(got, expected) {
  if (!got) throw new Error(`GET /devices is missing ${expected.id}.`)
  for (const key of ['name', 'type', 'online']) {
    if (got[key] !== expected[key]) {
      throw new Error(
        `GET /devices ${expected.id} ${key} is ${JSON.stringify(got[key])}. The fixture mapped ${JSON.stringify(expected[key])}.`,
      )
    }
  }
  for (const key of ['lastSeenAt', 'pairedAt', 'requestedAt']) {
    if (!sameInstant(got[key] ?? null, expected[key] ?? null)) {
      throw new Error(
        `GET /devices ${expected.id} ${key} is ${JSON.stringify(got[key] ?? null)}. The fixture mapped ${JSON.stringify(expected[key] ?? null)}.`,
      )
    }
  }
}

function mergedMachines(payload) {
  const byId = new Map()
  for (const row of payload.devices || []) byId.set(row.id, row)
  for (const row of payload.nodes || []) byId.set(row.id, row)
  return [...byId.values()]
}

async function assertGateway(base, cookie, posted) {
  const expectSource = process.env.MC_EXPECT_GATEWAY_SOURCE || ''
  if (expectSource !== 'probe' && expectSource !== 'bridge') {
    throw new Error('Set MC_EXPECT_GATEWAY_SOURCE to probe or bridge.')
  }
  if (!posted || typeof posted.up !== 'boolean' || typeof posted.port !== 'number') {
    throw new Error('Activity has no gateway.snapshot from this bridge run.')
  }
  let last = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await tcpOpen(posted.host || '127.0.0.1', posted.port)
    const res = await request(`${base}/system`, { cookie })
    if (res.status !== 200 || !res.json?.gateway) {
      throw new Error(`GET /system returned ${res.status}.`)
    }
    const gateway = res.json.gateway
    last = { open, gateway }
    const sourceOk = gateway.source === expectSource
    const portOk = gateway.port === posted.port
    const hostOk = gateway.host === posted.host
    const stateOk = gateway.state === 'up' || gateway.state === 'down'
    const flagOk = gateway.up === (gateway.state === 'up')
    const reportOk =
      expectSource === 'bridge'
        ? gateway.up === posted.up && gateway.state === (posted.up ? 'up' : 'down')
        : gateway.up === open
    if (sourceOk && portOk && hostOk && stateOk && flagOk && reportOk) {
      if (typeof gateway.checkedAt !== 'number') {
        throw new Error('GET /system gateway.checkedAt is not a number.')
      }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(
    `GET /system gateway did not match the bridge report. source ${last.gateway.source}, state ${last.gateway.state}, up ${last.gateway.up}, port ${last.gateway.port}.`,
  )
}

export async function proveBridgeFixture({
  base = apiBase(),
  token = process.env.INGEST_TOKEN || '',
  password = process.env.MC_DASHBOARD_PASSWORD || '',
  fixture = FIXTURE,
} = {}) {
  if (!token) throw new Error('INGEST_TOKEN is not set, so the bridge would refuse to post.')
  const env = { ...process.env, INGEST_TOKEN: token, MC_API_URL: base, MC_BRIDGE_REGISTER: '0' }
  const dry = await run('python3', [BRIDGE, '--dry-run', '--from-dir', fixture], env)
  if (dry.code !== 0) {
    throw new Error(`Fixture dry run failed.\n${dry.stderr}`)
  }
  if (token && (dry.stdout.includes(token) || dry.stderr.includes(token))) {
    throw new Error('The bridge printed the ingest token.')
  }
  const preview = parseEvents(dry.stdout)
  const machines = preview.find((event) => event.type === 'devices.snapshot')?.payload
  const approvals = preview.find((event) => event.type === 'approvals.snapshot')?.payload?.approvals
  if (!Array.isArray(machines?.devices) || machines.devices.length === 0) {
    throw new Error('The fixture dry run did not map any devices.')
  }
  if (!Array.isArray(machines?.nodes) || machines.nodes.length === 0) {
    throw new Error('The fixture dry run did not map any nodes.')
  }
  if (!Array.isArray(approvals) || approvals.length === 0) {
    throw new Error('The fixture dry run did not map any approvals.')
  }

  const posted = await run('python3', [BRIDGE, '--from-dir', fixture], env)
  if (posted.code !== 0) {
    throw new Error(`Fixture sync failed.\n${posted.stderr}`)
  }
  if (token && (posted.stdout.includes(token) || posted.stderr.includes(token))) {
    throw new Error('The bridge printed the ingest token.')
  }

  let cookie = ''
  const first = await request(`${base}/devices`)
  if (first.status === 401) {
    if (!password) throw new Error('GET /devices returned 401 and no dashboard password was provided.')
    cookie = await login(base, password)
  } else if (first.status !== 200) {
    throw new Error(`GET /devices returned ${first.status} before login.`)
  }

  const devicesRes = cookie ? await request(`${base}/devices`, { cookie }) : first
  if (devicesRes.status !== 200 || !Array.isArray(devicesRes.json?.devices)) {
    throw new Error(`GET /devices returned ${devicesRes.status}.`)
  }
  const rows = devicesRes.json.devices
  const expected = mergedMachines(machines)
  const gotIds = rows.map((row) => row.id).sort()
  const wantIds = expected.map((row) => row.id).sort()
  if (gotIds.join('\n') !== wantIds.join('\n')) {
    throw new Error(`GET /devices ids are ${gotIds.join(', ')}. The fixture mapped ${wantIds.join(', ')}.`)
  }
  for (const row of expected) expectMachine(rows.find((item) => item.id === row.id), row)
  if (!machines.devices.some((row) => rows.some((item) => item.id === row.id))) {
    throw new Error('GET /devices has no row from the devices fixture.')
  }
  if (!machines.nodes.some((row) => rows.some((item) => item.id === row.id))) {
    throw new Error('GET /devices has no row from the nodes fixture.')
  }

  const approvalsRes = await request(`${base}/approvals?status=pending`, { cookie })
  if (approvalsRes.status !== 200 || !Array.isArray(approvalsRes.json?.approvals)) {
    throw new Error(`GET /approvals returned ${approvalsRes.status}.`)
  }
  for (const item of approvals) {
    const found = approvalsRes.json.approvals.find((row) => row.tag === item.tag)
    if (!found || found.kind !== item.kind || found.desc !== item.desc || found.status !== 'pending') {
      throw new Error(`GET /approvals is missing pending ${item.kind} ${item.tag}.`)
    }
  }

  const activity = await request(`${base}/activity?limit=50`, { cookie })
  if (activity.status !== 200 || !Array.isArray(activity.json?.events)) {
    throw new Error(`GET /activity returned ${activity.status}.`)
  }
  const gatewayEvent = activity.json.events.find((event) => event.type === 'gateway.snapshot')
  const deviceEvent = activity.json.events.find((event) => event.type === 'devices.snapshot')
  const approvalEvent = activity.json.events.find((event) => event.type === 'approvals.snapshot')
  if (!deviceEvent?.payload?.devices || !deviceEvent.payload.nodes) {
    throw new Error('Activity has no devices.snapshot with devices and nodes.')
  }
  if (!approvalEvent?.payload?.approvals) {
    throw new Error('Activity has no approvals.snapshot.')
  }
  await assertGateway(base, cookie, gatewayEvent?.payload)
  console.log(
    `Bridge fixture posted ${expected.length} machines and ${approvals.length} approvals. Gateway source is ${process.env.MC_EXPECT_GATEWAY_SOURCE}.`,
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  proveBridgeFixture().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
