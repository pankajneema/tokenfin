'use strict'

// End-to-end: run bin/tokenfin.js against a throwaway HOME and a local mock
// TokenFin server. Never touches the real home directory or network.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const BIN = path.join(__dirname, '..', 'bin', 'tokenfin.js')
const GOOD = 'tfk_prod_test_goodkey0000000000000000000000'
const READ = 'tfk_prod_test_readkey0000000000000000000000'
const REVOKED = 'tfk_prod_test_revoked000000000000000000000'

let srv, base
const calls = []
test.before(async () => {
  srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const auth = (req.headers.authorization || '').replace('Bearer ', '')
      calls.push({ method: req.method, url: req.url, auth, body })
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      const u = req.url.split('?')[0]
      if (u === '/api/otel/v1/metrics') return auth === GOOD ? json(200, {}) : json(401, { error: 'unauthorized' })
      if (u === '/api/v1/connections') return [GOOD, READ].includes(auth) ? json(200, req.url.includes('source=') ? { source: 'claude_code', last_event_at: null } : { sources: [] }) : json(401, { error: 'Unauthorized' })
      if (u === '/api/v1/me/budget') return auth === READ ? json(200, { me: { today: { cost_usd: 1.5 }, mtd: { cost_usd: 42 } }, org: { today: { cost_usd: 3 }, mtd: { cost_usd: 80 } }, limit: { scope: 'org', period: 'monthly', budget: 100, spent: 62, pct: 62, metric: 'cost_usd' } }) : json(401, {})
      if (u === '/api/v1/cli/token' && req.method === 'DELETE') return json(200, { revoked: 2 })
      json(404, { error: 'not found' })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + srv.address().port
})
test.after(() => srv.close())

function mkHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenfin-e2e-'))
  fs.mkdirSync(path.join(home, '.claude'))
  return home
}

function cli(home, args) {
  return new Promise((resolve) => {
    const env = {
      HOME: home, USERPROFILE: home, TOKENFIN_NO_UPDATE_CHECK: '1',
      // PATH without real agents: detection falls back to ~/.claude etc.
      PATH: path.dirname(process.execPath),
    }
    const p = spawn(process.execPath, [BIN, ...args], { env })
    let out = ''
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

test('setup strips the legacy Stop hook, deletes record-usage.js, honours --no-prompts, installs statusline', async () => {
  const home = mkHome()
  const settingsPath = path.join(home, '.claude', 'settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify({
    env: { MY_VAR: '1', OTEL_LOG_USER_PROMPTS: '1' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node ~/.tokenfin/record-usage.js' }] }] },
  }))
  fs.mkdirSync(path.join(home, '.tokenfin'))
  fs.writeFileSync(path.join(home, '.tokenfin', 'record-usage.js'), '// legacy')

  const r = await cli(home, ['setup', '--key', GOOD, '--read-key', READ, '--app-url', base, '--no-prompts', '--statusline', '--no-wait', '--no-mcp', '--yes'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Prompt capture is OFF/)
  assert.match(r.out, /removed legacy 0\.2 Stop hook/)
  const s = readJson(settingsPath)
  // legacy Stop hook gone; only the TokenFin session hooks remain
  assert.equal(s.hooks.Stop, undefined)
  assert.deepEqual(Object.keys(s.hooks).sort(), ['SessionEnd', 'SessionStart'])
  assert.match(s.hooks.SessionStart[0].hooks[0].command, /\.tokenfin.hooks.session\.js/)
  assert.equal(s.hooks.SessionStart[0].hooks[0].timeout, 5)
  assert.ok(fs.existsSync(path.join(home, '.tokenfin', 'hooks', 'session.js')))
  assert.equal(s.env.MY_VAR, '1')
  assert.equal(s.env.OTEL_LOG_USER_PROMPTS, undefined)
  assert.equal(s.env.OTEL_EXPORTER_OTLP_HEADERS, 'Authorization=Bearer ' + GOOD)
  assert.equal(s.env.OTEL_EXPORTER_OTLP_ENDPOINT, base + '/api/otel')
  assert.match(s.statusLine.command, /\.tokenfin.statusline\.js/)
  assert.ok(!fs.existsSync(path.join(home, '.tokenfin', 'record-usage.js')))
  assert.ok(fs.existsSync(path.join(home, '.tokenfin', 'statusline.js')))
  const cfg = readJson(path.join(home, '.tokenfin', 'config.json'))
  assert.equal(cfg.key, GOOD); assert.equal(cfg.read_key, READ); assert.equal(cfg.prompts, false)
  assert.ok(cfg.device_id)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, '.tokenfin', 'config.json')).mode & 0o777, 0o600)

  // statusline (installed standalone copy) reads config + mocked budget
  const sl = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(home, '.tokenfin', 'statusline.js')], { env: { HOME: home, PATH: path.dirname(process.execPath) } })
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('close', () => resolve(out))
  })
  assert.equal(sl.trim(), 'TokenFin $1.50 today · $42.00 MTD · 62% of budget')

  // remove: revokes on the server, strips everything, deletes ~/.tokenfin/config.json
  const rm = await cli(home, ['remove', '--app-url', base])
  assert.equal(rm.code, 0, rm.out)
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url === '/api/v1/cli/token' && c.auth === READ))
  const after = readJson(settingsPath)
  assert.deepEqual(after, { env: { MY_VAR: '1' } })
  assert.ok(!fs.existsSync(path.join(home, '.tokenfin', 'config.json')))
  assert.ok(!fs.existsSync(path.join(home, '.tokenfin', 'hooks', 'session.js')))
  fs.rmSync(home, { recursive: true, force: true })
})

