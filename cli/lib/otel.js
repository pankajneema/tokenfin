'use strict'

// Shared config helpers for every agent `tokenfin setup` touches. One source
// of truth for what we write, so setup / login / status / doctor / remove all
// agree on what to write, check, and strip. All writes are atomic (fsx).

const fs = require('fs')
const os = require('os')
const path = require('path')
const { writeJsonAtomic, writeFileAtomic, readJsonStrict, backup } = require('./fsx')

// ── Claude Code (~/.claude/settings.json, or $CLAUDE_CONFIG_DIR/settings.json) ─
// Claude Code keeps its home-directory files in $CLAUDE_CONFIG_DIR when set.
const claudeDir = () => (process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()) || path.join(os.homedir(), '.claude')
const claudeSettingsPath = () => path.join(claudeDir(), 'settings.json')
// User-scope MCP servers live in ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json).
const claudeStatePath = () => process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()
  ? path.join(process.env.CLAUDE_CONFIG_DIR.trim(), '.claude.json')
  : path.join(os.homedir(), '.claude.json')

// The env keys we own in settings.json. Anything else there is left untouched.
const MANAGED_KEYS = [
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE',
  'OTEL_LOG_USER_PROMPTS',
  'OTEL_METRICS_INCLUDE_REPOSITORY',
]

// Keys that must be present for usage to flow. The rest of MANAGED_KEYS are
// optional extras (prompt text, repository attribution).
const OPTIONAL_KEYS = ['OTEL_LOG_USER_PROMPTS', 'OTEL_METRICS_INCLUDE_REPOSITORY']
const REQUIRED_KEYS = MANAGED_KEYS.filter((k) => !OPTIONAL_KEYS.includes(k))

// The env block that points Claude Code's native telemetry at our OTLP receiver.
// http/protobuf + cumulative are deliberate: OTEL defaults to delta, which some
// backends silently drop, and grpc, which our HTTP receiver does not speak.
// opts.prompts === false omits OTEL_LOG_USER_PROMPTS (`setup --no-prompts`).
function otelEnv(otelEndpoint, key, opts = {}) {
  const env = {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint,
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + key,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
  }
  // Sends each prompt's TEXT so Prompt Analytics can show it next to the
  // tokens and cost it generated (joined by prompt.id). Opt out: --no-prompts.
  if (opts.prompts !== false) env.OTEL_LOG_USER_PROMPTS = '1'
  // Adds vcs.repository.* (name, owner, url) to every metric/event so cost
  // and productivity can be split per repository (Claude Code v2.1.269+).
  env.OTEL_METRICS_INCLUDE_REPOSITORY = '1'
  return env
}

// Merge our env block into a settings object: strip every managed key first so
// a re-run with --no-prompts actually removes OTEL_LOG_USER_PROMPTS.
function applyOtelEnv(settings, otelEndpoint, key, opts) {
  const env = Object.assign({}, settings.env)
  for (const k of MANAGED_KEYS) delete env[k]
  settings.env = Object.assign(env, otelEnv(otelEndpoint, key, opts))
  return settings
}

// Pull the bearer key back out of an OTEL_EXPORTER_OTLP_HEADERS value.
function keyFromHeaders(h) {
  const m = /Authorization=Bearer\s+([^,\s]+)/i.exec(String(h || ''))
  return m ? m[1] : null
}

const readClaudeSettings = () => readJsonStrict(claudeSettingsPath())
const writeClaudeSettings = (s) => writeJsonAtomic(claudeSettingsPath(), s)
const backupClaudeSettings = () => backup(claudeSettingsPath())

// ── Legacy 0.2 Stop hook ────────────────────────────────────────────────────
// tokenfin 0.2 installed a Claude Code Stop hook running
// `node ~/.tokenfin/record-usage.js`. It double-counts alongside OTel, so
// setup and remove strip it. Shape: hooks.Stop = [{ matcher?, hooks: [{type,
// command}] }] (older flat entries {type, command} handled too).
const LEGACY_HOOK_RE = /record-usage\.js/
const legacyScriptPath = () => path.join(os.homedir(), '.tokenfin', 'record-usage.js')

function stripLegacyHooks(settings) {
  let removed = 0
  const hooks = settings && settings.hooks
  if (!hooks || !Array.isArray(hooks.Stop)) return { settings, removed }
  const isLegacy = (h) => h && typeof h.command === 'string' && LEGACY_HOOK_RE.test(h.command)
  const next = []
  for (const entry of hooks.Stop) {
    if (isLegacy(entry)) { removed++; continue }
    if (entry && Array.isArray(entry.hooks)) {
      const kept = entry.hooks.filter((h) => { if (isLegacy(h)) { removed++; return false } return true })
      if (kept.length === 0 && entry.hooks.length > 0) continue
      next.push(kept.length === entry.hooks.length ? entry : Object.assign({}, entry, { hooks: kept }))
    } else next.push(entry)
  }
  if (!removed) return { settings, removed }
  if (next.length) hooks.Stop = next
  else delete hooks.Stop
  if (Object.keys(hooks).length === 0) delete settings.hooks
  return { settings, removed }
}

