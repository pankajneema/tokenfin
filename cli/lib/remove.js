'use strict'

// `tokenfin remove` — full, clean uninstall:
//  1. ask the server to revoke this device's key(s)
//  2. strip our env block, the legacy 0.2 Stop hook and our statusLine from
//     Claude Code settings; strip Codex / Gemini / OpenCode config
//  3. unregister the MCP server
//  4. delete ~/.tokenfin/{config.json,record-usage.js,statusline.js,caches}
// Backups are written before every edit; every write is atomic.

const fs = require('fs')
const path = require('path')
const O = require('./otel')
const { readConfig, configPath, dir, readKeyOf } = require('./config')
const { writeFileAtomic, backup } = require('./fsx')
const { revokeDeviceKey } = require('./api')
const { run } = require('./proc')
const { DEFAULT_APP_URL } = require('./login')
const H = require('./hooks')

const log = (m) => process.stdout.write(m + '\n')

async function remove(flags = {}) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')

  // 0. revoke this device's key(s) server-side while we still hold them.
  if (cfg.key && flags.revoke !== false) {
    const r = await revokeDeviceKey(appUrl, readKeyOf(cfg) || cfg.key, cfg.device_id)
    if (r.ok) log(r.already ? '· device key was already revoked' : '✔ revoked this device\'s TokenFin key(s)')
    else log('⚠ could not revoke the key on the server (' + r.why + ') — revoke it in Dashboard → API Keys.')
  }

  // 1. Claude Code — env keys, legacy hook, our statusLine
  try {
    const p = O.claudeSettingsPath()
    if (!fs.existsSync(p)) {
      log('· ' + p + ' not found')
    } else {
      O.backupClaudeSettings()
      const s = O.readClaudeSettings()
      let removed = 0
      if (s.env) {
        for (const k of O.MANAGED_KEYS) if (k in s.env) { delete s.env[k]; removed++ }
        if (Object.keys(s.env).length === 0) delete s.env
      }
      const hooks = O.stripLegacyHooks(s).removed
      let sl = false
      if (O.isOurStatusline(s.statusLine)) { delete s.statusLine; sl = true }
      const sess = H.stripSessionHooks(s)
      if (removed || hooks || sl || sess) {
        O.writeClaudeSettings(s)
        if (removed) log('✔ Claude Code — removed OTel env from settings.json')
        if (hooks) log('✔ Claude Code — removed legacy 0.2 Stop hook')
        if (sess) log('✔ Claude Code — removed TokenFin session hooks')
        if (sl) log('✔ Claude Code — removed TokenFin statusLine')
      } else log('· Claude Code — nothing to remove')
    }
  } catch (e) { log('· Claude Code — could not edit settings.json: ' + e.message) }

  // 2. Codex — strip the managed [otel] block
  try {
    const p = O.codexConfigPath()
    if (fs.existsSync(p)) {
      const { text, removed } = O.stripCodexBlock(fs.readFileSync(p, 'utf8'))
      if (removed) { backup(p); writeFileAtomic(p, text); log('✔ Codex CLI — removed [otel] block from config.toml') }
      else log('· Codex CLI — no TokenFin block')
    }
  } catch (e) { log('· Codex CLI — could not edit config.toml: ' + e.message) }

  // 3. Gemini — drop the telemetry block (only if it points at TokenFin)
  try {
    const p = O.geminiSettingsPath()
    if (fs.existsSync(p)) {
      const s = O.readGeminiSettings()
      const t = s.telemetry
      if (t && typeof t.otlpEndpoint === 'string' && t.otlpEndpoint.includes('/api/otel')) {
        backup(p); delete s.telemetry; O.writeGeminiSettings(s); log('✔ Gemini CLI — removed telemetry from settings.json')
      } else log('· Gemini CLI — no TokenFin telemetry block')
    }
  } catch (e) { log('· Gemini CLI — could not edit settings.json: ' + e.message) }

  // 3b. OpenCode — delete our plugin file; drop a leftover opencode-otel-plugin
  try {
    if (O.uninstallOpencodePlugin()) log('✔ OpenCode — removed TokenFin plugin (' + O.opencodePluginPath() + ')')
    else log('· OpenCode — no TokenFin plugin')
    const p = O.opencodeConfigPath()
    if (fs.existsSync(p)) {
      const s = O.readOpencodeConfig()
      if (O.hasLegacyOpencodePlugin(s.plugin)) {
        backup(p); s.plugin = O.stripOpencodePlugin(s.plugin); O.writeOpencodeConfig(s)
        log('✔ OpenCode — removed opencode-otel-plugin from ' + path.basename(p))
      }
    }
  } catch (e) { log('· OpenCode — could not edit ' + O.opencodeConfigPath() + ': ' + e.message) }

  // 4. unregister the read-only MCP server
  const r = run('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'])
  if (r.shim) log('· run `claude mcp remove tokenfin -s user` to unregister the MCP server')
  else log(r.status === 0 ? '✔ removed tokenfin MCP server' : '· MCP server was not registered')

  // 5. local TokenFin files
  const files = [configPath(), O.legacyScriptPath(), O.statuslineScriptPath(),
    path.join(dir(), 'budget-cache.json'), path.join(dir(), 'update-check.json'),
    H.sessionScriptPath(), path.join(dir(), 'agent-state.json')]
  let deleted = 0
  for (const f of files) { try { if (fs.existsSync(f)) { fs.unlinkSync(f); deleted++ } } catch {} }
  try { const hd = path.dirname(H.sessionScriptPath()); if (fs.existsSync(hd) && fs.readdirSync(hd).length === 0) fs.rmdirSync(hd) } catch {}
  if (fs.existsSync(H.disabledPath())) log('· kept ' + H.disabledPath() + ' (hooks you disabled from the dashboard — restore them by hand if you want them back)')
  try { if (fs.existsSync(dir()) && fs.readdirSync(dir()).length === 0) fs.rmdirSync(dir()) } catch {}
  if (deleted) log('✔ deleted ~/.tokenfin credentials and caches')

  log('')
  log('Removed. Restart your agents to apply.')
}

module.exports = { remove }
