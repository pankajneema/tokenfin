'use strict'

// `tokenfin config push | pull | show` — the machine side of Dashboard → Agents.
//
// push  Read each installed agent's USER-level config, REDACT IT HERE (before
//       anything leaves the machine), and upload one snapshot per agent to
//       POST /api/v1/agent-configs. Also runs quietly at the end of `setup` and
//       during `status` / `doctor`.
// pull  Fetch change requests made in the dashboard (pending, allow-listed
//       JSON merge patches), show the diff, ask (or --yes), back up the file,
//       write it atomically, push the new snapshot and report applied / failed.
//       Nothing is ever applied remotely: the server only stores requests.
// show  Print the redacted snapshot that `push` would send (nothing is sent).
//
// Zero runtime dependencies. See docs/AGENTS_CONFIG.md.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const O = require('./otel')
const H = require('./hooks')
const { parseToml } = require('./toml')
const { readConfig, readKeyOf, ensureDeviceId, dir: tfDir } = require('./config')
const { writeFileAtomic, writeJsonAtomic, backup } = require('./fsx')
const { request } = require('./api')
const { resolveCommand } = require('./proc')

const log = (m) => process.stdout.write(m + '\n')
const DEFAULT_APP_URL = 'https://tokenfin.curiousdevs.com'