test('setup --no-session-hooks strips them and persists; doctor reports the state', async () => {
  const home = mkHome()
  const settingsPath = path.join(home, '.claude', 'settings.json')
  let r = await cli(home, ['setup', '--key', GOOD, '--read-key', READ, '--app-url', base, '--no-wait', '--no-mcp', '--yes'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Sessions\s+hooks SessionStart \+ SessionEnd/)
  r = await cli(home, ['setup', '--app-url', base, '--no-wait', '--no-mcp', '--yes', '--no-session-hooks'])
  assert.match(r.out, /hooks removed \(--no-session-hooks\)/)
  assert.equal(readJson(settingsPath).hooks, undefined)
  r = await cli(home, ['setup', '--app-url', base, '--no-wait', '--no-mcp', '--yes'])
  assert.equal(readJson(settingsPath).hooks, undefined)   // opt-out persisted
  r = await cli(home, ['doctor'])
  assert.match(r.out, /session hooks off/)
  r = await cli(home, ['setup', '--app-url', base, '--no-wait', '--no-mcp', '--yes', '--session-hooks'])
  assert.ok(readJson(settingsPath).hooks.SessionEnd)
  r = await cli(home, ['doctor'])
  assert.match(r.out, /✔ session hooks installed/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('setup never overwrites a user statusLine; re-run with --prompts re-enables capture', async () => {
  const home = mkHome()
  const settingsPath = path.join(home, '.claude', 'settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: '~/bin/mine.sh' } }))
  let r = await cli(home, ['setup', '--key', GOOD, '--app-url', base, '--statusline', '--no-wait', '--no-mcp', '--yes', '--no-prompts'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /already have a statusLine/)
  assert.equal(readJson(settingsPath).statusLine.command, '~/bin/mine.sh')
  // prompts:false persists across re-runs until --prompts
  r = await cli(home, ['setup', '--app-url', base, '--no-wait', '--no-mcp', '--yes'])
  assert.equal(readJson(settingsPath).env.OTEL_LOG_USER_PROMPTS, undefined)
  r = await cli(home, ['setup', '--app-url', base, '--no-wait', '--no-mcp', '--yes', '--prompts'])
  assert.match(r.out, /Prompt capture is ON/)
  assert.equal(readJson(settingsPath).env.OTEL_LOG_USER_PROMPTS, '1')
  fs.rmSync(home, { recursive: true, force: true })
})

test('setup rejects a revoked key; doctor flags key drift and revocation', async () => {
  const home = mkHome()
  let r = await cli(home, ['setup', '--key', REVOKED, '--app-url', base, '--no-wait', '--no-mcp', '--yes'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /401/)

  // agents still send REVOKED while config.json holds GOOD → drift + revoked
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: base + '/api/otel',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + REVOKED, OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative',
  } }))
  fs.mkdirSync(path.join(home, '.tokenfin'))
  fs.writeFileSync(path.join(home, '.tokenfin', 'config.json'), JSON.stringify({ key: GOOD, read_key: READ, appUrl: base }))
  r = await cli(home, ['doctor'])
  assert.equal(r.code, 1)
  assert.match(r.out, /settings\.json sends key/)
  assert.match(r.out, /key revoked — run `npx tokenfin@latest login`/)
  fs.rmSync(home, { recursive: true, force: true })
})

test('OpenCode: setup installs the TokenFin plugin and drops opencode-otel-plugin; doctor + remove', async () => {
  const home = mkHome()
  const ocDir = path.join(home, '.config', 'opencode')
  fs.mkdirSync(ocDir, { recursive: true })
  const ocCfg = path.join(ocDir, 'opencode.json')
  fs.writeFileSync(ocCfg, JSON.stringify({ model: 'anthropic/x', plugin: ['opencode-claude-auth@latest', 'opencode-otel-plugin'] }))
  const pluginFile = path.join(ocDir, 'plugin', 'tokenfin.js')

  let r = await cli(home, ['setup', '--key', GOOD, '--read-key', READ, '--app-url', base, '--no-wait', '--no-mcp', '--yes'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /OpenCode\s+plugin v[\d.]+ → .*plugin.tokenfin\.js \(removed opencode-otel-plugin/)
  assert.deepEqual(readJson(ocCfg), { model: 'anthropic/x', plugin: ['opencode-claude-auth@latest'] })
  assert.ok(fs.existsSync(ocCfg + '.bak-tokenfin'))
  assert.ok(fs.readFileSync(pluginFile, 'utf8').includes('TokenFin plugin for OpenCode'))
  // the plugin needs no env: config.json carries key + app url
  const cfg = readJson(path.join(home, '.tokenfin', 'config.json'))
  assert.equal(cfg.key, GOOD); assert.equal(cfg.appUrl, base)

  r = await cli(home, ['doctor'])
  assert.match(r.out, /✔ OpenCode — TokenFin plugin v[\d.]+ in /)
  // a re-added otel plugin is flagged as double counting
  fs.writeFileSync(ocCfg, JSON.stringify({ plugin: ['opencode-otel-plugin@latest'] }))
  r = await cli(home, ['doctor'])
  assert.match(r.out, /✗ OpenCode — opencode-otel-plugin is still in .* double-counts/)

  r = await cli(home, ['remove', '--app-url', base])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /OpenCode — removed TokenFin plugin/)
  assert.match(r.out, /OpenCode — removed opencode-otel-plugin/)
  assert.ok(!fs.existsSync(pluginFile))
  assert.deepEqual(readJson(ocCfg).plugin, [])
  fs.rmSync(home, { recursive: true, force: true })
})

test('budget command prints spend and tightest budget', async () => {
  const home = mkHome()
  fs.mkdirSync(path.join(home, '.tokenfin'))
  fs.writeFileSync(path.join(home, '.tokenfin', 'config.json'), JSON.stringify({ key: GOOD, read_key: READ, appUrl: base }))
  const r = await cli(home, ['budget'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /Month to date\s+\$42\.00/)
  assert.match(r.out, /Used\s+62%/)
  fs.rmSync(home, { recursive: true, force: true })
})
