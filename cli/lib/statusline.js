#!/usr/bin/env node
'use strict'

// TokenFin budget line for the Claude Code status bar, and the data behind
// `tokenfin budget`.
//
// SELF-CONTAINED ON PURPOSE (node builtins only): `setup --statusline` copies
// this exact file to ~/.tokenfin/statusline.js and points Claude Code's
// statusLine at `node ~/.tokenfin/statusline.js`, so the status bar never pays
// for an `npx` resolve. Reads the key from ~/.tokenfin/config.json, calls
// GET /api/v1/me/budget, and caches the answer for 60 s in
// ~/.tokenfin/budget-cache.json. Never throws, never prints a stack trace:
// a status bar that errors is worse than one that says "—".

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')

const CACHE_TTL_MS = 60 * 1000
const DEFAULT_APP_URL = 'https://tokenfin.curiousdevs.com'
const tfDir = () => path.join(os.homedir(), '.tokenfin')
const cachePath = () => path.join(tfDir(), 'budget-cache.json')

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const pick = (o, keys) => { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null) return o[k] } return undefined }

// GET /api/v1/me/budget → { me: {today:{cost_usd}, mtd:{cost_usd}} | null,
//   org: {today, mtd}, limit: {scope, period, budget, spent, pct, metric} | null }
// Your own spend when the key belongs to a user, else the org's. Flat aliases
// (today_usd / mtd_usd / pct_used) are accepted too.
function normalizeBudget(j) {
  if (!j || typeof j !== 'object') return null
  const who = j.me || j.org || null
  const lim = j.limit || null
  const isCostLimit = lim && (lim.metric === undefined || lim.metric === 'cost_usd')
  let pct = num(pick(j, ['pct_used', 'percent_used']))
  if (pct === null && lim) pct = num(pick(lim, ['pct', 'pct_used', 'percent_used']))
  return {
    today: who && who.today ? num(who.today.cost_usd) : num(pick(j, ['today_usd'])),
    mtd: who && who.mtd ? num(who.mtd.cost_usd) : num(pick(j, ['mtd_usd'])),
    scope: j.me ? 'you' : j.org ? 'org' : null,
    pct,
    limitUsd: lim && isCostLimit ? num(pick(lim, ['budget', 'budget_usd'])) : null,
    limitTokens: lim && !isCostLimit ? num(lim.budget) : null,
    limitPeriod: lim ? (lim.period || null) : null,
    limitScope: lim ? (lim.scope || null) : null,
  }
}

function money(v) {
  if (v === null || v === undefined) return '$—'
  if (v >= 1000) return '$' + Math.round(v).toLocaleString('en-US')
  if (v >= 100) return '$' + v.toFixed(0)
  return '$' + v.toFixed(2)
}

// "TokenFin $1.23 today · $45.67 MTD · 62% of budget"
function formatStatusline(b) {
  if (!b) return 'TokenFin —'
  const parts = ['TokenFin ' + money(b.today) + ' today', money(b.mtd) + ' MTD']
  if (b.pct !== null && b.pct !== undefined) parts.push(Math.round(b.pct) + '% of budget')
  return parts.join(' · ')
}

function readCfg() {
  try { return JSON.parse(fs.readFileSync(path.join(tfDir(), 'config.json'), 'utf8')) } catch { return {} }
}

function getJson(url, key, timeoutMs) {
  return new Promise((resolve) => {
    let u
    try { u = new URL(url) } catch { return resolve({ ok: false, status: 0 }) }
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + key },
    }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(buf) } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json })
      })
    })
    req.on('error', () => resolve({ ok: false, status: 0 }))
    req.setTimeout(timeoutMs, () => { try { req.destroy() } catch {} ; resolve({ ok: false, status: 0 }) })
    req.end()
  })
}

// Returns { ok, budget, status, cached }. useCache=false for `tokenfin budget`.
async function fetchBudget(opts = {}) {
  const cfg = readCfg()
  const key = String(opts.key || process.env.TOKENFIN_KEY || cfg.read_key || cfg.key || '').trim()
  const appUrl = String(opts.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  if (!key) return { ok: false, status: 0, why: 'no key' }
  const now = Date.now()
  if (opts.useCache !== false) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath(), 'utf8'))
      if (c && c.appUrl === appUrl && now - c.at < CACHE_TTL_MS && c.json) return { ok: true, budget: normalizeBudget(c.json), raw: c.json, cached: true }
    } catch {}
  }
  const r = await getJson(appUrl + '/api/v1/me/budget', key, opts.timeoutMs || 2500)
  if (!r.ok || !r.json) return { ok: false, status: r.status, why: r.status ? 'HTTP ' + r.status : 'unreachable' }
  try {
    fs.mkdirSync(tfDir(), { recursive: true })
    const tmp = cachePath() + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify({ at: now, appUrl, json: r.json }))
    fs.renameSync(tmp, cachePath())
  } catch {}
  return { ok: true, budget: normalizeBudget(r.json), raw: r.json, cached: false }
}

async function statuslineMain() {
  // Claude Code pipes session JSON on stdin; we don't need it and never wait on it.
  let line = 'TokenFin —'
  try {
    const r = await fetchBudget({ timeoutMs: 2000 })
    if (r.ok) line = formatStatusline(r.budget)
    else if (r.status === 401) line = 'TokenFin key revoked — npx tokenfin@latest login'
    else if (r.status === 403) line = 'TokenFin needs a read key — npx tokenfin@latest login'
  } catch {}
  process.stdout.write(line + '\n')
  process.exit(0)
}

module.exports = { normalizeBudget, formatStatusline, fetchBudget, money, CACHE_TTL_MS }

if (require.main === module) statuslineMain()
