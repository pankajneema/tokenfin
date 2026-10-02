'use strict'

// Unit tests (node:test, zero deps). Every test runs against a throwaway HOME
// so nothing touches the real ~/.claude or ~/.tokenfin.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfin-unit-'))
process.env.HOME = TMP
process.env.USERPROFILE = TMP
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.CODEX_HOME
delete process.env.XDG_CONFIG_HOME   // GitHub runners set it; OpenCode paths must follow the temp HOME
delete process.env.CI

const O = require('../lib/otel')
const { writeFileAtomic } = require('../lib/fsx')
const { formatStatusline, normalizeBudget } = require('../lib/statusline')
const U = require('../lib/update')

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

// ── legacy hook stripping ─────────────────────────────────────────────────────
test('stripLegacyHooks removes only record-usage.js Stop hooks', () => {
  const s = {
    hooks: {
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: 'node ~/.tokenfin/record-usage.js' }] },
        { hooks: [{ type: 'command', command: 'node "/Users/x/.tokenfin/record-usage.js"' }, { type: 'command', command: 'say done' }] },
        { type: 'command', command: 'node C:\\Users\\x\\.tokenfin\\record-usage.js' },
        { hooks: [{ type: 'command', command: 'echo keep' }] },
      ],
      PreToolUse: [{ hooks: [{ type: 'command', command: 'lint' }] }],
    },
  }
  const { removed } = O.stripLegacyHooks(s)
  assert.equal(removed, 3)
  assert.deepEqual(s.hooks.Stop, [
    { hooks: [{ type: 'command', command: 'say done' }] },
    { hooks: [{ type: 'command', command: 'echo keep' }] },
  ])
  assert.ok(s.hooks.PreToolUse)
})

test('stripLegacyHooks drops empty Stop / hooks objects', () => {
  const s = { model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node ~/.tokenfin/record-usage.js' }] }] } }
  assert.equal(O.stripLegacyHooks(s).removed, 1)
  assert.deepEqual(s, { model: 'x' })
})

test('stripLegacyHooks is a no-op without legacy hooks', () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }
  const before = JSON.stringify(s)
  assert.equal(O.stripLegacyHooks(s).removed, 0)
  assert.equal(JSON.stringify(s), before)
  assert.equal(O.stripLegacyHooks({}).removed, 0)
})

// ── atomic writes ────────────────────────────────────────────────────────────
test('writeFileAtomic writes, preserves mode, leaves no temp files', () => {
  const d = path.join(TMP, 'atomic'); fs.mkdirSync(d)
  const f = path.join(d, 'settings.json')
  fs.writeFileSync(f, 'old'); fs.chmodSync(f, 0o600)
  writeFileAtomic(f, '{"a":1}\n')
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}\n')
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(d), ['settings.json'])
})

test('writeFileAtomic creates parent dirs and honours explicit mode', () => {
  const f = path.join(TMP, 'deep', 'er', 'config.json')
  writeFileAtomic(f, 'x', { mode: 0o600 })
  assert.equal(fs.readFileSync(f, 'utf8'), 'x')
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o777, 0o600)
})

test('writeFileAtomic failure keeps the original and cleans up the temp file', () => {
  const d = path.join(TMP, 'atomic-fail'); fs.mkdirSync(d)
  const target = path.join(d, 'isdir')
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep'), 'k')
  assert.throws(() => writeFileAtomic(target, 'data'))
  assert.deepEqual(fs.readdirSync(d), ['isdir'])
  assert.equal(fs.readFileSync(path.join(target, 'keep'), 'utf8'), 'k')
})

// ── --no-prompts ─────────────────────────────────────────────────────────────
test('otelEnv includes prompt capture by default and omits it with prompts:false', () => {
  const on = O.otelEnv('https://x/api/otel', 'tfk_a')
  assert.equal(on.OTEL_LOG_USER_PROMPTS, '1')
  assert.equal(on.OTEL_EXPORTER_OTLP_HEADERS, 'Authorization=Bearer tfk_a')
  const off = O.otelEnv('https://x/api/otel', 'tfk_a', { prompts: false })
  assert.ok(!('OTEL_LOG_USER_PROMPTS' in off))
  for (const k of O.REQUIRED_KEYS) assert.ok(off[k], k)
})

