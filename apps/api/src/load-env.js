/**
 * KEY=VALUE files for the API process and password:reset.
 * apps/api/.env is applied first, then the repo root .env.
 * A variable that is already set, including a blank value, stays as it is.
 */
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

function readEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    let value = body.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

function loadEnvFiles(apiDir, env = process.env) {
  const files = [resolve(apiDir, '.env'), resolve(apiDir, '..', '..', '.env')]
  const loaded = []
  for (const file of files) {
    if (!existsSync(file)) continue
    const parsed = readEnvFile(file)
    let applied = false
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) {
        env[key] = value
        applied = true
      }
    }
    if (applied || Object.keys(parsed).length > 0) loaded.push(file)
  }
  return loaded
}

module.exports = { readEnvFile, loadEnvFiles }
