'use strict'

// Two ways to get this device its own keys:
//
//  • Browser (loopback): open /cli/authorize, receive single-use reveal
//    token(s) on a 127.0.0.1 callback, exchange each once for a raw key.
//  • Device code (`login --device`, for SSH / devcontainers / no browser):
//    print a short code + URL, the user approves on any signed-in browser,
//    the CLI polls /api/v1/cli/device/poll and exchanges the token(s).
//
// Both send a hostname label and a stable device_id so the server mints
// PER-DEVICE keys (a repeat login rotates only this device's keys): an ingest
// key for agent telemetry and a read key for status/doctor/budget/MCP. One
// reveal token returns both. Servers that still mint one read+write key are
// handled (it is used for both).

const http = require('http')
const crypto = require('crypto')
const os = require('os')
const { openBrowser } = require('./proc')
const { request, revealKeys } = require('./api')

const DEFAULT_APP_URL = 'https://tokenfin.curiousdevs.com'
const TIMEOUT_MS = 180000 // 3 min
const log = (m) => process.stdout.write(m + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Derive the app origin from an MCP endpoint (…/api/mcp → origin).
function deriveAppUrl(mcpUrl) {
  if (!mcpUrl) return DEFAULT_APP_URL
  return mcpUrl.replace(/\/api\/mcp\/?$/, '').replace(/\/$/, '')
}

function deviceLabel() { return (os.hostname() || 'TokenFin CLI').slice(0, 60) }

function page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font:15px -apple-system,system-ui,sans-serif;max-width:26rem;margin:14vh auto;padding:0 1.5rem;text-align:center">` +
    `<h1 style="font-size:1.15rem;margin:.6rem 0">${title}</h1>` +
    `<p style="color:#555;line-height:1.5">${msg}</p></div>`
}

// Turn the single-use reveal token into { key, read_key }. key (ingest) is
// null for viewers, who may read analytics but not send usage.
async function exchangeTokens(base, t) {
  const tok = t.token
  if (!tok) throw new Error('server did not return a key token')
  return revealKeys(base, tok)
}

// Browser login. Resolves { key, read_key }.
function login({ appUrl, mcpUrl, deviceId } = {}) {
  const base = (appUrl || process.env.TOKENFIN_APP_URL || deriveAppUrl(mcpUrl)).replace(/\/$/, '')
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')
    let settled = false
    let timer

    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); try { server.close() } catch {}; fn(arg) }

    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }
      const q = Object.fromEntries(u.searchParams.entries())
      if (!q.token || q.state !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Authorization failed', 'State mismatch — return to your terminal and run npx tokenfin@latest login again.'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page("You're all set", 'TokenFin CLI is authorized. You can close this tab and return to your terminal.'))
      exchangeTokens(base, q).then((k) => finish(resolve, k)).catch((e) => finish(reject, e))
    })

    server.on('error', (e) => finish(reject, e))
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const qs = new URLSearchParams({ port: String(port), state, device: deviceLabel() })
      if (deviceId) qs.set('device_id', deviceId)
      const url = `${base}/cli/authorize?${qs.toString()}`
      log('\nOpening your browser to sign in…\nIf it doesn\'t open, visit:\n  ' + url)
      log('No browser on this machine (SSH, container)? Use: npx tokenfin@latest login --device\n')
      openBrowser(url)
    })

    timer = setTimeout(() => finish(reject, new Error('login timed out after 3 min. Re-run `npx tokenfin@latest login` (or `login --device`), or use --key.')), TIMEOUT_MS)
  })
}

// Device-code login. Resolves { key, read_key }.
async function deviceLogin({ appUrl, deviceId } = {}) {
  const base = (appUrl || process.env.TOKENFIN_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '')
  const s = await request('POST', base + '/api/v1/cli/device/start', null, { label: deviceLabel(), device_id: deviceId || null })
  if (!s.ok || !s.json || !s.json.device_code) {
    if (s.status === 404) throw new Error('this TokenFin server does not support device login yet — use `npx tokenfin@latest login` or --key')
    throw new Error((s.json && s.json.error) || s.why || 'could not start device login (HTTP ' + s.status + ')')
  }
  const { device_code, user_code, verification_uri, verification_uri_complete } = s.json
  let interval = Math.max(2, Number(s.json.interval) || 5) * 1000
  const expiresAt = Date.now() + (Number(s.json.expires_in) || 600) * 1000

  log('\nOn any device where you are signed in to TokenFin, open:')
  log('  ' + (verification_uri || base + '/cli/device'))
  log('and enter the code:\n')
  log('    ' + user_code + '\n')
  if (verification_uri_complete) log('(or open ' + verification_uri_complete + ')\n')
  log('Waiting for approval…')

  while (Date.now() < expiresAt) {
    await sleep(interval)
    const p = await request('POST', base + '/api/v1/cli/device/poll', null, { device_code })
    if (p.ok && p.json && p.json.token) return exchangeTokens(base, p.json)
    const err = p.json && p.json.error
    if (err === 'authorization_pending' || p.status === 0) continue
    if (err === 'slow_down') { interval += 5000; continue }
    if (err === 'expired_token') break
    throw new Error((p.json && (p.json.error_description || p.json.error)) || 'device login failed (HTTP ' + p.status + ')')
  }
  throw new Error('the code expired before it was approved. Run `npx tokenfin@latest login --device` again.')
}

// `tokenfin login` — obtain + persist this device's keys, then re-point any
// agent configs that already exist at the NEW key (a rotated/revoked old key
// must never leave capture silently broken).
async function runLogin(flags = {}) {
  const { readConfig, writeConfig, ensureDeviceId } = require('./config')
  const explicitUrl = flags.url || process.env.TOKENFIN_URL
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || readConfig().appUrl || deriveAppUrl(explicitUrl)).replace(/\/$/, '')
  const mcpUrl = explicitUrl || appUrl + '/api/mcp'
  const deviceId = ensureDeviceId()
  const keys = flags.device ? await deviceLogin({ appUrl, deviceId }) : await login({ appUrl, mcpUrl, deviceId })
  const cfg = { ...readConfig(), key: keys.key || '', read_key: keys.read_key, url: mcpUrl, appUrl, device_id: deviceId }
  writeConfig(cfg)
  log('✔ Logged in. Keys for this device saved to ~/.tokenfin/config.json')
  if (!keys.key) {
    log('⚠ Your workspace role is read-only (viewer): this device got a READ key only, so it can')
    log('  query analytics (status, budget, MCP) but cannot send usage. Ask an admin for the member role.')
    return keys
  }
  const { refreshAgentConfigs } = require('./setup')
  const refreshed = refreshAgentConfigs({ appUrl, key: keys.key, readKey: keys.read_key, prompts: cfg.prompts !== false })
  if (refreshed.length) log('✔ Re-pointed existing configs at the new key: ' + refreshed.join(', '))
  else log('Next: run `npx tokenfin@latest setup` to connect your agents.')
  return keys
}

module.exports = { login, deviceLogin, runLogin, deriveAppUrl, exchangeTokens, DEFAULT_APP_URL, deviceLabel }