test('applyOtelEnv with prompts:false removes an existing OTEL_LOG_USER_PROMPTS, keeps user env', () => {
  const s = { env: { OTEL_LOG_USER_PROMPTS: '1', MY_VAR: 'keep', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer old' } }
  O.applyOtelEnv(s, 'https://x/api/otel', 'tfk_new', { prompts: false })
  assert.ok(!('OTEL_LOG_USER_PROMPTS' in s.env))
  assert.equal(s.env.MY_VAR, 'keep')
  assert.equal(O.keyFromHeaders(s.env.OTEL_EXPORTER_OTLP_HEADERS), 'tfk_new')
})

test('Codex and Gemini honour prompts:false; Codex never writes a metrics_exporter string', () => {
  const on = O.codexOtelToml('https://x/api/otel', 'k')
  const off = O.codexOtelToml('https://x/api/otel', 'k', { prompts: false })
  assert.match(on, /^log_user_prompt = true$/m)
  assert.match(off, /^log_user_prompt = false$/m)
  assert.doesNotMatch(on, /^\s*metrics_exporter\s*=/m)
  assert.match(on, /^\[otel\.metrics_exporter\.otlp-http\]$/m)
  assert.equal(O.geminiTelemetry('e', 'k').logPrompts, true)
  assert.equal(O.geminiTelemetry('e', 'k', { prompts: false }).logPrompts, false)
})

test('Codex block upsert/strip round-trips', () => {
  const block = O.codexOtelBlock('https://x/api/otel', 'k')
  const a = O.upsertCodexBlock('model = "o3"\n', block)
  assert.ok(a.ok && O.hasCodexBlock(a.text))
  const b = O.upsertCodexBlock(a.text, O.codexOtelBlock('https://x/api/otel', 'k2'))
  assert.equal(b.text.split('# >>> tokenfin').length, 2)
  assert.ok(b.text.includes('Bearer k2') && !b.text.includes('Bearer k"'))
  assert.equal(O.stripCodexBlock(b.text).text.trim(), 'model = "o3"')
  assert.equal(O.upsertCodexBlock('[otel]\nexporter="none"\n', block).ok, false)
})

test('CLAUDE_CONFIG_DIR moves settings.json and .claude.json', () => {
  process.env.CLAUDE_CONFIG_DIR = path.join(TMP, 'ccd')
  try {
    assert.equal(O.claudeSettingsPath(), path.join(TMP, 'ccd', 'settings.json'))
    assert.equal(O.claudeStatePath(), path.join(TMP, 'ccd', '.claude.json'))
  } finally { delete process.env.CLAUDE_CONFIG_DIR }
  assert.equal(O.claudeSettingsPath(), path.join(TMP, '.claude', 'settings.json'))
})

// ── statusline ───────────────────────────────────────────────────────────────
test('formatStatusline renders today, MTD and % of budget', () => {
  assert.equal(formatStatusline(normalizeBudget({ today_usd: 1.234, mtd_usd: 45.67, pct_used: 61.6 })),
    'TokenFin $1.23 today · $45.67 MTD · 62% of budget')
  assert.equal(formatStatusline(normalizeBudget({ today_usd: 0, mtd_usd: 1234.5 })), 'TokenFin $0.00 today · $1,235 MTD')
  assert.equal(formatStatusline(normalizeBudget({ today_usd: 120.4, mtd_usd: 300, limit: { pct_used: 99.5 } })),
    'TokenFin $120 today · $300 MTD · 100% of budget')
  // the /api/v1/me/budget shape: personal spend preferred over org
  const real = normalizeBudget({
    me: { today: { cost_usd: 0.5 }, mtd: { cost_usd: 12 } }, org: { today: { cost_usd: 9 }, mtd: { cost_usd: 99 } },
    limit: { scope: 'org', period: 'monthly', budget: 200, spent: 124, pct: 62, metric: 'cost_usd' },
  })
  assert.equal(formatStatusline(real), 'TokenFin $0.50 today · $12.00 MTD · 62% of budget')
  assert.equal(real.limitUsd, 200)
  assert.equal(formatStatusline(normalizeBudget({ me: null, org: { today: { cost_usd: 1 }, mtd: { cost_usd: 2 } }, limit: null })),
    'TokenFin $1.00 today · $2.00 MTD')
  assert.equal(formatStatusline(null), 'TokenFin —')
})

test('isOurStatusline recognises only the TokenFin command', () => {
  assert.ok(O.isOurStatusline({ type: 'command', command: O.statuslineCommand() }))
  assert.ok(!O.isOurStatusline({ type: 'command', command: '~/bin/my-line.sh' }))
  assert.ok(!O.isOurStatusline(undefined))
})

// ── update check ─────────────────────────────────────────────────────────────
test('compareVersions', () => {
  assert.ok(U.compareVersions('0.4.1', '0.4.0') > 0)
  assert.ok(U.compareVersions('0.10.0', '0.9.9') > 0)
  assert.equal(U.compareVersions('0.4.0', 'v0.4.0'), 0)
  assert.ok(U.compareVersions('0.5.0-beta.1', '0.5.0') < 0)
})

test('checkForUpdate uses a mocked registry, caches daily, skips in CI / --yes', async () => {
  let hits = 0
  const srv = http.createServer((req, res) => { hits++; res.end(JSON.stringify({ name: 'tokenfin', version: '9.9.9' })) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.TOKENFIN_REGISTRY_URL = 'http://127.0.0.1:' + srv.address().port + '/tokenfin/latest'
  try {
    assert.equal(await U.checkForUpdate('0.4.0'), '9.9.9')
    assert.equal(await U.checkForUpdate('0.4.0'), '9.9.9')
    assert.equal(hits, 1, 'second call served from the daily cache')
    assert.equal(await U.checkForUpdate('9.9.9'), null)
    assert.equal(await U.checkForUpdate('0.4.0', { yes: true }), null)
    process.env.CI = '1'
    assert.equal(await U.checkForUpdate('0.4.0'), null)
    delete process.env.CI
    assert.equal(hits, 1)
  } finally {
    delete process.env.TOKENFIN_REGISTRY_URL
    srv.close()
  }
})

test('checkForUpdate never hangs on a dead registry (1.5 s timeout)', async () => {
  fs.rmSync(path.join(TMP, '.tokenfin', 'update-check.json'), { force: true })
  const srv = http.createServer(() => { /* never respond */ })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  process.env.TOKENFIN_REGISTRY_URL = 'http://127.0.0.1:' + srv.address().port + '/'
  const t0 = Date.now()
  try {
    assert.equal(await U.checkForUpdate('0.4.0'), null)
    assert.ok(Date.now() - t0 < 3000)
  } finally {
    delete process.env.TOKENFIN_REGISTRY_URL
    srv.closeAllConnections && srv.closeAllConnections()
    srv.close()
  }
})

// ── OpenCode plugin ───────────────────────────────────────────────────────────
test('bundled OpenCode plugin is byte-identical to plugins/opencode/tokenfin.js', () => {
  const repoCopy = path.join(__dirname, '..', '..', 'plugins', 'opencode', 'tokenfin.js')
  if (!fs.existsSync(repoCopy)) return   // published package: no monorepo around it
  assert.ok(fs.readFileSync(O.opencodePluginSource()).equals(fs.readFileSync(repoCopy)),
    'cli/assets/opencode-tokenfin.js drifted — cp plugins/opencode/tokenfin.js cli/assets/opencode-tokenfin.js')
})

test('stripOpencodePlugin drops every opencode-otel-plugin form and keeps the rest', () => {
  const list = ['opencode-claude-auth@latest', 'opencode-otel-plugin', 'opencode-otel-plugin@0.11.1', ['opencode-otel-plugin', { x: 1 }], ['keep-me', { y: 2 }], 'opencode-otel-plugin-extra']
  assert.deepEqual(O.stripOpencodePlugin(list), ['opencode-claude-auth@latest', ['keep-me', { y: 2 }], 'opencode-otel-plugin-extra'])
  assert.equal(O.hasLegacyOpencodePlugin(list), true)
  assert.equal(O.hasLegacyOpencodePlugin(['a']), false)
  assert.equal(O.stripOpencodePlugin(undefined), undefined)
})

test('install / status / uninstall the OpenCode plugin (never clobbers a foreign file)', () => {
  const r = O.installOpencodePlugin()
  assert.equal(r.changed, true)
  assert.match(r.version, /^\d+\.\d+\.\d+$/)
  assert.equal(O.opencodePluginPath(), path.join(TMP, '.config', 'opencode', 'plugin', 'tokenfin.js'))
  assert.deepEqual(O.opencodePluginStatus(), { installed: true, ours: true, version: r.version, current: true })
  assert.equal(O.installOpencodePlugin().changed, false)
  assert.equal(O.uninstallOpencodePlugin(), true)
  assert.equal(O.opencodePluginStatus().installed, false)
  fs.mkdirSync(path.dirname(O.opencodePluginPath()), { recursive: true })
  fs.writeFileSync(O.opencodePluginPath(), '// someone else')
  assert.throws(() => O.installOpencodePlugin(), /not the TokenFin plugin/)
  assert.equal(O.uninstallOpencodePlugin(), false)
  fs.rmSync(path.join(TMP, '.config'), { recursive: true, force: true })
})
