/**
 * Vite dev and preview listen on MC_WEB_PORT and proxy to the API port.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer as createViteServer, preview, resolveConfig } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configFile = path.join(root, 'vite.config.ts')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

test('dev and preview bind MC_WEB_PORT and the proxy uses PORT', async () => {
  const probe = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ service: 'mission-control', via: req.url }))
  })
  const apiPort = await listen(probe)
  const webProbe = createServer()
  const webPort = await listen(webProbe)
  await new Promise((resolve) => webProbe.close(resolve))
  const previous = {
    PORT: process.env.PORT,
    MC_API_PORT: process.env.MC_API_PORT,
    MC_WEB_PORT: process.env.MC_WEB_PORT,
  }
  process.env.PORT = String(apiPort)
  process.env.MC_API_PORT = '3999'
  process.env.MC_WEB_PORT = String(webPort)
  let dev
  let viewed
  try {
    const config = await resolveConfig({ configFile }, 'serve')
    assert.equal(config.server.port, webPort)
    assert.equal(config.server.strictPort, true)
    assert.equal(config.preview.port, webPort)
    assert.equal(config.preview.strictPort, true)
    assert.equal(config.server.proxy['/api'].target, `http://127.0.0.1:${apiPort}`)
    assert.equal(config.preview.proxy['/api'].target, `http://127.0.0.1:${apiPort}`)

    dev = await createViteServer({ configFile })
    await dev.listen()
    assert.equal(dev.httpServer.address().port, webPort)
    const page = await fetch(`http://127.0.0.1:${webPort}/`)
    assert.equal(page.ok, true)
    assert.match(await page.text(), /Mission Control/)
    const proxied = await fetch(`http://127.0.0.1:${webPort}/api/health`)
    assert.equal(proxied.ok, true)
    assert.equal((await proxied.json()).service, 'mission-control')
    await dev.close()
    dev = undefined

    const outDir = mkdtempSync(path.join(tmpdir(), 'mc-preview-'))
    writeFileSync(
      path.join(outDir, 'index.html'),
      '<!doctype html><title>Mission Control</title><div id="root"></div>\n',
    )
    viewed = await preview({
      configFile,
      build: { outDir },
    })
    assert.equal(viewed.httpServer.address().port, webPort)
    const previewPage = await fetch(`http://127.0.0.1:${webPort}/`)
    assert.equal(previewPage.status, 200)
    assert.match(await previewPage.text(), /Mission Control/)
    const previewProxy = await fetch(`http://127.0.0.1:${webPort}/api/health`)
    assert.equal(previewProxy.ok, true)
    assert.equal((await previewProxy.json()).service, 'mission-control')
  } finally {
    if (dev) await dev.close()
    if (viewed) await viewed.close()
    probe.close()
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