// ── Redaction (keep in sync with web/src/lib/agent-configs/redact.ts) ────────
const REDACTED = '[redacted]'
const SENSITIVE_KEY = /key|token|secret|passw(or)?d|auth|credential|bearer|cookie/i
const HEADER_KEYS = /^(otel_exporter_otlp(_[a-z]+)?_headers|headers|http_headers|env_http_headers)$/i
const TOKEN_RES = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
  /\btfk_[A-Za-z0-9_]{6,}/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
]
const AUTH_SCHEME = /\b(Bearer|Basic)\s+(?!\[redacted\])[^\s,;"']{6,}/gi
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi
const QUERY_SECRET = /([?&](?:[a-z0-9_-]*(?:key|token|secret|password|auth|sig|signature)[a-z0-9_-]*)=)[^&#\s"']+/gi
const LONG_RUN = /[A-Za-z0-9+_=-]{32,}/g
function highEntropy(run) {
  if (/^[0-9a-f]{32,}$/i.test(run)) return true
  if (run.length < 32) return false
  return [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(run)).length === 3
}
function redactString(s) {
  let out = String(s)
  for (const re of TOKEN_RES) out = out.replace(re, REDACTED)
  out = out.replace(AUTH_SCHEME, (_m, scheme) => scheme + ' ' + REDACTED)
  out = out.replace(URL_PASSWORD, (_m, pre) => pre + ':' + REDACTED + '@')
  out = out.replace(QUERY_SECRET, (_m, pre) => pre + REDACTED)
  out = out.replace(LONG_RUN, (m) => (highEntropy(m.replace(/=+$/, '')) ? REDACTED : m))
  return out
}
function redactAll(v) {
  if (typeof v === 'string') return v ? REDACTED : v
  if (Array.isArray(v)) return v.map(redactAll)
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = redactAll(v[k]); return o }
  return v
}
function redactConfig(value, depth = 0) {
  if (depth > 40) return REDACTED
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((v) => redactConfig(v, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) {
      out[k] = HEADER_KEYS.test(k) || SENSITIVE_KEY.test(k) ? redactAll(value[k]) : redactConfig(value[k], depth + 1)
    }
    return out
  }
  return value
}

// ── Allow-list (keep identical to web/src/lib/agent-configs/allowlist.ts) ────
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,119}$/
const RULE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,80}(\([^\n\r\0]{0,300}\))?$/
const PATH_RE = /^[^\n\r\0]{1,500}$/
const OC_ACTIONS = ['ask', 'allow', 'deny']
const CLAUDE_MODES = ['default', 'acceptEdits', 'plan']
const HOOK_TEMPLATES = ['tokenfin-session']
const strList = (v, re, max) => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && re.test(x)) && new Set(v).size === v.length
const CHECK = {
  model: (v) => v === null || (typeof v === 'string' && MODEL_RE.test(v)),
  bool: (v) => typeof v === 'boolean',
  flag: (v) => v === true,
  prompt_env: (v) => v === '1' || v === null,
  mode: (v) => v === null || CLAUDE_MODES.includes(v),
  rules: (v) => v === null || strList(v, RULE_RE, 500),
  dirs: (v) => v === null || strList(v, PATH_RE, 100),
  oc_action: (v) => v === null || OC_ACTIONS.includes(v),
  oc_bash: (v) => v === null || OC_ACTIONS.includes(v) || (!!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length <= 500 && Object.entries(v).every(([k, a]) => k.length > 0 && k.length <= 300 && !/[\n\r\0]/.test(k) && OC_ACTIONS.includes(a))),
  hook_ops: (v) => Array.isArray(v) && v.length > 0 && v.length <= 50 && v.every((o) => {
    if (!o || typeof o !== 'object') return false
    const keys = Object.keys(o).sort().join(',')
    if (['disable', 'enable', 'delete'].includes(o.op)) return keys === 'id,op' && /^[0-9a-f]{12}$/.test(o.id)
    if (o.op === 'add_template') return keys === 'op,template' && HOOK_TEMPLATES.includes(o.template)
    return false
  }),
}
const ALLOW = {
  claude_code: { model: 'model', 'env.OTEL_LOG_USER_PROMPTS': 'prompt_env', 'permissions.defaultMode': 'mode', '$tokenfin.statusline': 'bool',
    'permissions.allow': 'rules', 'permissions.ask': 'rules', 'permissions.deny': 'rules', 'permissions.additionalDirectories': 'dirs',
    '$tokenfin.hooks': 'hook_ops', '$tokenfin.repair': 'flag' },
  opencode: { model: 'model', small_model: 'model', '$tokenfin.plugin': 'bool', 'permission.edit': 'oc_action', 'permission.webfetch': 'oc_action',
    'permission.bash': 'oc_bash', '$tokenfin.repair': 'flag' },
  codex_cli: { model: 'model', 'otel.log_user_prompt': 'bool', '$tokenfin.repair': 'flag' },
  gemini_cli: { 'model.name': 'model', 'telemetry.logPrompts': 'bool', '$tokenfin.repair': 'flag' },
}
// Replaced whole, never descended / merged.
const ATOMIC = new Set(['permissions.allow', 'permissions.ask', 'permissions.deny', 'permissions.additionalDirectories', 'permission.bash'])
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function flattenPatch(patch, prefix = '') {
  const out = []
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    const p = prefix ? prefix + '.' + k : k
    if (isPlain(v) && Object.keys(v).length > 0 && !ATOMIC.has(p)) out.push(...flattenPatch(v, p))
    else out.push({ path: p, value: v })
  }
  return out
}

function validatePatch(agent, patch) {
  const allow = ALLOW[agent]
  if (!allow) return { ok: false, errors: ['unknown agent ' + agent] }
  if (!isPlain(patch)) return { ok: false, errors: ['patch must be a JSON object'] }
  if (JSON.stringify(patch).length > 4096) return { ok: false, errors: ['patch too large'] }
  const leaves = flattenPatch(patch)
  if (!leaves.length) return { ok: false, errors: ['patch is empty'] }
  const errors = []
  for (const { path: p, value } of leaves) {
    const kind = allow[p]
    if (!kind) errors.push(p + ': not an editable field')
    else if (!CHECK[kind](value)) errors.push(p + ': invalid value')
  }
  return errors.length ? { ok: false, errors } : { ok: true, fields: leaves }
}

function setPath(obj, p, value) {
  const parts = p.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlain(cur[parts[i]])) {
      if (value === null) return
      cur[parts[i]] = {}
    }
    cur = cur[parts[i]]
  }
  const last = parts[parts.length - 1]
  if (value === null) delete cur[last]
  else cur[last] = value
}

