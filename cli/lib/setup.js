'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawnSync } = require('child_process')
const { readConfig, writeConfig } = require('./config')

const DEFAULT_URL = 'https://tokenfin.curiousdevs.com/api/mcp'

const log = (m) => process.stdout.write(m + '\n')
const die = (m) => { throw new Error(m) }

function hasClaude() {
  const r = spawnSync('claude', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return !r.error && r.status === 0
}

// Read a secret from a TTY without echoing it (masks with *).
function promptSecret(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    if (!stdin.isTTY) return resolve('')
    stdout.write(question)
    let val = ''
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    const onData = (chunk) => {
      const ch = chunk.toString('utf8')
      const code = ch.charCodeAt(0)
      if (ch === '\n' || ch === '\r' || code === 4) { // Enter / EOT
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData)
        stdout.write('\n'); resolve(val.trim())
      } else if (code === 3) { // Ctrl-C
        stdout.write('\n'); process.exit(130)
      } else if (code === 127 || code === 8) { // backspace / DEL
        if (val.length) { val = val.slice(0, -1); stdout.write('\b \b') }
      } else if (code >= 32) {
        val += ch; stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

async function resolveKey(flags) {
  // Order: explicit flag > env > stored credential > browser login.
  let key = (flags.key || process.env.TOKENFIN_KEY || '').trim()
  if (!key) { const c = readConfig(); if (c.key) key = String(c.key).trim() }
  if (!key && process.stdin.isTTY && !flags.yes) {
    const { login, deriveAppUrl } = require('./login')
    const mcpUrl = (flags.url || process.env.TOKENFIN_URL || DEFAULT_URL).trim()
    const appUrl = flags.appUrl || process.env.TOKENFIN_APP_URL || deriveAppUrl(mcpUrl)
    log('No stored TokenFin credential — signing you in…')
    key = (await login({ appUrl, mcpUrl })).trim()
    writeConfig({ ...readConfig(), key, url: mcpUrl, appUrl })
    log('✔ Logged in. Credential saved to ~/.tokenfin/config.json')
  }
  if (!key) die('no key provided. Run `tokenfin login`, pass --key tfk_prod_xxx, or set TOKENFIN_KEY.')
  if (/…|\.\.\./.test(key)) die('that looks like a masked key. Use the full raw key from Dashboard → API Keys.')
  return key.trim()
}

// Live test: call get_spend through the MCP endpoint so a bad key/URL fails
// loudly at setup time instead of silently recording nothing forever.
function verifyKey(url, key) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url) } catch { return resolve({ ok: false, why: 'invalid URL: ' + url }) }
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_spend', arguments: { days: 1 } } })
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({ hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Authorization': 'Bearer ' + key, 'Content-Length': Buffer.byteLength(body) } },
      res => {
        res.resume()
        if (res.statusCode === 401) return resolve({ ok: false, why: 'the server rejected this key (401). Copy the full raw key from Dashboard → API Keys.' })
        if (res.statusCode && res.statusCode >= 400) return resolve({ ok: false, why: 'server returned HTTP ' + res.statusCode })
        res.on('end', () => resolve({ ok: true }))
      })
    req.on('error', (e) => resolve({ ok: false, why: 'could not reach ' + url + (e && e.code ? ' (' + e.code + ')' : '') }))
    req.setTimeout(6000, () => { try { req.destroy() } catch {}; resolve({ ok: false, why: 'timed out reaching ' + url }) })
    req.write(body); req.end()
  })
}

// Interactive tool picker (TTY only) — lists every supported client.
function pickTool() {
  const { listIds, displayName } = require('./tools')
  const ids = listIds()
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write('\nWhich tool are you setting up?\n')
    ids.forEach((id, i) => process.stdout.write(`  ${i + 1}) ${displayName(id)}${id === 'claudecode' ? '  (auto-records)' : ''}\n`))
    rl.question('Enter a number [1]: ', (ans) => {
      rl.close()
      const n = parseInt(ans.trim(), 10)
      resolve(ids[(Number.isInteger(n) && n >= 1 && n <= ids.length) ? n - 1 : 0])
    })
  })
}

