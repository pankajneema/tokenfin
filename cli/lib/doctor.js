'use strict'

// `tokenfin doctor` — find silent data loss before it becomes a wrong invoice.

const fs = require('fs')
const { readConfig, readKeyOf } = require('./config')
const O = require('./otel')
const { getConnStatus, verifyIngestKey } = require('./api')
const { DEFAULT_APP_URL } = require('./login')
const { hasCmd } = require('./proc')

const log = (m) => process.stdout.write(m + '\n')
const PASS = '✔', WARN = '⚠', FAIL = '✗', INFO = '·'
const mask = (k) => (k ? String(k).slice(0, 13) + '…' + String(k).slice(-4) : '(none)')

async function doctor(flags = {}) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const key = (flags.key || process.env.TOKENFIN_KEY || cfg.key || '').trim()
  const readKey = (flags.key || process.env.TOKENFIN_KEY || readKeyOf(cfg)).trim()

  let fails = 0, warns = 0
  const line = (sym, msg) => { if (sym === FAIL) fails++; if (sym === WARN) warns++; log(sym + ' ' + msg) }

  // 1. Claude Code present
  const hasClaude = hasCmd('claude')
  line(hasClaude ? PASS : WARN, hasClaude ? 'Claude Code CLI found' : 'Claude Code CLI not in PATH (install it to send events)')

  // 2. settings.json valid + config complete
  let settings = null
  try { settings = O.readClaudeSettings() }
  catch (e) { line(FAIL, e.message) }

  let settingsKey = null
  if (settings) {
    const env = settings.env || {}
    const missing = O.REQUIRED_KEYS.filter((k) => !env[k])
    line(missing.length ? FAIL : PASS,
      missing.length ? 'OTel config incomplete (missing: ' + missing.join(', ') + ') — run `npx tokenfin@latest setup`' : 'OTel config present in ' + O.claudeSettingsPath())
    if (!env.OTEL_LOG_USER_PROMPTS) line(INFO, cfg.prompts === false ? 'prompt capture off (--no-prompts)' : 'prompt text not captured — `npx tokenfin@latest setup --prompts` to enable')
    else line(INFO, 'prompt capture on — opt out with `npx tokenfin@latest setup --no-prompts`')

    if (O.stripLegacyHooks(JSON.parse(JSON.stringify(settings))).removed) {
      line(FAIL, 'legacy 0.2 Stop hook (record-usage.js) still installed — it double-counts. Run `npx tokenfin@latest setup` to remove it.')
    }

    const proto = env.OTEL_EXPORTER_OTLP_PROTOCOL
    if (proto === 'http/protobuf' || proto === 'http/json') line(PASS, 'protocol ' + proto)
    else if (proto === 'grpc') line(FAIL, 'protocol is grpc — our HTTP receiver needs http/protobuf. Re-run `npx tokenfin@latest setup`.')
    else if (proto) line(WARN, 'unexpected protocol "' + proto + '"')

    const temp = env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE
    if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      line(temp === 'cumulative' ? PASS : WARN,
        temp === 'cumulative' ? 'metrics temporality cumulative'
          : 'metrics temporality is "' + (temp || 'unset') + '" — delta may be dropped. Re-run `npx tokenfin@latest setup`.')
    }

    const ep = env.OTEL_EXPORTER_OTLP_ENDPOINT || ''
    if (ep) line(ep.startsWith(appUrl) ? PASS : WARN, 'endpoint ' + ep + (ep.startsWith(appUrl) ? '' : ' (does not match ' + appUrl + ')'))

    // 2b. key drift: the key agents send must be the one this device holds.
    settingsKey = O.keyFromHeaders(env.OTEL_EXPORTER_OTLP_HEADERS)
    if (settingsKey && key && settingsKey !== key) {
      line(FAIL, 'settings.json sends key ' + mask(settingsKey) + ' but ~/.tokenfin/config.json holds ' + mask(key) + ' — run `npx tokenfin@latest setup` to re-point it')
    }
  }

  // 2c. MCP registration key
  const mcp = O.readMcpKey()
  if (mcp.registered) {
    if (mcp.key && readKey && mcp.key !== readKey) line(WARN, 'MCP server registered with ' + mask(mcp.key) + ', not this device\'s read key — run `npx tokenfin@latest setup`')
    else line(PASS, 'MCP server registered')
  }

  // 2d. Statusline
  if (settings && settings.statusLine && O.isOurStatusline(settings.statusLine) && !fs.existsSync(O.statuslineScriptPath())) {
    line(FAIL, 'statusLine points at ~/.tokenfin/statusline.js, which is missing — run `npx tokenfin@latest setup --statusline`')
  }

  // 3. Codex CLI — only if the user has it
  const codexP = O.codexConfigPath()
  if (fs.existsSync(codexP)) {
    let toml = ''
    try { toml = fs.readFileSync(codexP, 'utf8') } catch {}
    const managed = O.hasCodexBlock(toml)
    line(managed ? PASS : WARN, managed ? 'Codex — [otel] present in ' + codexP + ' (user-level)' : 'Codex — no TokenFin [otel] block; run `npx tokenfin@latest setup`')
    if (managed) {
      // The exporter is selected by the table header; a `metrics_exporter =
      // "otlp-http"` string next to it is invalid TOML and crashes Codex.
      const hasTable = /\[otel\.metrics_exporter\.otlp-http\]/.test(toml)
      const hasString = /^\s*metrics_exporter\s*=\s*"/m.test(toml)
      line(hasTable ? PASS : FAIL,
        hasTable ? 'Codex — otlp-http metrics exporter (not statsig)' : 'Codex — no otlp-http metrics exporter table; token metrics go to statsig, not TokenFin')
      if (hasTable && hasString) line(FAIL, 'Codex — `metrics_exporter = "…"` string conflicts with the [otel.metrics_exporter.otlp-http] table; Codex will refuse to start. Delete that line.')
      if (key && !toml.includes('Bearer ' + key)) line(FAIL, 'Codex — config.toml sends a different key than this device holds — run `npx tokenfin@latest setup`')
    }
  }

  // 4. Gemini CLI — only if the user has it
  const geminiP = O.geminiSettingsPath()
  if (fs.existsSync(geminiP)) {
    let t = null
    try { t = O.readGeminiSettings().telemetry } catch {}
    const ok = t && t.enabled && typeof t.otlpEndpoint === 'string' && t.otlpEndpoint.includes(appUrl)
    line(ok ? PASS : WARN, ok ? 'Gemini — telemetry configured in ' + geminiP : 'Gemini — telemetry not pointed at TokenFin; run `npx tokenfin@latest setup`')
    if (ok && key && !t.otlpEndpoint.endsWith('key=' + key)) line(FAIL, 'Gemini — settings.json sends a different key than this device holds — run `npx tokenfin@latest setup`')
  }

  // 5. Server-side: is the ingest key the agents use still active?
  const agentKey = settingsKey || key
  if (agentKey) {
    const v = await verifyIngestKey(appUrl, agentKey)
    if (v.ok) line(PASS, 'ingest key active on ' + appUrl)
    else if (v.status === 401) line(FAIL, 'key revoked — run `npx tokenfin@latest login` (agents are sending ' + mask(agentKey) + ', which the server rejects; nothing is being captured)')
    else line(FAIL, 'cannot reach TokenFin — ' + v.why)
  }

  // 6. live events in the last 24h (read key)
  if (!readKey) {
    line(WARN, 'no stored key — run `npx tokenfin@latest login` to check event flow')
  } else {
    const r = await getConnStatus(appUrl, readKey, 'claude_code')
    if (!r.ok) {
      line(FAIL, r.status === 401 ? 'read key revoked — run `npx tokenfin@latest login`' : r.status === 403 ? r.why : 'cannot reach TokenFin — ' + r.why)
    } else {
      const s = r.status || {}
      if (!s.last_event_at) {
        line(WARN, 'no claude_code events yet — run a Claude Code turn, then re-check')
      } else {
        const ageH = (Date.now() - new Date(s.last_event_at).getTime()) / 3600000
        line(ageH <= 24 ? PASS : WARN,
          'last event ' + (ageH < 1 ? Math.round(ageH * 60) + ' min' : ageH.toFixed(1) + ' h') + ' ago' +
          (ageH > 24 ? ' — stale; Claude Code may have been reinstalled or the key rotated' : ''))
      }
    }
  }

  log('')
  if (fails) log(FAIL + ' ' + fails + ' problem(s)' + (warns ? ', ' + warns + ' warning(s)' : '') + ' — fixes above.')
  else if (warns) log(WARN + ' ' + warns + ' warning(s) — see above.')
  else log(PASS + ' all checks passed.')
  return { fails, warns }
}

module.exports = { doctor }