function deleteLegacyScript() {
  const p = legacyScriptPath()
  try { if (fs.existsSync(p)) { fs.unlinkSync(p); return true } } catch { /* best effort */ }
  return false
}

// ── Statusline (~/.claude/settings.json statusLine) ─────────────────────────
const statuslineScriptPath = () => path.join(os.homedir(), '.tokenfin', 'statusline.js')
const STATUSLINE_MARK = 'tokenfin'
function statuslineCommand() {
  return 'node "' + statuslineScriptPath().replace(/\\/g, '/') + '"'
}
const isOurStatusline = (sl) => !!(sl && typeof sl.command === 'string' && sl.command.includes('.tokenfin') && sl.command.includes('statusline'))

// ── Codex CLI (~/.codex/config.toml, user-level only) ────────────────────────
// Codex ignores [otel] in project-local .codex/config.toml, and its metrics
// exporter DEFAULTS TO STATSIG (sends metrics to OpenAI, not us). We write a
// marker-delimited block (zero TOML deps); re-runs replace it, remove strips
// it. We refuse to touch a file that already has its own [otel] table.
const codexConfigPath = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml')
const CODEX_START = '# >>> tokenfin (managed) — do not edit inside this block >>>'
const CODEX_END = '# <<< tokenfin <<<'

// The exact TOML body (no markers). The dashboard's Connections page renders
// this same text — keep web/src/app/(dashboard)/dashboard/setup/_client.tsx
// codexToml() byte-identical.
function codexOtelToml(otelEndpoint, key, opts = {}) {
  return [
    '[otel]',
    'environment = "prod"',
    'exporter = "none"',
    'log_user_prompt = ' + (opts.prompts === false ? 'false' : 'true'),
    '',
    // The table header alone selects the otlp-http exporter. A
    // `metrics_exporter = "otlp-http"` string next to it is invalid TOML
    // ("cannot extend value of type string with a dotted key") and Codex
    // refuses to start — never write both.
    '[otel.metrics_exporter.otlp-http]',
    `endpoint = "${otelEndpoint}/v1/metrics"`,
    'protocol = "json"',
    '',
    '[otel.metrics_exporter.otlp-http.headers]',
    `Authorization = "Bearer ${key}"`,
  ].join('\n')
}
function codexOtelBlock(otelEndpoint, key, opts) {
  return [CODEX_START, codexOtelToml(otelEndpoint, key, opts), CODEX_END].join('\n')
}

// Returns { ok, text } or { ok:false, reason } when the user has a non-managed [otel].
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
const hasCodexBlock = (text) => String(text || '').includes(CODEX_START)

// ── Gemini CLI (~/.gemini/settings.json) ─────────────────────────────────────
// Gemini's telemetry block has no header key, so the ingest key rides on the
// endpoint as ?key= (our receiver accepts it). Merge into existing settings.
const geminiSettingsPath = () => path.join(os.homedir(), '.gemini', 'settings.json')

function geminiTelemetry(otelEndpoint, key, opts = {}) {
  return {
    enabled: true,
    target: 'local',
    useCollector: true,
    otlpProtocol: 'http',
    otlpEndpoint: `${otelEndpoint}?key=${key}`,
    logPrompts: opts.prompts !== false,
  }
}
const readGeminiSettings = () => readJsonStrict(geminiSettingsPath())
const writeGeminiSettings = (s) => writeJsonAtomic(geminiSettingsPath(), s)

// ── OpenCode ($XDG_CONFIG_HOME/opencode, default ~/.config/opencode) ─────────
// Capture is TokenFin's own plugin (plugins/opencode/tokenfin.js, bundled here
// as assets/opencode-tokenfin.js — keep them byte-identical). OpenCode 1.x
// auto-loads every {plugin,plugins}/*.{js,ts} in its config dir, so setup just
// copies the file to ~/.config/opencode/plugin/tokenfin.js. The plugin reads
// the key and URL from ~/.tokenfin/config.json — no shell env vars needed.
// The third-party opencode-otel-plugin (drops cache tokens, session ids and
// prompt text) is removed from the `plugin` array so usage isn't counted twice.
const LEGACY_OPENCODE_PLUGIN = 'opencode-otel-plugin'
const OPENCODE_PLUGIN = LEGACY_OPENCODE_PLUGIN   // back-compat export name
const OPENCODE_MARK = 'TokenFin plugin for OpenCode'
const opencodeDir = () => path.join((process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()) || path.join(os.homedir(), '.config'), 'opencode')
// opencode.json, or opencode.jsonc when that is the only one present.
function opencodeConfigPath() {
  const json = path.join(opencodeDir(), 'opencode.json')
  const jsonc = path.join(opencodeDir(), 'opencode.jsonc')
  return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json
}
const opencodePluginPath = () => path.join(opencodeDir(), 'plugin', 'tokenfin.js')
const opencodePluginSource = () => path.join(__dirname, '..', 'assets', 'opencode-tokenfin.js')
const readOpencodeConfig = () => readJsonStrict(opencodeConfigPath())
const writeOpencodeConfig = (s) => writeJsonAtomic(opencodeConfigPath(), s)

