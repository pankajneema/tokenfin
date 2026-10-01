'use strict'

// `tokenfin setup` — point installed coding agents' native OpenTelemetry at
// TokenFin, then WAIT for the first real event before reporting success.
// Config written is not a connection.
//
// Claude Code: OTel env block in ~/.claude/settings.json (per-turn via logs).
// Codex CLI:   [otel] in ~/.codex/config.toml, user-level (per-turn via metrics).
// Gemini CLI:  telemetry in ~/.gemini/settings.json (per-turn via metrics).
// OpenCode:    TokenFin plugin → ~/.config/opencode/plugin/tokenfin.js (per message,
//              full tokens incl. cache + prompt text); drops opencode-otel-plugin.
// Agents that aren't installed are skipped. Every write is atomic + backed up.

const fs = require('fs')
const path = require('path')
const { readConfig, writeConfig, ensureDeviceId } = require('./config')
const { writeFileAtomic, backup } = require('./fsx')
const O = require('./otel')
const { getConnAll, verifyIngestKey } = require('./api')
const { DEFAULT_APP_URL } = require('./login')
const { run, hasCmd } = require('./proc')
const H = require('./hooks')

const log = (m) => process.stdout.write(m + '\n')
const die = (m) => { throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const installed = {
  claude: () => hasCmd('claude') || fs.existsSync(O.claudeDir()),
  codex: () => hasCmd('codex') || fs.existsSync(path.dirname(O.codexConfigPath())),
  gemini: () => hasCmd('gemini') || fs.existsSync(path.dirname(O.geminiSettingsPath())),
  opencode: () => hasCmd('opencode') || fs.existsSync(path.dirname(O.opencodeConfigPath())),
}

async function resolveKeys(flags) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const explicit = (flags.key || process.env.TOKENFIN_KEY || '').trim()
  let key = explicit || String(cfg.key || '').trim()
  let readKey = (flags.readKey || process.env.TOKENFIN_READ_KEY || '').trim() || (explicit ? explicit : String(cfg.read_key || cfg.key || '').trim())

  if (!key && process.stdin.isTTY && !flags.yes) {
    const { login } = require('./login')
    log('No stored TokenFin credential — signing you in…')
    const k = await login({ appUrl, mcpUrl: appUrl + '/api/mcp', deviceId: ensureDeviceId() })
    key = k.key; readKey = k.read_key
    log('✔ Logged in.')
  }
  if (!key) die('no key. Run `npx tokenfin@latest login` (or `login --device` over SSH), pass --key tfk_prod_xxx, or set TOKENFIN_KEY.')
  if (/…|\.\.\./.test(key)) die('that looks like a masked key. Use the full raw key (it is shown only once).')
  return { key, readKey: readKey || key, appUrl }
}

// ── per-tool config writers (return { ok, msg }) ─────────────────────────────
function configureClaude(otelEndpoint, key, opts) {
  O.backupClaudeSettings()
  const s = O.readClaudeSettings()
  O.applyOtelEnv(s, otelEndpoint, key, opts)
  const { removed } = O.stripLegacyHooks(s)
  O.writeClaudeSettings(s)
  return { ok: true, msg: 'env block → ' + O.claudeSettingsPath() + (removed ? ' (removed legacy 0.2 Stop hook)' : '') }
}
function configureCodex(otelEndpoint, key, opts) {
  const p = O.codexConfigPath()
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  const res = O.upsertCodexBlock(existing, O.codexOtelBlock(otelEndpoint, key, opts))
  if (!res.ok) return { ok: false, msg: res.reason }
  backup(p)
  writeFileAtomic(p, res.text)
  return { ok: true, msg: '[otel] → ' + p + ' (metrics → TokenFin, not statsig)' }
}
function configureGemini(otelEndpoint, key, opts) {
  const p = O.geminiSettingsPath()
  const s = O.readGeminiSettings()
  backup(p)
  s.telemetry = O.geminiTelemetry(otelEndpoint, key, opts)
  O.writeGeminiSettings(s)
  return { ok: true, msg: 'telemetry → ' + p }
}
// Install TokenFin's own plugin (reads ~/.tokenfin/config.json itself) and
// drop the third-party opencode-otel-plugin so nothing is counted twice.
function configureOpencode() {
  const inst = O.installOpencodePlugin()
  let msg = 'plugin ' + (inst.version ? 'v' + inst.version + ' ' : '') + (inst.changed ? '→ ' : 'up to date at ') + O.opencodePluginPath()
  const p = O.opencodeConfigPath()
  let s
  try { s = O.readOpencodeConfig() }
  catch { return { ok: false, msg: msg + '; could not parse ' + p + ' — remove "' + O.LEGACY_OPENCODE_PLUGIN + '" from its plugin list yourself (double counting)' } }
  if (O.hasLegacyOpencodePlugin(s.plugin)) {
    backup(p)
    s.plugin = O.stripOpencodePlugin(s.plugin)
    O.writeOpencodeConfig(s)
    msg += ' (removed ' + O.LEGACY_OPENCODE_PLUGIN + ' from ' + path.basename(p) + ')'
  }
  return { ok: true, msg }
}