// ── Agents on this machine ───────────────────────────────────────────────────
const AGENTS = ['claude_code', 'opencode', 'codex_cli', 'gemini_cli']
const LABEL = { claude_code: 'Claude Code', opencode: 'OpenCode', codex_cli: 'Codex CLI', gemini_cli: 'Gemini CLI' }
const BIN = { claude_code: 'claude', opencode: 'opencode', codex_cli: 'codex', gemini_cli: 'gemini' }
const geminiDir = () => path.dirname(O.geminiSettingsPath())
const present = {
  claude_code: () => fs.existsSync(O.claudeDir()) || fs.existsSync(O.claudeSettingsPath()),
  opencode: () => fs.existsSync(O.opencodeDir()),
  codex_cli: () => fs.existsSync(path.dirname(O.codexConfigPath())),
  gemini_cli: () => fs.existsSync(geminiDir()),
}
const mainFile = {
  claude_code: () => O.claudeSettingsPath(),
  opencode: () => O.opencodeConfigPath(),
  codex_cli: () => O.codexConfigPath(),
  gemini_cli: () => O.geminiSettingsPath(),
}

// ~/.tokenfin/agent-state.json — versions cache, restart markers, pending count.
const statePath = () => path.join(tfDir(), 'agent-state.json')
function readState() { try { const j = JSON.parse(fs.readFileSync(statePath(), 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} } }
function writeState(s) { try { writeJsonAtomic(statePath(), s, { mode: 0o600 }) } catch { /* best effort */ } }

const VERSION_TTL_MS = 12 * 3600 * 1000
function agentVersion(agent, state) {
  const cached = state.versions && state.versions[agent]
  if (cached && Date.now() - (cached.at || 0) < VERSION_TTL_MS) return cached.v || null
  let v = null
  try {
    const r = resolveCommand(BIN[agent])
    if (r && !r.shim) {
      const out = spawnSync(r.cmd, ['--version'], { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      const m = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(String(out.stdout || ''))
      if (!out.error && out.status === 0 && m) v = m[0]
    }
  } catch { /* skipped */ }
  state.versions = Object.assign({}, state.versions, { [agent]: { v, at: Date.now() } })
  return v
}

function mtimeOf(file) { try { return fs.statSync(file).mtime.toISOString() } catch { return null } }

// JSONC → JSON for READING only (comments + trailing commas outside strings).
function stripJsonc(text) {
  let out = '', i = 0, inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) { out += c; if (c === '\\') { out += text[i + 1] || ''; i += 2; continue } if (c === '"') inStr = false; i++; continue }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 2; continue }
    out += c; i++
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}
function readJsonLoose(file) {
  if (!fs.existsSync(file)) return { value: {}, exists: false }
  const text = fs.readFileSync(file, 'utf8')
  if (!text.trim()) return { value: {}, exists: true }
  try { return { value: JSON.parse(text), exists: true } } catch {}
  try { return { value: JSON.parse(stripJsonc(text)), exists: true, jsonc: true } } catch { return { value: {}, exists: true, error: 'not valid JSON' } }
}
function listDir(d) { try { return fs.readdirSync(d).filter((f) => !f.startsWith('.')).sort() } catch { return [] } }

function rawConfig(agent) {
  const cfg = readConfig()
  if (agent === 'claude_code') {
    const r = readJsonLoose(O.claudeSettingsPath())
    const settings = isPlain(r.value) ? r.value : {}
    let mcp = []
    try {
      const st = JSON.parse(fs.readFileSync(O.claudeStatePath(), 'utf8'))
      mcp = Object.entries((st && st.mcpServers) || {}).map(([name, s]) => ({
        name, type: (s && s.type) || (s && s.url ? 'http' : 'stdio'),
        ...(s && s.url ? { url: s.url } : {}), ...(s && s.command ? { command: s.command } : {}),
      }))
    } catch { /* no ~/.claude.json */ }
    return {
      settings, mcp_servers: mcp, statusline_script: fs.existsSync(O.statuslineScriptPath()),
      hooks_index: H.hooksIndex(settings, H.readDisabled()),
      ...(r.error ? { parse_error: r.error } : {}),
    }
  }
  if (agent === 'opencode') {
    const r = readJsonLoose(O.opencodeConfigPath())
    const st = O.opencodePluginStatus()
    return {
      settings: isPlain(r.value) ? r.value : {},
      plugin_dir: [...listDir(path.join(O.opencodeDir(), 'plugin')), ...listDir(path.join(O.opencodeDir(), 'plugins'))],
      tokenfin_plugin: { installed: !!st.installed, ours: st.ours !== false, version: st.version || null, current: st.current !== false },
      tokenfin_app_url: cfg.appUrl || null, tokenfin_key_present: !!(cfg.key || process.env.TOKENFIN_API_KEY),
      ...(r.error ? { parse_error: r.error } : {}),
    }
  }
  if (agent === 'codex_cli') {
    const p = O.codexConfigPath()
    let text = ''
    try { text = fs.readFileSync(p, 'utf8') } catch {}
    try { return { settings: parseToml(text), tokenfin_block: O.hasCodexBlock(text) } }
    catch (e) { return { settings: {}, tokenfin_block: O.hasCodexBlock(text), parse_error: e.message } }
  }
  const r = readJsonLoose(O.geminiSettingsPath())
  return { settings: isPlain(r.value) ? r.value : {}, ...(r.error ? { parse_error: r.error } : {}) }
}

// ── "Restart needed" ─────────────────────────────────────────────────────────
const PROC_RE = {
  claude_code: /(^|[/\s])claude(\s|$)/, opencode: /(^|[/\s])opencode(\s|$)/,
  codex_cli: /(^|[/\s])codex(\s|$)/, gemini_cli: /(^|[/\s])gemini(\s|$)/,
}
// Start times of running agent processes, or null when unknown (Windows / ps failed).
function agentProcessStarts() {
  if (process.platform === 'win32' || process.env.TOKENFIN_NO_PS === '1') return null
  const r = spawnSync('ps', ['-axo', 'lstart=,args='], { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.error || r.status !== 0) return null
  const out = {}
  for (const line of String(r.stdout || '').split('\n')) {
    const t = Date.parse(line.slice(0, 24))
    if (!Number.isFinite(t)) continue
    const args = line.slice(24).trim()
    for (const a of AGENTS) if (PROC_RE[a].test(args)) (out[a] = out[a] || []).push(t)
  }
  return out
}
// Keep a marker only while a process that started BEFORE the change still runs.
function refreshRestartMarkers(state, clearUnknown) {
  const markers = state.restart || {}
  if (!Object.keys(markers).length) return markers
  const starts = agentProcessStarts()
  for (const a of Object.keys(markers)) {
    if (!starts) { if (clearUnknown) delete markers[a]; continue }
    const since = Date.parse(markers[a])
    if (!(starts[a] || []).some((t) => t < since)) delete markers[a]
  }
  state.restart = markers
  return markers
}

// ── Collect ──────────────────────────────────────────────────────────────────
function collect(opts = {}) {
  const state = readState()
  const markers = refreshRestartMarkers(state, !!opts.clearUnknownRestart)
  const agents = []
  for (const a of AGENTS) {
    if (!present[a]()) continue
    const file = mainFile[a]()
    const config = redactConfig(rawConfig(a))
    agents.push({
      agent: a, version: opts.noVersions ? null : agentVersion(a, state), path: file, mtime: mtimeOf(file),
      config, sha256: crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex'),
      needs_restart_since: markers[a] || null,
    })
  }
  writeState(state)
  const pkg = require('../package.json')
  return {
    device_id: ensureDeviceId(), hostname: os.hostname(), os: os.platform() + ' ' + os.release(),
    cli_version: pkg.version, agents,
  }
}

function resolve(flags) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const key = String(flags.key || process.env.TOKENFIN_KEY || readKeyOf(cfg) || '').trim()
  return { cfg, appUrl, key }
}

// Returns { ok, pending, status, why }.
async function push(flags = {}, opts = {}) {
  const { appUrl, key } = resolve(flags)
  if (!key) return { ok: false, why: 'no key — run `npx tokenfin@latest login`' }
  const body = collect(opts)
  const r = await request('POST', appUrl + '/api/v1/agent-configs', key, body)
  if (!r.ok) {
    const why = r.status === 401 ? 'key revoked or invalid (401)' : r.status === 404 ? 'this TokenFin server has no Agents endpoint yet' :
      r.status === 403 ? ((r.json && r.json.error) || 'forbidden (403)') : (r.why || 'HTTP ' + r.status + (r.json && r.json.error ? ': ' + r.json.error : ''))
    return { ok: false, status: r.status, why, body }
  }
  const pending = Number((r.json && r.json.pending) || 0)
  const state = readState()
  state.pending = pending
  state.pending_at = Date.now()
  writeState(state)
  return { ok: true, pending, body }
}

// ── Pull: plan + apply one change ────────────────────────────────────────────
function jsonDiff(a, b, prefix = '') {
  if (isPlain(a) && isPlain(b)) {
    const out = []
    for (const k of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
      const p = prefix ? prefix + '.' + k : k
      if (!(k in a)) out.push({ p, kind: '+', after: b[k] })
      else if (!(k in b)) out.push({ p, kind: '-', before: a[k] })
      else out.push(...jsonDiff(a[k], b[k], p))
    }
    return out
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ p: prefix || '(root)', kind: '~', before: a, after: b }]
}
function shown(p, v) {
  if (v === undefined) return '—'
  const last = p.split('.').pop()
  if (SENSITIVE_KEY.test(last) || HEADER_KEYS.test(last)) return JSON.stringify(REDACTED)
  const s = JSON.stringify(redactConfig(v))
  return s.length > 160 ? s.slice(0, 157) + '…' : s
}
function formatJsonDiff(d) {
  return d.map((e) => e.kind === '+' ? '  + ' + e.p + ' = ' + shown(e.p, e.after)
    : e.kind === '-' ? '  - ' + e.p + ' (was ' + shown(e.p, e.before) + ')'
    : '  ~ ' + e.p + ': ' + shown(e.p, e.before) + ' → ' + shown(e.p, e.after))
}
function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n')
  if (x.length * y.length > 4e6) return ['  (file too large to diff)']
  const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  let i = 0, j = 0
  const safe = (l) => /^\s*[^=#]*(key|token|secret|auth|password|bearer)[^=]*=/i.test(l) ? l.replace(/=.*/, '= "' + REDACTED + '"') : redactString(l)
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++ }
    else if (j < y.length && (i >= x.length || L[i][j + 1] >= L[i + 1][j])) out.push('  + ' + safe(y[j++]))
    else out.push('  - ' + safe(x[i++]))
  }
  return out
}