async function setup(flags) {
  const url = (flags.url || process.env.TOKENFIN_URL || DEFAULT_URL).trim()
  const key = await resolveKey(flags)

  const v = await verifyKey(url, key)
  if (!v.ok) die('key check failed — ' + v.why)
  log('✔ key verified against ' + url)

  // Which tool? explicit flag > interactive picker > default Claude Code.
  let tool = (flags.tool || '').trim().toLowerCase()
  if (!tool && process.stdin.isTTY && !flags.yes) tool = await pickTool()
  if (!tool) tool = 'claudecode'

  if (tool !== 'claudecode') {
    const { configureTool, displayName } = require('./tools')
    let r
    try { r = configureTool(tool, { url, key }) } catch (e) { die(e.message) }
    if (r.file) {
      log('✔ wrote ' + r.file)
    } else if (r.snippet) {
      log('\nAdd this to ' + r.name + ':\n' + r.snippet + '\n')
    }
    log('✔ ' + displayName(tool) + ' configured — the tokenfin MCP tools (analytics, compress, record_usage) are connected.')
    if (r.after) log('  Next: ' + r.after)
    log('')
    log('For automatic recording on ' + displayName(tool) + ', run `npx tokenfin proxy` and point the tool\'s')
    log('ANTHROPIC_BASE_URL / OPENAI_BASE_URL at it — every call is then recorded, fail-open.')
    return
  }

  // ── Claude Code: MCP server + deterministic Stop hook ──
  if (!hasClaude()) {
    die("the 'claude' CLI was not found in PATH. Install Claude Code first, or run `tokenfin setup --tool <cursor|codex|…>`.")
  }

  const dir = path.join(os.homedir(), '.claude')
  fs.mkdirSync(dir, { recursive: true })

  // 1. private hook config (url + key)
  const cfgPath = path.join(dir, 'tokenfin-hook.json')
  fs.writeFileSync(cfgPath, JSON.stringify({ url, key }, null, 2) + '\n')
  try { fs.chmodSync(cfgPath, 0o600) } catch { /* no-op on Windows */ }
  log('✔ wrote ' + cfgPath)

  // 2. the recorder script (Stop hook target)
  const recSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'record-usage.js'), 'utf8')
  const recPath = path.join(dir, 'tokenfin-record-usage.js')
  fs.writeFileSync(recPath, recSrc)
  log('✔ wrote ' + recPath)

  // 3. merge the Stop hook into settings.json (backup first, idempotent)
  const settingsPath = path.join(dir, 'settings.json')
  let settings = {}
  if (fs.existsSync(settingsPath)) {
    try { fs.copyFileSync(settingsPath, settingsPath + '.bak-tokenfin') } catch {}
    // NEVER silently wipe an existing-but-corrupt settings.json.
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch {
      die(settingsPath + ' exists but is not valid JSON — fix it, then re-run setup.')
    }
  }
  settings.hooks = settings.hooks || {}
  settings.hooks.Stop = settings.hooks.Stop || []
  const cmd = 'node "' + recPath + '"' // quoted — home dirs can contain spaces
  const isOurs = (h) => typeof h.command === 'string' && h.command.includes('tokenfin-record-usage.js')
  const present = settings.hooks.Stop.some(g => (g.hooks || []).some(h => h.command === cmd))
  if (!present) {
    // drop any stale (old, unquoted) variant before adding the current one
    settings.hooks.Stop = settings.hooks.Stop
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
      .filter(g => (g.hooks || []).length > 0)
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: cmd }] })
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  log(present ? '✔ Stop hook already present' : '✔ added Stop hook to settings.json')

  // 4. register the MCP server (user scope) — replace any prior entry
  const win = process.platform === 'win32'
  spawnSync('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'], { stdio: 'ignore', shell: win })
  const add = spawnSync('claude',
    ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'tokenfin', url, '--header', 'Authorization: Bearer ' + key],
    { stdio: 'ignore', shell: win })
  if (add.error || add.status !== 0) {
    die('failed to register the MCP server via `claude mcp add`. Is Claude Code installed and up to date?')
  }
  log('✔ registered tokenfin MCP server (user scope)')

  log('')
  log('Done. Restart Claude Code — every session now auto-records usage to your TokenFin dashboard.')
}

module.exports = { setup, DEFAULT_URL }
