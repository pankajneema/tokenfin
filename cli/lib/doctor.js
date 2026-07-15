'use strict'

// `tokenfin doctor` — find silent data loss before it becomes a wrong invoice.
// Claude-Code-scoped for now; Codex/Gemini checks (statsig default, user-level
// config, `codex exec` no-metrics) arrive with those integrations.

const fs = require('fs')
const { spawnSync } = require('child_process')
const { readConfig } = require('./config')
const {
  MANAGED_KEYS, readClaudeSettings, claudeSettingsPath,
  codexConfigPath, geminiSettingsPath, readGeminiSettings,
} = require('./otel')
const { getConnStatus } = require('./api')
const { DEFAULT_APP_URL } = require('./login')

const log = (m) => process.stdout.write(m + '\n')
const PASS = '✔', WARN = '⚠', FAIL = '✗'

async function doctor(flags = {}) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const key = (flags.key || process.env.TOKENFIN_KEY || cfg.key || '').trim()

  let fails = 0, warns = 0
  const line = (sym, msg) => { if (sym === FAIL) fails++; if (sym === WARN) warns++; log(sym + ' ' + msg) }

  // 1. Claude Code present
  const cc = spawnSync('claude', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
  line(!cc.error && cc.status === 0 ? PASS : WARN,
    !cc.error && cc.status === 0 ? 'Claude Code CLI found' : 'Claude Code CLI not in PATH (install it to send events)')

  // 2. settings.json valid + config complete
  let settings = null
  try { settings = readClaudeSettings() }
  catch (e) { line(FAIL, e.message) }

  if (settings) {
    const env = settings.env || {}
    const missing = MANAGED_KEYS.filter((k) => !env[k])
    line(missing.length ? FAIL : PASS,
      missing.length ? 'OTel config incomplete (missing: ' + missing.join(', ') + ') — run `tokenfin setup`' : 'OTel config present in ' + claudeSettingsPath())

    // 3. protocol
    const proto = env.OTEL_EXPORTER_OTLP_PROTOCOL
    if (proto === 'http/protobuf' || proto === 'http/json') line(PASS, 'protocol ' + proto)
    else if (proto === 'grpc') line(FAIL, 'protocol is grpc — our HTTP receiver needs http/protobuf. Re-run `tokenfin setup`.')
    else if (proto) line(WARN, 'unexpected protocol "' + proto + '"')

    // 4. temporality — OTEL defaults to delta, which some backends drop
    const temp = env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE
    line(temp === 'cumulative' ? PASS : WARN,
      temp === 'cumulative' ? 'metrics temporality cumulative'
        : 'metrics temporality is "' + (temp || 'unset') + '" — delta may be dropped. Re-run `tokenfin setup`.')

    // 5. endpoint
    const ep = env.OTEL_EXPORTER_OTLP_ENDPOINT || ''
    if (ep) line(ep.startsWith(appUrl) ? PASS : WARN, 'endpoint ' + ep + (ep.startsWith(appUrl) ? '' : ' (does not match ' + appUrl + ')'))
  }

  // 5b. Codex CLI — only if the user has it
  const codexP = codexConfigPath()
  if (fs.existsSync(codexP)) {
    let toml = ''
    try { toml = fs.readFileSync(codexP, 'utf8') } catch {}
    const managed = toml.includes('# >>> tokenfin (managed)')
    line(managed ? PASS : WARN, managed ? 'Codex — [otel] present in ~/.codex/config.toml (user-level)' : 'Codex — no TokenFin [otel] block; run `tokenfin setup`')
    if (managed) {
      // The landmine: metrics default to statsig (sent to OpenAI, not us).
      line(/metrics_exporter\s*=\s*"otlp-http"/.test(toml) ? PASS : FAIL,
        /metrics_exporter\s*=\s*"otlp-http"/.test(toml) ? 'Codex — metrics_exporter = otlp-http (not statsig)' : 'Codex — metrics_exporter is NOT otlp-http; token metrics go to statsig, not TokenFin')
    }
    line(WARN, 'Codex — note: `codex exec` and `codex mcp-server` emit no metrics (openai/codex#12913); that usage is invisible')
  }

  // 5c. Gemini CLI — only if the user has it
  const geminiP = geminiSettingsPath()
  if (fs.existsSync(geminiP)) {
    let t = null
    try { t = readGeminiSettings().telemetry } catch {}
    const ok = t && t.enabled && typeof t.otlpEndpoint === 'string' && t.otlpEndpoint.includes(appUrl)
    line(ok ? PASS : WARN, ok ? 'Gemini — telemetry configured in ~/.gemini/settings.json' : 'Gemini — telemetry not pointed at TokenFin; run `tokenfin setup`')
  }

  // 6. live events in the last 24h
  if (!key) {
    line(WARN, 'no stored key — run `tokenfin login` to check event flow')
  } else {
    const r = await getConnStatus(appUrl, key, 'claude_code')
    if (!r.ok) {
      line(FAIL, 'cannot reach TokenFin — ' + r.why)
    } else {
      const s = r.status || {}
      if (!s.last_event_at) {
        line(WARN, 'no claude_code events yet — run a Claude Code turn, then re-check')
      } else {
        const ageH = (Date.now() - new Date(s.last_event_at).getTime()) / 3600000
        line(ageH <= 24 ? PASS : WARN,
          'last event ' + (ageH < 1 ? Math.round(ageH * 60) + ' min' : ageH.toFixed(1) + ' h') + ' ago' +
          (ageH > 24 ? ' — stale; Claude Code may have been reinstalled' : ''))
      }
    }
  }

  log('')
  if (fails) log(FAIL + ' ' + fails + ' problem(s)' + (warns ? ', ' + warns + ' warning(s)' : '') + ' — fixes above.')
  else if (warns) log(WARN + ' ' + warns + ' warning(s) — see above.')
  else log(PASS + ' all checks passed.')
}

module.exports = { doctor }
