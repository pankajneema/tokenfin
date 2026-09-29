'use strict'

// "A newer tokenfin is available" notice. Checks the npm registry at most once
// a day (cached in ~/.tokenfin/update-check.json) with a 1.5 s timeout, and is
// skipped entirely in CI, with --yes, or TOKENFIN_NO_UPDATE_CHECK=1. Never
// blocks or fails a command. TOKENFIN_REGISTRY_URL overrides the registry
// (tests point it at a local mock).

const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { dir } = require('./config')

const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 1500
const registryUrl = () => process.env.TOKENFIN_REGISTRY_URL || 'https://registry.npmjs.org/tokenfin/latest'
const cacheFile = () => path.join(dir(), 'update-check.json')

// Returns >0 if a > b (plain x.y.z; pre-release tags compare lower).
function compareVersions(a, b) {
  const parse = (v) => String(v || '').replace(/^v/, '').split('-')
  const [ma, pa] = parse(a), [mb, pb] = parse(b)
  const na = ma.split('.').map((n) => parseInt(n, 10) || 0)
  const nb = mb.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0) }
  if (pa && !pb) return -1
  if (!pa && pb) return 1
  return 0
}

function shouldSkip(flags = {}) {
  return !!(flags.yes || process.env.CI || process.env.TOKENFIN_NO_UPDATE_CHECK)
}

function fetchLatest() {
  return new Promise((resolve) => {
    let u
    try { u = new URL(registryUrl()) } catch { return resolve(null) }
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.get(u, { headers: { Accept: 'application/json' } }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (buf += c))
      res.on('end', () => { try { resolve(JSON.parse(buf).version || null) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(TIMEOUT_MS, () => { try { req.destroy() } catch {} ; resolve(null) })
  })
}

// Returns the latest version string if newer than `current`, else null.
async function checkForUpdate(current, flags = {}) {
  if (shouldSkip(flags)) return null
  let latest = null
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'))
    if (c && Date.now() - c.checked_at < DAY_MS) latest = c.latest || null
    else throw new Error('stale')
  } catch {
    latest = await fetchLatest()
    try {
      fs.mkdirSync(dir(), { recursive: true })
      fs.writeFileSync(cacheFile(), JSON.stringify({ checked_at: Date.now(), latest }) + '\n')
    } catch { /* read-only home — fine */ }
  }
  return latest && compareVersions(latest, current) > 0 ? latest : null
}

function updateNotice(current, latest) {
  return `\n  Update available: tokenfin ${current} → ${latest}\n  Run: npx tokenfin@latest <command>  (npx caches old versions — @latest forces the new one)\n`
}

module.exports = { checkForUpdate, compareVersions, updateNotice, shouldSkip, registryUrl }
