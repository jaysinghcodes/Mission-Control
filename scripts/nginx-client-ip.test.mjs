/**
 * The bundled nginx replaces the client address. A spoofed
 * X-Forwarded-For or X-Real-IP must not reach the API.
 * The static template is checked even when nginx itself is started.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = path.join(root, 'apps/web/nginx.conf.template')
const dockerfilePath = path.join(root, 'apps/web/Dockerfile')

const SPOOF = '203.0.113.9'
const SPOOF_REAL = '198.51.100.7'

function locationBlock(src, name) {
  const match = new RegExp(`location ${name} \\{([\\s\\S]*?)\\n    \\}`).exec(src)
  assert.ok(match, `missing location ${name}`)
  return match[1]
}

function serverBlocks(src) {
  return [...src.matchAll(/server \{([\s\S]*?)\n\}/g)].map((match) => match[1])
}

test('nginx config sets the client address from the peer and drops client copies', () => {
  const nginx = readFileSync(templatePath, 'utf8')
  const docker = readFileSync(dockerfilePath, 'utf8')
  assert.match(docker, /NGINX_ENVSUBST_FILTER=\^\$\$/)
  assert.match(docker, /EXPOSE 3011/)
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/)
  assert.doesNotMatch(nginx, /\$http_x_real_ip/)
  assert.doesNotMatch(nginx, /\$http_x_forwarded_proto/)
  const servers = serverBlocks(nginx)
  assert.equal(servers.length, 2)
  const local = servers.find((block) => block.includes('listen 5173;'))
  const remote = servers.find((block) => block.includes('listen 3011;'))
  assert.ok(local, 'missing local listener')
  assert.ok(remote, 'missing tunnel listener')
  assert.doesNotMatch(local, /\$http_x_forwarded_for/)
  assert.doesNotMatch(local, /\$http_cf_connecting_ip/)
  for (const block of [locationBlock(local, '/api/'), locationBlock(local, '/socket\\.io/')]) {
    assert.match(block, /proxy_set_header X-MC-Remote "";/)
    assert.match(block, /proxy_set_header CF-Connecting-IP "";/)
    assert.match(block, /proxy_set_header X-Real-IP \$remote_addr;/)
    assert.match(block, /proxy_set_header X-Forwarded-For \$remote_addr;/)
    assert.match(block, /proxy_set_header X-Forwarded-Proto \$scheme;/)
  }
  assert.match(remote, /\$http_cf_connecting_ip/)
  assert.match(remote, /\$http_x_forwarded_for/)
  for (const block of [locationBlock(remote, '/api/'), locationBlock(remote, '/socket\\.io/')]) {
    assert.match(block, /proxy_set_header X-MC-Remote 1;/)
    assert.match(block, /proxy_set_header CF-Connecting-IP \$http_cf_connecting_ip;/)
    assert.match(block, /proxy_set_header X-Forwarded-For \$http_x_forwarded_for;/)
    assert.match(block, /proxy_set_header X-Real-IP \$remote_addr;/)
    assert.match(block, /proxy_set_header X-Forwarded-Proto \$scheme;/)
    assert.doesNotMatch(block, /proxy_set_header X-Forwarded-For \$remote_addr;/)
  }
})

test('a spoofed client header through nginx is replaced with the peer address', async () => {
  const bin = nginxBin()
  assert.ok(bin, 'nginx is required for the forwarded client test')

  const seen = []
  const upstream = createServer((req, res) => {
    seen.push({
      url: req.url ?? '',
      forwardedFor: req.headers['x-forwarded-for'],
      realIp: req.headers['x-real-ip'],
      proto: req.headers['x-forwarded-proto'],
      remote: req.headers['x-mc-remote'],
      connecting: req.headers['cf-connecting-ip'],
    })
    res.writeHead(200)
    res.end('ok')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamAddr = upstream.address()
  assert.equal(typeof upstreamAddr, 'object')
  const upstreamPort = upstreamAddr.port

  const dir = mkdtempSync(path.join(tmpdir(), 'mc-nginx-'))
  for (const name of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi', 'html']) {
    mkdirSync(path.join(dir, name))
  }
  const nginxPort = await freePort()
  const remotePort = await freePort()
  const template = readFileSync(templatePath, 'utf8')
    .replace('listen 5173;', `listen 127.0.0.1:${nginxPort};`)
    .replace('listen 3011;', `listen 127.0.0.1:${remotePort};`)
    .replaceAll('root /usr/share/nginx/html;', `root ${path.join(dir, 'html')};`)
    .replaceAll('http://api:3000', `http://127.0.0.1:${upstreamPort}`)
  writeFileSync(path.join(dir, 'server.conf'), template)
  const conf = path.join(dir, 'nginx.conf')
  writeFileSync(
    conf,
    [
      'worker_processes 1;',
      `error_log ${path.join(dir, 'error.log')};`,
      `pid ${path.join(dir, 'nginx.pid')};`,
      'events { worker_connections 32; }',
      'http {',
      `  access_log ${path.join(dir, 'access.log')};`,
      `  client_body_temp_path ${path.join(dir, 'client_body')};`,
      `  proxy_temp_path ${path.join(dir, 'proxy')};`,
      `  fastcgi_temp_path ${path.join(dir, 'fastcgi')};`,
      `  uwsgi_temp_path ${path.join(dir, 'uwsgi')};`,
      `  scgi_temp_path ${path.join(dir, 'scgi')};`,
      `  include ${path.join(dir, 'server.conf')};`,
      '}',
      '',
    ].join('\n'),
  )

  const child = spawn(bin, ['-c', conf, '-g', 'daemon off;'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    logs += chunk
  })
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    logs += chunk
  })

  try {
    await waitForPort(nginxPort, child)
    const headers = {
      'x-forwarded-for': `${SPOOF}, 10.1.2.3`,
      'x-real-ip': SPOOF_REAL,
      'x-forwarded-proto': 'https',
      'x-mc-remote': '0',
      'cf-connecting-ip': '198.51.100.20',
    }
    const api = await get(`http://127.0.0.1:${nginxPort}/api/health`, headers)
    const socket = await get(`http://127.0.0.1:${nginxPort}/socket.io/?EIO=4`, headers)
    assert.equal(api, 200, logs)
    assert.equal(socket, 200, logs)
    assert.equal(seen.length, 2, logs)
    for (const hop of seen) {
      assert.equal(hop.forwardedFor, '127.0.0.1', `${hop.url} kept a spoofed chain`)
      assert.equal(hop.realIp, '127.0.0.1', `${hop.url} kept a spoofed X-Real-IP`)
      assert.equal(hop.proto, 'http')
      assert.equal(hop.remote, undefined, `${hop.url} kept a spoofed tunnel tag`)
      assert.equal(hop.connecting, undefined, `${hop.url} kept CF-Connecting-IP`)
      assert.equal(String(hop.forwardedFor).includes(SPOOF), false)
      assert.equal(String(hop.realIp).includes(SPOOF_REAL), false)
    }
    assert.equal(seen[0].url, '/health')
    assert.match(seen[1].url, /^\/socket\.io\//)

    seen.length = 0
    const tunnelApi = await get(`http://127.0.0.1:${remotePort}/api/health`, headers)
    const tunnelSocket = await get(`http://127.0.0.1:${remotePort}/socket.io/?EIO=4`, headers)
    assert.equal(tunnelApi, 200, logs)
    assert.equal(tunnelSocket, 200, logs)
    assert.equal(seen.length, 2, logs)
    for (const hop of seen) {
      assert.equal(hop.remote, '1', `${hop.url} did not force the tunnel tag`)
      assert.equal(hop.connecting, '198.51.100.20')
      assert.equal(hop.forwardedFor, `${SPOOF}, 10.1.2.3`)
      assert.equal(hop.realIp, '127.0.0.1')
      assert.equal(hop.proto, 'http')
    }
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      child.once('exit', resolve)
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2000)
    })
    await new Promise((resolve) => upstream.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

function nginxBin() {
  for (const candidate of ['nginx', '/usr/sbin/nginx', '/usr/local/sbin/nginx']) {
    const result = spawnSync(candidate, ['-v'], { encoding: 'utf8' })
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (result.status === 0 && text.toLowerCase().includes('nginx')) return candidate
  }
  return null
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForPort(port, child) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`nginx exited ${child.exitCode}`))
        return
      }
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.end()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started > 4000) {
          reject(new Error('nginx did not listen'))
          return
        }
        setTimeout(tick, 50)
      })
    }
    tick()
  })
}

function get(url, headers) {
  return fetch(url, { headers }).then((res) => res.status)
}
