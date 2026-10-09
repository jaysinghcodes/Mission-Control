/**
 * The write token stays on the server.
 * A production bundle built with INGEST_TOKEN and VITE_INGEST_TOKEN set
 * must not contain that value. Client source must not read it either.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const SENTINEL = 'mc-write-token-sentinel-7c1e9a4b'

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

test('client source does not read the write token', () => {
  const src = join(webRoot, 'src')
  for (const path of walk(src)) {
    const text = readFileSync(path, 'utf8')
    assert.equal(text.includes('VITE_INGEST_TOKEN'), false, path)
    assert.equal(text.includes('import.meta.env.INGEST_TOKEN'), false, path)
    assert.equal(text.includes(SENTINEL), false, path)
  }
  const useApi = readFileSync(join(webRoot, 'src/hooks/useApi.ts'), 'utf8')
  const apiBase = readFileSync(join(webRoot, 'src/lib/apiBase.ts'), 'utf8')
  assert.match(useApi, /writeUrl\(/)
  assert.match(apiBase, /\/api/)
  assert.doesNotMatch(apiBase, /INGEST_TOKEN/)
  assert.doesNotMatch(apiBase, /localStorage/)
  assert.doesNotMatch(useApi, /localStorage/)
})

test('built bundle does not contain the write token', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'mc-web-bundle-'))
  try {
    const result = spawnSync(
      'npx',
      ['vite', 'build', '--outDir', outDir, '--emptyOutDir'],
      {
        cwd: webRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          INGEST_TOKEN: SENTINEL,
          VITE_INGEST_TOKEN: SENTINEL,
        },
      },
    )
    assert.equal(
      result.status,
      0,
      `vite build failed\n${result.stdout}\n${result.stderr}`,
    )
    const files = walk(outDir)
    assert.ok(files.length > 0)
    for (const path of files) {
      const text = readFileSync(path)
      assert.equal(
        text.includes(Buffer.from(SENTINEL)),
        false,
        `token leaked into ${path}`,
      )
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
