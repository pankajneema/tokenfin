'use strict'

// Browser login (loopback / PKCE-style). Opens the TokenFin authorize page,
// receives a single-use reveal token on a local 127.0.0.1 callback, exchanges
// it once for the raw API key. Nothing is stored here — the caller persists.

const http = require('http')
const crypto = require('crypto')
const os = require('os')
const { spawn } = require('child_process')

const DEFAULT_APP_URL = 'https://tokenfin.curiousdevs.com'
const TIMEOUT_MS = 180000 // 3 min

// Derive the app origin from an MCP endpoint (…/api/mcp → origin).
function deriveAppUrl(mcpUrl) {
  if (!mcpUrl) return DEFAULT_APP_URL
  return mcpUrl.replace(/\/api\/mcp\/?$/, '').replace(/\/$/, '')
}

function openBrowser(url) {
  const p = process.platform
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'cmd' : 'xdg-open'
  const args = p === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch { /* user can open the printed URL manually */ }
}

function postJson(urlStr, obj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const lib = u.protocol === 'http:' ? require('http') : require('https')
    const body = JSON.stringify(obj)
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''
      res.on('data', c => (d += c))
      res.on('end', () => {
        let parsed = null; try { parsed = JSON.parse(d) } catch {}
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed })
      })
    })
    req.on('error', reject)
    req.write(body); req.end()
  })
}

function page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<div style="font:15px -apple-system,system-ui,sans-serif;max-width:26rem;margin:14vh auto;padding:0 1.5rem;text-align:center">` +
    `<div style="font-size:2rem">✅</div><h1 style="font-size:1.15rem;margin:.6rem 0">${title}</h1>` +
    `<p style="color:#555;line-height:1.5">${msg}</p></div>`
}

// Returns the raw API key on success.
function login({ appUrl, mcpUrl } = {}) {
  const base = (appUrl || process.env.TOKENFIN_APP_URL || deriveAppUrl(mcpUrl)).replace(/\/$/, '')
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')
    let settled = false
    let timer

    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(timer); try { server.close() } catch {}; fn(arg) }

    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return }
      const token = u.searchParams.get('token')
      const gotState = u.searchParams.get('state')
      if (!token || gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Authorization failed', 'State mismatch — return to your terminal and run tokenfin login again.'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page("You're all set", 'TokenFin CLI is authorized. You can close this tab and return to your terminal.'))
      // Exchange the single-use token for the raw key (over the app origin).
      postJson(base + '/api/v1/keys/reveal', { token })
        .then(r => {
          if (!r.ok || !r.body || !r.body.raw_key) {
            return finish(reject, new Error((r.body && r.body.error) || 'could not retrieve the key (' + r.status + ')'))
          }
          finish(resolve, r.body.raw_key)
        })
        .catch(e => finish(reject, e))
    })

    server.on('error', e => finish(reject, e))
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      const url = `${base}/cli/authorize?port=${port}&state=${state}&label=${encodeURIComponent(os.hostname())}`
      process.stdout.write('\nOpening your browser to sign in…\nIf it doesn\'t open, visit:\n  ' + url + '\n\n')
      openBrowser(url)
    })

    timer = setTimeout(() => finish(reject, new Error('login timed out after 3 min. Re-run tokenfin login, or use --key.')), TIMEOUT_MS)
  })
}

// `tokenfin login` — obtain + persist a credential, no tool configuration.
async function runLogin(flags = {}) {
  const { readConfig, writeConfig } = require('./config')
  const mcpUrl = (flags.url || process.env.TOKENFIN_URL || 'https://tokenfin.curiousdevs.com/api/mcp')
  const appUrl = flags.appUrl || process.env.TOKENFIN_APP_URL || deriveAppUrl(mcpUrl)
  const key = await login({ appUrl, mcpUrl })
  writeConfig({ ...readConfig(), key, url: mcpUrl, appUrl })
  process.stdout.write('✔ Logged in. Credential saved to ~/.tokenfin/config.json\n')
  process.stdout.write('Next: run `npx tokenfin setup` to connect your tool.\n')
  return key
}

module.exports = { login, runLogin, deriveAppUrl, DEFAULT_APP_URL }
