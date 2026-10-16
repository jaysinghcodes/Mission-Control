/**
 * docs/PASTE_IN.md stays short and only names real installer commands.
 * Old headings in the onboarding docs still produce the same anchors.
 * A fragment on an inbound link must match a heading or an explicit id.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const OLD_HEADINGS = {
  'README.md': [
    '# Mission Control',
    '## Screenshots',
    '## Install and run',
    '### Advanced: Node and Postgres',
    '### Ports',
    '### First run',
    '## Stack',
    '### Pages',
    '## How OpenClaw reports in',
    '## Scripts',
    '## Troubleshooting',
    '## What works without OpenClaw',
    '## Roadmap',
    '## Security notes',
    '## Layout',
  ],
  'ONBOARDING.md': [
    '# ONBOARDING.md',
    '### Step 1. Confirm prerequisites',
    '### Step 2. Clone and install',
    '### Step 3. Create the root .env',
    '### Step 4. Start the stack',
    '### Step 5. Verify the dashboard',
    '### Step 6. Connect OpenClaw',
    '### Step 7. Another machine',
    '### Step 8. Smoke test',
  ],
  'docs/OPENCLAW_ONBOARDING.md': [
    '# Mission Control onboarding for OpenClaw agents',
    '## 1. What Mission Control is',
    '## 2. Install and run',
    '### Advanced: Node and Postgres',
    '## 3. What each screen shows',
    '## 4. How you report into Mission Control',
    '### 4.1 Auth',
    '### 4.2 Events: `POST /events`',
    '### 4.3 The bridge (recommended for snapshots)',
    '### 4.4 Tickets: your units of work',
    '### 4.5 Projects',
    '### 4.6 Runs',
    '### 4.7 Models and spend',
    '### 4.8 Memory',
    '### 4.9 Other read routes',
    '### 4.10 Register, heartbeat, and delete',
    '## 5. Adapting your workflow',
    '## 6. Not implemented yet (do not rely on these)',
    '## 7. First read checklist',
  ],
}

const WATCHED = new Set([
  'README.md',
  'ONBOARDING.md',
  'OPENCLAW_ONBOARDING.md',
  'PASTE_IN.md',
  'API.md',
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.turbo'])

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

/** github-slugger 2: drop punctuation, then turn spaces into hyphens. */
function githubSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-')
}

function outsideFences(text) {
  const lines = []
  let fence = false
  for (const line of String(text).split('\n')) {
    if (line.startsWith('```')) {
      fence = !fence
      continue
    }
    if (!fence) lines.push(line)
  }
  return lines
}

function headingLines(text) {
  return outsideFences(text).filter((line) => /^#{1,6}\s+\S/.test(line))
}

function headingSlugs(text) {
  const occurrences = Object.create(null)
  const slugs = []
  for (const line of headingLines(text)) {
    const textPart = line.replace(/^#{1,6}\s+/, '').trim()
    let result = githubSlug(textPart)
    const original = result
    while (Object.hasOwn(occurrences, result)) {
      occurrences[original] += 1
      result = `${original}-${occurrences[original]}`
    }
    occurrences[result] = 0
    slugs.push(result)
  }
  return slugs
}

function explicitIds(text) {
  const ids = new Set()
  for (const match of String(text).matchAll(/<a\s+(?:[^>]*\s)?(?:id|name)="([^"]+)"/gi)) {
    ids.add(match[1])
  }
  return ids
}

function anchorsOf(rel) {
  const text = read(rel)
  return {
    headings: new Set(headingLines(text)),
    slugs: new Set(headingSlugs(text)),
    explicit: explicitIds(text),
  }
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = path.join(dir, name)
    const info = statSync(abs)
    if (info.isDirectory()) walk(abs, out)
    else if (/\.(md|tsx|ts|mjs|html)$/.test(name)) out.push(abs)
  }
  return out
}

function linksIn(text) {
  const found = []
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) found.push(match[1])
  for (const match of text.matchAll(/\b(?:href|to)\s*[:=]\s*['"]([^'"]+)['"]/g)) found.push(match[1])
  return found
}

