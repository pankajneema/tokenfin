'use strict'

// `tokenfin setup` — point installed coding agents' native OpenTelemetry at
// TokenFin, then WAIT for the first real event before reporting success. Config
// written is not a connection.
//
// Claude Code: OTel env block in ~/.claude/settings.json (per-turn via logs).
// Codex CLI:   [otel] in ~/.codex/config.toml, user-level (per-turn via metrics).
// Gemini CLI:  telemetry in ~/.gemini/settings.json (per-turn via metrics).

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { readConfig, writeConfig } = require('./config')
const {
  otelEnv, readClaudeSettings, writeClaudeSettings, backupClaudeSettings, claudeSettingsPath,
  codexConfigPath, codexOtelBlock, upsertCodexBlock,
  geminiSettingsPath, geminiTelemetry, readGeminiSettings, writeGeminiSettings,
} = require('./otel')
const { getConnAll, verifyKey } = require('./api')
const { DEFAULT_APP_URL } = require('./login')

const log = (m) => process.stdout.write(m + '\n')
const die = (m) => { throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function hasCmd(name) {
  const r = spawnSync(name, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  return !r.error && r.status === 0
}
const installed = (cmd, dir) => hasCmd(cmd) || fs.existsSync(path.join(os.homedir(), dir))

async function resolveKeyAndAppUrl(flags) {
  let key = (flags.key || process.env.TOKENFIN_KEY || '').trim()
  const cfg = readConfig()
  if (!key && cfg.key) key = String(cfg.key).trim()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')

  if (!key && process.stdin.isTTY && !flags.yes) {
    const { login } = require('./login')
    log('No stored TokenFin credential — signing you in…')
    key = (await login({ appUrl, mcpUrl: appUrl + '/api/mcp' })).trim()
    writeConfig({ ...cfg, key, url: appUrl + '/api/mcp', appUrl })
    log('✔ Logged in. Credential saved to ~/.tokenfin/config.json')
  }
  if (!key) die('no key. Run `tokenfin login`, pass --key tfk_prod_xxx, or set TOKENFIN_KEY.')
  if (/…|\.\.\./.test(key)) die('that looks like a masked key. Use the full raw key from Dashboard → API Keys.')
  return { key, appUrl }
}

// ── per-tool config writers (return { ok, msg }) ─────────────────────────────
function configureClaude(otelEndpoint, key) {
  backupClaudeSettings()
  const s = readClaudeSettings()
  s.env = Object.assign({}, s.env, otelEnv(otelEndpoint, key))
  writeClaudeSettings(s)
  return { ok: true, msg: 'env block → ' + claudeSettingsPath() }
}
function configureCodex(otelEndpoint, key) {
  const p = codexConfigPath()
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  const res = upsertCodexBlock(existing, codexOtelBlock(otelEndpoint, key))
  if (!res.ok) return { ok: false, msg: res.reason }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  if (fs.existsSync(p)) { try { fs.copyFileSync(p, p + '.bak-tokenfin') } catch {} }
  fs.writeFileSync(p, res.text)
  return { ok: true, msg: '[otel] → ' + p + ' (metrics → TokenFin, not statsig)' }
}
function configureGemini(otelEndpoint, key) {
  const p = geminiSettingsPath()
  const s = readGeminiSettings()
  if (fs.existsSync(p)) { try { fs.copyFileSync(p, p + '.bak-tokenfin') } catch {} }
  s.telemetry = geminiTelemetry(otelEndpoint, key)
  writeGeminiSettings(s)
  return { ok: true, msg: 'telemetry → ' + p }
}

function registerMcp(mcpUrl, key) {
  const win = process.platform === 'win32'
  spawnSync('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'], { stdio: 'ignore', shell: win })
  const add = spawnSync('claude',
    ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'tokenfin', mcpUrl, '--header', 'Authorization: Bearer ' + key],
    { stdio: 'ignore', shell: win })
  return !add.error && add.status === 0
}

// Wait until ANY source reports a newer event than the baseline.
async function waitForAnyEvent(appUrl, key, timeoutMs = 120000) {
  const start = Date.now()
  const baseOf = (list) => Object.fromEntries((list || []).map((s) => [s.source, s.last_event_at]))
  const first = await getConnAll(appUrl, key)
  const baseline = first.ok ? baseOf(first.sources) : {}
  while (Date.now() - start < timeoutMs) {
    await sleep(3000)
    const r = await getConnAll(appUrl, key)
    if (!r.ok) continue
    for (const s of r.sources || []) {
      if (s.last_event_at && s.last_event_at !== baseline[s.source]) return s
    }
  }
  return null
}

const emit = (ok, tool, msg) => log((ok ? '✔ ' : '⚠ ') + tool.padEnd(12) + msg)

async function setup(flags) {
  const { key, appUrl } = await resolveKeyAndAppUrl(flags)
  const otelEndpoint = appUrl + '/api/otel'

  const v = await verifyKey(appUrl, key)
  if (!v.ok) die('key check failed — ' + v.why)
  log('✔ key verified\n')

  // Claude Code is the primary, fully-verified path.
  try { const r = configureClaude(otelEndpoint, key); emit(r.ok, 'Claude Code', r.msg) }
  catch (e) { emit(false, 'Claude Code', e.message) }

  if (installed('codex', '.codex')) {
    try { const r = configureCodex(otelEndpoint, key); emit(r.ok, 'Codex CLI', r.msg) }
    catch (e) { emit(false, 'Codex CLI', e.message) }
  }
  if (installed('gemini', '.gemini')) {
    try { const r = configureGemini(otelEndpoint, key); emit(r.ok, 'Gemini CLI', r.msg) }
    catch (e) { emit(false, 'Gemini CLI', e.message) }
  }

  if (registerMcp(appUrl + '/api/mcp', key)) emit(true, 'MCP', 'read-only server registered (query your dashboard from chat)')

  log('\nWaiting for first event… open a coding agent and run a turn.')
  const ev = await waitForAnyEvent(appUrl, key)
  if (ev) {
    log('✓ received (' + ev.source + (ev.model ? ', ' + ev.model : '') + ')')
    log('  Usage is flowing to your dashboard, labeled ' + (ev.cost_basis || 'notional') + '.')
  } else {
    log('· no event yet (2 min). Run a turn, then `npx tokenfin status`.')
    log('  If nothing arrives, `npx tokenfin doctor` explains why.')
  }
}

module.exports = { setup }