// TOML targeted edits (Codex). Values are validated by the allow-list first.
const TOML_HEADER = /^\s*\[/
function setTomlTopLevel(text, key, value) {
  const lines = text.split('\n')
  const firstTable = lines.findIndex((l) => TOML_HEADER.test(l))
  const end = firstTable === -1 ? lines.length : firstTable
  const re = new RegExp('^\\s*' + key + '\\s*=')
  const idx = lines.slice(0, end).findIndex((l) => re.test(l))
  const line = value === null ? null : key + ' = ' + JSON.stringify(value)
  if (idx !== -1) { if (line === null) lines.splice(idx, 1); else lines[idx] = line }
  else if (line !== null) lines.unshift(line)
  return lines.join('\n')
}
function setTomlInTable(text, table, key, value) {
  const lines = text.split('\n')
  const h = lines.findIndex((l) => new RegExp('^\\s*\\[' + table.replace(/\./g, '\\.') + '\\]\\s*(#.*)?$').test(l))
  if (h === -1) throw new Error('config.toml has no [' + table + '] table — request "Repair connection" first')
  let end = lines.length
  for (let i = h + 1; i < lines.length; i++) if (TOML_HEADER.test(lines[i])) { end = i; break }
  const re = new RegExp('^\\s*' + key + '\\s*=')
  const idx = lines.slice(h + 1, end).findIndex((l) => re.test(l))
  const line = key + ' = ' + JSON.stringify(value)
  if (idx !== -1) lines[h + 1 + idx] = line
  else lines.splice(h + 1, 0, line)
  return lines.join('\n')
}

// Build the plan for one change without touching the disk.
// → { agent, file, before, after, diff: [lines], notes: [lines], effects: [fn], restart }
function planChange(change, cfg) {
  const agent = change.agent
  const check = validatePatch(agent, change.patch)
  if (!check.ok) throw new Error('refused by the CLI allow-list: ' + check.errors.join('; '))
  const leaves = check.fields
  const virtual = Object.fromEntries(leaves.filter((f) => f.path.startsWith('$tokenfin.')).map((f) => [f.path.slice(10), f.value]))
  const real = leaves.filter((f) => !f.path.startsWith('$tokenfin.'))
  const endpoint = String(cfg.appUrl || '').replace(/\/$/, '') + '/api/otel'
  const needKey = () => { if (!cfg.key || !cfg.appUrl) throw new Error('this device has no stored ingest key / app URL — run `npx tokenfin@latest login`'); return cfg.key }
  const opts = { prompts: cfg.prompts !== false }
  const file = mainFile[agent]()
  const notes = [], effects = []

  if (agent === 'codex_cli') {
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    let after = before
    if (virtual.repair) {
      const res = O.upsertCodexBlock(after, O.codexOtelBlock(endpoint, needKey(), opts))
      if (!res.ok) throw new Error(res.reason)
      after = res.text
      notes.push('rewrite the TokenFin [otel] block (endpoint ' + endpoint + ', this device\'s key)')
    }
    for (const f of real) {
      if (f.path === 'model') after = setTomlTopLevel(after, 'model', f.value)
      else if (f.path === 'otel.log_user_prompt') after = setTomlInTable(after, 'otel', 'log_user_prompt', f.value)
    }
    const parsed = parseToml(after) // throws → the change fails, nothing written
    for (const f of real) {
      const got = f.path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), parsed)
      if ((f.value === null ? undefined : f.value) !== got) throw new Error('could not set ' + f.path + ' in config.toml safely')
    }
    return { agent, file, before, after, diff: lineDiff(before, after), notes, effects }
  }

  // JSON files
  const r = readJsonLoose(file)
  if (r.error) throw new Error(file + ' is not valid JSON — fix it by hand first')
  if (r.jsonc) throw new Error(file + ' contains comments — TokenFin will not rewrite it; edit it by hand')
  const beforeObj = isPlain(r.value) ? r.value : {}
  const s = JSON.parse(JSON.stringify(beforeObj))
  for (const f of real) {
    if (agent === 'opencode' && f.path.startsWith('permission.') && typeof s.permission === 'string') {
      notes.push('permission was "' + s.permission + '" for everything — converting it to per-tool settings')
      s.permission = {}
    }
    setPath(s, f.path, f.value)
  }

  if (agent === 'claude_code') {
    if (virtual.repair) {
      O.applyOtelEnv(s, endpoint, needKey(), opts)
      const { removed } = O.stripLegacyHooks(s)
      notes.push('rewrite the OpenTelemetry env block (endpoint ' + endpoint + ', this device\'s key)' + (removed ? ' and remove the legacy 0.2 hook' : ''))
    }
    if (virtual.statusline === true) {
      if (s.statusLine && !O.isOurStatusline(s.statusLine)) throw new Error('a custom statusLine is configured — TokenFin will not replace it')
      s.statusLine = { type: 'command', command: O.statuslineCommand(), padding: 0 }
      effects.push(() => writeFileAtomic(O.statuslineScriptPath(), fs.readFileSync(path.join(__dirname, 'statusline.js'))))
      notes.push('install ' + O.statuslineScriptPath())
    } else if (virtual.statusline === false) {
      if (O.isOurStatusline(s.statusLine)) delete s.statusLine
      else notes.push('no TokenFin status line to remove')
    }
    if (virtual.hooks) {
      const res = H.applyHookOps(s, H.readDisabled(), virtual.hooks)
      notes.push(...res.notes)
      effects.push(() => H.writeDisabled(res.disabled))
      if (res.sessionScript) effects.push(() => H.installSessionScript())
    }
  } else if (agent === 'opencode') {
    if (virtual.repair || virtual.plugin === true) {
      effects.push(() => O.installOpencodePlugin())
      notes.push('install / update ' + O.opencodePluginPath())
      if (O.hasLegacyOpencodePlugin(s.plugin)) { s.plugin = O.stripOpencodePlugin(s.plugin); notes.push('remove ' + O.LEGACY_OPENCODE_PLUGIN + ' from the plugin list') }
    } else if (virtual.plugin === false) {
      effects.push(() => O.uninstallOpencodePlugin())
      notes.push('remove ' + O.opencodePluginPath())
    }
  } else if (agent === 'gemini_cli') {
    if (virtual.repair) {
      s.telemetry = O.geminiTelemetry(endpoint, needKey(), opts)
      notes.push('rewrite the telemetry block (endpoint ' + endpoint + ', this device\'s key)')
    }
  }
  const changed = JSON.stringify(s) !== JSON.stringify(beforeObj)
  const before = r.exists ? fs.readFileSync(file, 'utf8') : ''
  const after = changed ? JSON.stringify(s, null, 2) + '\n' : before
  return { agent, file, before, after, diff: formatJsonDiff(jsonDiff(beforeObj, s)), notes, effects }
}