function locate(fromRel, raw) {
  if (!raw || raw.startsWith('mailto:') || raw.startsWith('javascript:')) return null
  let hash = ''
  let rel = raw
  if (/^https?:\/\//i.test(raw)) {
    let url
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (url.hostname !== 'github.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    const blob = parts.indexOf('blob')
    if (blob < 0 || parts.length < blob + 3) return null
    const repo = parts[1].toLowerCase()
    if (repo !== 'mission-control') return null
    rel = parts.slice(blob + 2).join('/')
    hash = decodeURIComponent(url.hash.replace(/^#/, ''))
  } else {
    const cut = raw.split('#')
    rel = cut[0]
    hash = decodeURIComponent(cut.slice(1).join('#'))
    if (!rel) return { file: fromRel, hash }
    rel = path.normalize(path.join(path.dirname(fromRel), rel)).replaceAll('\\', '/')
  }
  if (rel.startsWith('..')) return null
  return { file: rel, hash }
}

test('PASTE_IN.md stays under 60 lines and drives the installer', () => {
  const text = read('docs/PASTE_IN.md')
  const lines = text.replace(/\n$/, '').split('\n')
  assert.ok(lines.length < 60, `docs/PASTE_IN.md has ${lines.length} lines`)
  assert.match(text, /one yes/)
  assert.match(text, /bash install\.sh/)
  assert.match(text, /--uninstall-schedule/)
  assert.match(text, /register/i)
  assert.match(text, /heartbeat/i)
  assert.match(text, /npm run seed:demo/)
  assert.match(text, /npm run doctor/)
  assert.doesNotMatch(text, /localhost:\d+/)
  assert.doesNotMatch(text, /127\.0\.0\.1:\d+/)
  assert.doesNotMatch(text, /change-me/)
  assert.equal(/[\u2010\u2011\u2012\u2013\u2014\u2015→←⇒]/.test(text), false)

  const pkg = JSON.parse(read('package.json'))
  const scripts = new Set(Object.keys(pkg.scripts ?? {}))
  for (const match of text.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
    assert.ok(scripts.has(match[1]), `npm run ${match[1]} is not in package.json`)
  }

  const install = read('install.sh')
  const doctor = read('scripts/doctor.mjs')
  for (const match of text.matchAll(/\bbash install\.sh\b([^\n`]*)/g)) {
    const flags = match[1].match(/--[A-Za-z0-9-]+/g) ?? []
    for (const flag of flags) {
      assert.ok(install.includes(flag), `${flag} is not in install.sh`)
    }
  }
  for (const match of text.matchAll(/--[A-Za-z0-9][A-Za-z0-9-]*/g)) {
    assert.ok(install.includes(match[0]), `${match[0]} is not in install.sh`)
  }
  assert.ok(install.includes('Waiting for the API health check on port'))
  assert.ok(text.includes('Waiting for the API health check on port'))
  assert.ok(doctor.includes('pass ports: Port'))
  assert.ok(text.includes('pass ports: Port'))
})

test('old onboarding and README anchors still resolve', () => {
  for (const [rel, headings] of Object.entries(OLD_HEADINGS)) {
    const found = anchorsOf(rel)
    for (const heading of headings) {
      assert.ok(found.headings.has(heading), `${rel} is missing heading ${heading}`)
    }
  }
})

test('inbound doc links and README anchors resolve', () => {
  const cache = new Map()
  function anchors(rel) {
    if (!cache.has(rel)) cache.set(rel, anchorsOf(rel))
    return cache.get(rel)
  }
  const files = walk(root, [])
  const checked = []
  for (const abs of files) {
    const fromRel = path.relative(root, abs).replaceAll('\\', '/')
    const text = readFileSync(abs, 'utf8')
    for (const raw of linksIn(text)) {
      const target = locate(fromRel, raw)
      if (!target) continue
      const base = path.posix.basename(target.file)
      if (!WATCHED.has(base)) continue
      const absTarget = path.join(root, target.file)
      assert.equal(statSync(absTarget, { throwIfNoEntry: false })?.isFile(), true, `${fromRel} links to missing ${target.file}`)
      checked.push(`${fromRel} -> ${target.file}${target.hash ? '#' + target.hash : ''}`)
      if (!target.hash) continue
      const found = anchors(target.file)
      const ok = found.slugs.has(target.hash) || found.explicit.has(target.hash)
      assert.equal(ok, true, `${fromRel} -> ${target.file}#${target.hash} does not resolve`)
    }
  }
  assert.ok(checked.some((item) => item.includes('docs/PASTE_IN.md')))
  assert.ok(checked.some((item) => item.includes('#41-auth')))
  assert.ok(checked.some((item) => item.includes('docs/OPENCLAW_ONBOARDING.md#410-register-heartbeat-and-delete')))
})
