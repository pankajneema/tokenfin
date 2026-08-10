'use strict'

// Shared OTel config helpers for Claude Code (~/.claude/settings.json `env`).
// One source of truth for the env keys `tokenfin setup` manages, so setup /
// status / doctor / remove all agree on what to write, check, and strip.

const fs = require('fs')
const os = require('os')
const path = require('path')

const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json')

// The env keys we own in settings.json. Anything else there is left untouched.
const MANAGED_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
]

// The env block that points Claude Code's native telemetry at our OTLP receiver.
// http/protobuf + cumulative are deliberate: OTEL defaults to delta, which some
// backends silently drop, and grpc, which our HTTP receiver does not speak.
function otelEnv(otelEndpoint, key) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint,
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + key,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
  }
}

function readClaudeSettings() {
  const p = claudeSettingsPath()
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { throw new Error(p + ' exists but is not valid JSON — fix it, then re-run.') }
}

function writeClaudeSettings(s) {
  const p = claudeSettingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n')
}

function backupClaudeSettings() {
  const p = claudeSettingsPath()
  if (fs.existsSync(p)) { try { fs.copyFileSync(p, p + '.bak-tokenfin') } catch { /* best effort */ } }
}

// ── Codex CLI (~/.codex/config.toml, user-level only) ────────────────────────
// Codex ignores [otel] in project-local .codex/config.toml, and its
// metrics_exporter DEFAULTS TO STATSIG (sends metrics to OpenAI, not us) — so we
// must set it explicitly. We write a marker-delimited block (zero TOML deps);
// re-runs replace it, remove strips it. We refuse to touch a file that already
// has its own [otel] table (two [otel] tables = invalid TOML).
const codexConfigPath = () => path.join(os.homedir(), '.codex', 'config.toml')
const CODEX_START = '# >>> tokenfin (managed) — do not edit inside this block >>>'
const CODEX_END = '# <<< tokenfin <<<'

function codexOtelBlock(otelEndpoint, key) {
  return [
    CODEX_START,
    '[otel]',
    'environment = "prod"',
    'exporter = "none"',
    'log_user_prompt = false',
    '',
    // NOT statsig (Codex's default) — send token metrics to TokenFin. This
    // table header alone is what selects the exporter; a `metrics_exporter =
    // "otlp-http"` string field above conflicts with it (confirmed on a real
    // session 2026-08-10: "cannot extend value of type string with a dotted
    // key" — Codex refuses to even start).
    '[otel.metrics_exporter.otlp-http]',
    `endpoint = "${otelEndpoint}/v1/metrics"`,
    'protocol = "json"',
    '',
    '[otel.metrics_exporter.otlp-http.headers]',
    `Authorization = "Bearer ${key}"`,
    CODEX_END,
  ].join('\n')
}

// Returns { ok, reason } — ok=false when the user already has a non-managed [otel].
function upsertCodexBlock(existing, block) {
  const text = existing || ''
  const start = text.indexOf(CODEX_START)
  if (start !== -1) {
    const end = text.indexOf(CODEX_END, start)
    if (end !== -1) {
      const next = text.slice(0, start) + block + text.slice(end + CODEX_END.length)
      return { ok: true, text: next.replace(/\n{3,}/g, '\n\n') }
    }
  }
  // No managed block yet — refuse if a foreign [otel] table exists.
  if (/^\s*\[otel(\.|\])/m.test(text)) return { ok: false, reason: 'you already have an [otel] section in ~/.codex/config.toml — add the TokenFin keys manually' }
  const sep = text && !text.endsWith('\n') ? '\n\n' : (text ? '\n' : '')
  return { ok: true, text: text + sep + block + '\n' }
}

function stripCodexBlock(text) {
  const start = text.indexOf(CODEX_START)
  if (start === -1) return { text, removed: false }
  const end = text.indexOf(CODEX_END, start)
  if (end === -1) return { text, removed: false }
  return { text: (text.slice(0, start) + text.slice(end + CODEX_END.length)).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''), removed: true }
}

// ── Gemini CLI (~/.gemini/settings.json) ─────────────────────────────────────
// Gemini's telemetry block has no header key, so the ingest key rides on the
// endpoint as ?key= (our receiver accepts it). Merge into existing settings.
const geminiSettingsPath = () => path.join(os.homedir(), '.gemini', 'settings.json')

function geminiTelemetry(otelEndpoint, key) {
  return {
    enabled: true,
    target: 'local',
    useCollector: true,
    otlpProtocol: 'http',
    otlpEndpoint: `${otelEndpoint}?key=${key}`,
    logPrompts: false,
  }
}

function readGeminiSettings() {
  const p = geminiSettingsPath()
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { throw new Error(p + ' exists but is not valid JSON — fix it, then re-run.') }
}
function writeGeminiSettings(s) {
  const p = geminiSettingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n')
}

module.exports = {
  claudeSettingsPath, MANAGED_KEYS, otelEnv, readClaudeSettings, writeClaudeSettings, backupClaudeSettings,
  codexConfigPath, codexOtelBlock, upsertCodexBlock, stripCodexBlock,
  geminiSettingsPath, geminiTelemetry, readGeminiSettings, writeGeminiSettings,
}