// `backedUp` (per pull run): back a file up only before its FIRST change, so
// .bak-tokenfin always holds the pre-pull original even after several changes.
function applyPlan(plan, backedUp = new Set()) {
  if (plan.after !== plan.before) {
    if (!backedUp.has(plan.file)) { backup(plan.file); backedUp.add(plan.file) }
    writeFileAtomic(plan.file, plan.after)
  }
  for (const fx of plan.effects) fx()
}

async function ask(q) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(/^y(es)?$/i.test(String(a).trim())) }))
}

async function report(appUrl, key, id, status, error) {
  const r = await request('PATCH', appUrl + '/api/v1/agent-configs/changes', key, { id, status, ...(error ? { error: String(error).slice(0, 1000) } : {}) })
  return r.ok
}

async function pull(flags = {}) {
  const { cfg, appUrl, key } = resolve(flags)
  if (!key) throw new Error('no key — run `npx tokenfin@latest login`')
  const deviceId = ensureDeviceId()
  const r = await request('GET', appUrl + '/api/v1/agent-configs/changes?device_id=' + encodeURIComponent(deviceId), key)
  if (r.status === 404) throw new Error('this TokenFin server has no Agents endpoint yet')
  if (!r.ok) throw new Error(r.status === 401 ? 'key revoked or invalid (401) — run `npx tokenfin@latest login`' : (r.why || 'HTTP ' + r.status))
  const changes = (r.json && r.json.changes) || []
  if (!changes.length) { log('✔ no pending config changes for this machine'); return { applied: 0, failed: 0, skipped: 0 } }

  const interactive = process.stdin.isTTY && !flags.yes
  let applied = 0, failed = 0, skipped = 0
  const restart = new Set()
  const backedUp = new Set()
  for (const ch of changes) {
    const who = ch.requested_by_email || 'the dashboard'
    log('\n── ' + (LABEL[ch.agent] || ch.agent) + ' · change ' + String(ch.id).slice(0, 8) + ' · requested by ' + who)
    if (ch.reason) log('   reason: ' + ch.reason)
    let plan
    try { plan = planChange(ch, cfg) }
    catch (e) {
      log('✗ ' + e.message)
      await report(appUrl, key, ch.id, 'failed', e.message); failed++
      continue
    }
    log('   file: ' + plan.file)
    for (const n of plan.notes) log('   • ' + n)
    if (plan.diff.length) { for (const l of plan.diff) log(l) } else log('   (no change to the file itself)')
    if (plan.after === plan.before && !plan.effects.length) {
      log('· already in the requested state')
      await report(appUrl, key, ch.id, 'applied'); applied++
      continue
    }
    let ok = !!flags.yes
    if (!ok && interactive) ok = await ask('Apply this change? [y/N] ')
    if (!ok) {
      log(interactive ? '· skipped — it stays pending' : '· not applied — run `npx tokenfin@latest config pull` in a terminal to review it, or add --yes')
      skipped++
      continue
    }
    try {
      applyPlan(plan, backedUp)
      await report(appUrl, key, ch.id, 'applied')
      log('✔ applied' + (plan.after !== plan.before ? ' (backup: ' + plan.file + '.bak-tokenfin)' : ''))
      applied++
      restart.add(ch.agent)
    } catch (e) {
      log('✗ ' + e.message)
      await report(appUrl, key, ch.id, 'failed', e.message); failed++
    }
  }

  if (restart.size) {
    const state = readState()
    const now = new Date().toISOString()
    state.restart = Object.assign({}, state.restart)
    for (const a of restart) state.restart[a] = now
    writeState(state)
    log('')
    for (const a of restart) log('↻ Restart ' + LABEL[a] + ' to apply — it reads its config only at start.')
  }
  const p = await push(flags, { clearUnknownRestart: false })
  if (!p.ok) log('· could not upload the new snapshot: ' + p.why)
  log('\n' + applied + ' applied · ' + failed + ' failed · ' + skipped + ' skipped')
  if (failed) process.exitCode = 1
  return { applied, failed, skipped }
}