// Register the read-only MCP server with the READ key. No shell (so the
// "Authorization: Bearer …" header is never split) — `claude mcp add-json`
// takes the whole server definition as one argv entry. Returns
// { ok, manual? } — manual is the command to show when we can't run it.
function registerMcp(mcpUrl, readKey) {
  const json = JSON.stringify({ type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer ' + readKey } })
  const rm = run('claude', ['mcp', 'remove', 'tokenfin', '-s', 'user'])
  if (rm.shim) return { ok: false, manual: `claude mcp add-json -s user tokenfin '${json.replace(readKey, '<READ_KEY>')}'` }
  const add = run('claude', ['mcp', 'add-json', '-s', 'user', 'tokenfin', json])
  return { ok: !add.error && add.status === 0 }
}

// Claude Code SessionStart / SessionEnd hooks → ~/.tokenfin/hooks/session.js
// (session id, cwd, git branch/remote, hostname → /api/v1/sessions/meta).
// enabled=false strips ours (opt-out persists via config.session_hooks).
function configureSessionHooks(enabled) {
  const s = O.readClaudeSettings()
  const had = H.hasSessionHooks(s)
  if (!enabled) {
    if (!H.stripSessionHooks(s)) return { ok: true, msg: 'off (--no-session-hooks)' }
    O.backupClaudeSettings(); O.writeClaudeSettings(s)
    return { ok: true, msg: 'removed (--no-session-hooks)' }
  }
  H.installSessionScript()
  const before = JSON.stringify(s)
  H.addSessionHooks(s)
  if (JSON.stringify(s) !== before) { O.backupClaudeSettings(); O.writeClaudeSettings(s) }
  return { ok: true, msg: (had ? 'up to date' : 'SessionStart + SessionEnd') + ' → ' + H.sessionScriptPath() }
}

// Install the statusline script + settings entry. Never overwrites a
// statusLine the user already has (ours is recognised and refreshed).
function installStatusline() {
  const src = path.join(__dirname, 'statusline.js')
  writeFileAtomic(O.statuslineScriptPath(), fs.readFileSync(src))
  const s = O.readClaudeSettings()
  if (s.statusLine && !O.isOurStatusline(s.statusLine)) {
    return { ok: false, msg: 'you already have a statusLine in ' + O.claudeSettingsPath() + ' — left it alone. To show TokenFin, run `' + O.statuslineCommand() + '` from your own script.' }
  }
  O.backupClaudeSettings()
  s.statusLine = { type: 'command', command: O.statuslineCommand(), padding: 0 }
  O.writeClaudeSettings(s)
  return { ok: true, msg: 'statusLine → ' + O.statuslineCommand() }
}

// After `login` rotates keys: rewrite ONLY configs that already point at
// TokenFin, so capture keeps working. Returns the list of tools touched.
function refreshAgentConfigs({ appUrl, key, readKey, prompts }) {
  const otelEndpoint = appUrl.replace(/\/$/, '') + '/api/otel'
  const opts = { prompts }
  const done = []
  try {
    const s = O.readClaudeSettings()
    if (s.env && s.env.OTEL_EXPORTER_OTLP_HEADERS && O.keyFromHeaders(s.env.OTEL_EXPORTER_OTLP_HEADERS) !== key) {
      configureClaude(otelEndpoint, key, { prompts: prompts && !!s.env.OTEL_LOG_USER_PROMPTS }); done.push('Claude Code')
    }
  } catch { /* invalid JSON — doctor will say so */ }
  try {
    const p = O.codexConfigPath()
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf8')
      if (O.hasCodexBlock(t) && !t.includes('Bearer ' + key)) {
        configureCodex(otelEndpoint, key, { prompts: prompts && /log_user_prompt = true/.test(t) }); done.push('Codex CLI')
      }
    }
  } catch {}
  try {
    const g = O.readGeminiSettings().telemetry
    if (g && typeof g.otlpEndpoint === 'string' && g.otlpEndpoint.includes('/api/otel') && !g.otlpEndpoint.endsWith('key=' + key)) {
      configureGemini(otelEndpoint, key, { prompts: prompts && g.logPrompts !== false }); done.push('Gemini CLI')
    }
  } catch {}
  const mcp = O.readMcpKey()
  if (mcp.registered && mcp.key !== readKey && readKey) {
    if (registerMcp(appUrl.replace(/\/$/, '') + '/api/mcp', readKey).ok) done.push('MCP')
  }
  return done
}

// Wait until ANY source reports a newer event than the baseline.
async function waitForAnyEvent(appUrl, key, timeoutMs = 120000) {
  const start = Date.now()
  const baseOf = (list) => Object.fromEntries((list || []).map((s) => [s.source, s.last_event_at]))
  const first = await getConnAll(appUrl, key)
  if (!first.ok && (first.status === 401 || first.status === 403)) return { unauthorized: true }
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

function promptNotice(prompts) {
  if (prompts) {
    log('ℹ Prompt capture is ON: the text of each prompt you type is sent to TokenFin with its')
    log('  token counts, so your workspace admins can see it in Prompt Analytics. Prompt text')
    log('  expires after 90 days (Settings → Data), and your org can turn capture off for everyone.')
    log('  Opt out on this machine: npx tokenfin@latest setup --no-prompts\n')
  } else {
    log('ℹ Prompt capture is OFF on this machine (--no-prompts): only token counts, model and cost')
    log('  are sent — never prompt text. Re-enable: npx tokenfin@latest setup --prompts\n')
  }
}

async function setup(flags = {}) {
  const { key, readKey, appUrl } = await resolveKeys(flags)
  const otelEndpoint = appUrl + '/api/otel'
  const cfg = readConfig()
  const prompts = flags.prompts === false ? false : flags.prompts === true ? true : cfg.prompts !== false
  const sessionHooks = flags.sessionHooks === false ? false : flags.sessionHooks === true ? true : cfg.session_hooks !== false
  const opts = { prompts }

  const v = await verifyIngestKey(appUrl, key)
  if (!v.ok) die('key check failed — ' + v.why)
  log('✔ key verified\n')
  writeConfig({ ...readConfig(), key, read_key: readKey, appUrl, url: appUrl + '/api/mcp', prompts, session_hooks: sessionHooks, device_id: cfg.device_id || ensureDeviceId() })

  promptNotice(prompts)

  let any = false
  if (installed.claude()) {
    any = true
    try { const r = configureClaude(otelEndpoint, key, opts); emit(r.ok, 'Claude Code', r.msg) }
    catch (e) { emit(false, 'Claude Code', e.message) }
    try { const r = configureSessionHooks(sessionHooks); emit(r.ok, 'Sessions', 'hooks ' + r.msg) }
    catch (e) { emit(false, 'Sessions', e.message) }
  } else log('· Claude Code  not installed — skipped')
  if (O.deleteLegacyScript()) emit(true, 'Legacy', 'deleted ~/.tokenfin/record-usage.js (0.2 hook script)')

  if (installed.codex()) {
    any = true
    try { const r = configureCodex(otelEndpoint, key, opts); emit(r.ok, 'Codex CLI', r.msg) }
    catch (e) { emit(false, 'Codex CLI', e.message) }
  }
  if (installed.gemini()) {
    any = true
    try { const r = configureGemini(otelEndpoint, key, opts); emit(r.ok, 'Gemini CLI', r.msg) }
    catch (e) { emit(false, 'Gemini CLI', e.message) }
  }
  if (installed.opencode()) {
    any = true
    try { const r = configureOpencode(); emit(r.ok, 'OpenCode', r.msg) }
    catch (e) { emit(false, 'OpenCode', e.message) }
  }
  if (!any) log('⚠ no supported agent found (Claude Code, Codex CLI, Gemini CLI, OpenCode). Install one, then re-run.')

  if (installed.claude() && flags.mcp !== false) {
    const m = registerMcp(appUrl + '/api/mcp', readKey)
    if (m.ok) emit(true, 'MCP', 'read-only server registered (query your dashboard from chat)')
    else if (m.manual) emit(false, 'MCP', 'run this yourself to register the read-only server:\n    ' + m.manual)
  }

  if (flags.statusline) {
    try { const r = installStatusline(); emit(r.ok, 'Statusline', r.msg) }
    catch (e) { emit(false, 'Statusline', e.message) }
  }

  // Upload the (redacted) agent configs for Dashboard → Agents; quiet on failure.
  await require('./agentconfig').autoSync({ ...flags, key: readKey, appUrl })

  if (flags.wait === false) { log('\nDone. Run a turn in your agent, then `npx tokenfin@latest status`.'); return }
  log('\nWaiting for first event… open a coding agent and run a turn.')
  const ev = await waitForAnyEvent(appUrl, readKey)
  if (ev && ev.unauthorized) {
    log('· cannot watch for events with this key (read access denied). Run a turn, then check the dashboard.')
  } else if (ev) {
    log('✓ received (' + ev.source + (ev.model ? ', ' + ev.model : '') + ')')
    log('  Usage is flowing to your dashboard, labeled ' + (ev.cost_basis || 'notional') + '.')
  } else {
    log('· no event yet (2 min). Run a turn, then `npx tokenfin@latest status`.')
    log('  If nothing arrives, `npx tokenfin@latest doctor` explains why.')
  }
}

module.exports = { setup, refreshAgentConfigs, registerMcp, installStatusline, configureClaude, configureSessionHooks, promptNotice }