const pluginName = (p) => (Array.isArray(p) ? p[0] : p)
// "opencode-otel-plugin", "opencode-otel-plugin@1.2.3", "…@latest" (+ [name, opts] tuples).
const isLegacyOpencodePlugin = (p) => {
  const n = pluginName(p)
  return typeof n === 'string' && (n === LEGACY_OPENCODE_PLUGIN || n.startsWith(LEGACY_OPENCODE_PLUGIN + '@'))
}
function stripOpencodePlugin(plugin) {
  return Array.isArray(plugin) ? plugin.filter((p) => !isLegacyOpencodePlugin(p)) : plugin
}
const hasLegacyOpencodePlugin = (plugin) => Array.isArray(plugin) && plugin.some(isLegacyOpencodePlugin)

const pluginVersionOf = (text) => { const m = /const VERSION = '([^']+)'/.exec(String(text || '')); return m ? m[1] : null }
const isOurOpencodePlugin = (text) => String(text || '').includes(OPENCODE_MARK)

// Copy the bundled plugin into OpenCode's plugin dir. Returns { changed, version }.
function installOpencodePlugin() {
  const src = fs.readFileSync(opencodePluginSource())
  const dest = opencodePluginPath()
  let cur = null
  try { cur = fs.readFileSync(dest) } catch {}
  if (cur && !isOurOpencodePlugin(cur)) throw new Error(dest + ' exists and is not the TokenFin plugin — left it alone')
  const changed = !cur || !cur.equals(src)
  if (changed) writeFileAtomic(dest, src)
  return { changed, version: pluginVersionOf(src) }
}

// Installed plugin state for doctor: { installed, ours, version, current }.
function opencodePluginStatus() {
  let text = null
  try { text = fs.readFileSync(opencodePluginPath(), 'utf8') } catch {}
  if (text == null) return { installed: false }
  let bundled = null
  try { bundled = fs.readFileSync(opencodePluginSource(), 'utf8') } catch {}
  return { installed: true, ours: isOurOpencodePlugin(text), version: pluginVersionOf(text), current: bundled == null || text === bundled }
}

// Delete the installed plugin (only if it is ours). Returns true when removed.
function uninstallOpencodePlugin() {
  const p = opencodePluginPath()
  try {
    if (!fs.existsSync(p) || !isOurOpencodePlugin(fs.readFileSync(p, 'utf8'))) return false
    fs.unlinkSync(p)
    try { if (fs.readdirSync(path.dirname(p)).length === 0) fs.rmdirSync(path.dirname(p)) } catch {}
    return true
  } catch { return false }
}

// Read the key in the user-scope `tokenfin` MCP registration (read-only peek
// at ~/.claude.json; we never write that file — `claude mcp` owns it).
function readMcpKey() {
  try {
    const j = JSON.parse(fs.readFileSync(claudeStatePath(), 'utf8'))
    const srv = j && j.mcpServers && j.mcpServers.tokenfin
    if (!srv) return { registered: false, key: null }
    const h = (srv.headers && (srv.headers.Authorization || srv.headers.authorization)) || ''
    const m = /Bearer\s+(\S+)/i.exec(h)
    return { registered: true, key: m ? m[1] : null, url: srv.url || null }
  } catch { return { registered: false, key: null } }
}

module.exports = {
  claudeDir, claudeSettingsPath, claudeStatePath, MANAGED_KEYS, REQUIRED_KEYS, OPTIONAL_KEYS,
  otelEnv, applyOtelEnv, keyFromHeaders, readClaudeSettings, writeClaudeSettings, backupClaudeSettings,
  LEGACY_HOOK_RE, legacyScriptPath, stripLegacyHooks, deleteLegacyScript,
  statuslineScriptPath, statuslineCommand, isOurStatusline, STATUSLINE_MARK,
  codexConfigPath, codexOtelToml, codexOtelBlock, upsertCodexBlock, stripCodexBlock, hasCodexBlock,
  geminiSettingsPath, geminiTelemetry, readGeminiSettings, writeGeminiSettings,
  OPENCODE_PLUGIN, LEGACY_OPENCODE_PLUGIN, opencodeDir, opencodeConfigPath, opencodePluginPath, opencodePluginSource,
  readOpencodeConfig, writeOpencodeConfig, stripOpencodePlugin, hasLegacyOpencodePlugin, isLegacyOpencodePlugin,
  installOpencodePlugin, uninstallOpencodePlugin, opencodePluginStatus, isOurOpencodePlugin, pluginVersionOf,
  readMcpKey,
}