// Quiet sync for setup / status / doctor: never throws, prints at most one line.
async function autoSync(flags = {}, opts = {}) {
  try {
    const r = await push(flags, { clearUnknownRestart: true })
    if (r.ok && r.pending > 0) {
      log('ℹ ' + r.pending + ' config change' + (r.pending === 1 ? '' : 's') + ' requested from the dashboard — review with `npx tokenfin@latest config pull`')
    } else if (!r.ok && opts.verbose && r.status !== 404) log('· agent config not synced: ' + r.why)
    return r
  } catch (e) { return { ok: false, why: e.message } }
}

async function configCmd(args, flags = {}) {
  const sub = args[1] || 'push'
  if (sub === 'show') { log(JSON.stringify(collect(), null, 2)); return 0 }
  if (sub === 'pull') { await pull(flags); return process.exitCode || 0 }
  if (sub === 'push') {
    const r = await push(flags, { clearUnknownRestart: true })
    if (!r.ok) { log('✗ config push failed — ' + r.why); return 1 }
    const names = r.body.agents.map((a) => LABEL[a.agent]).join(', ') || 'no supported agent found'
    log('✔ uploaded redacted config for ' + names + ' (device ' + r.body.hostname + ')')
    if (r.pending) log('ℹ ' + r.pending + ' pending change' + (r.pending === 1 ? '' : 's') + ' — run `npx tokenfin@latest config pull`')
    return 0
  }
  log('usage: tokenfin config push | pull [--yes] | show')
  return 1
}

module.exports = {
  REDACTED, redactString, redactConfig, validatePatch, flattenPatch, setPath, ALLOW, ATOMIC,
  parseToml, stripJsonc, collect, push, pull, autoSync, configCmd, planChange, applyPlan,
  setTomlTopLevel, setTomlInTable, lineDiff, jsonDiff, readState, statePath, refreshRestartMarkers, agentProcessStarts,
}
