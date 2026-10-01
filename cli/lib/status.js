'use strict'

// `tokenfin status` — is Claude Code configured, and are events flowing?

const { readConfig, readKeyOf } = require('./config')
const { REQUIRED_KEYS, readClaudeSettings } = require('./otel')
const { getConnStatus } = require('./api')
const { DEFAULT_APP_URL } = require('./login')

const log = (m) => process.stdout.write(m + '\n')
const mark = (ok) => (ok ? '✔' : '✗')

async function status(flags = {}) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const key = (flags.key || process.env.TOKENFIN_KEY || readKeyOf(cfg)).trim()

  let env = {}
  try { env = readClaudeSettings().env || {} }
  catch (e) { log('! ' + e.message) }

  const configured = REQUIRED_KEYS.every((k) => env[k])
  log(mark(configured) + ' Claude Code OTel config ' + (configured ? 'present' : 'missing — run `npx tokenfin@latest setup`'))
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) log('  endpoint: ' + env.OTEL_EXPORTER_OTLP_ENDPOINT)
  if (configured) log('  prompt text: ' + (env.OTEL_LOG_USER_PROMPTS ? 'captured (opt out: setup --no-prompts)' : 'not captured'))

  if (!key) { log('· no stored key — run `npx tokenfin@latest login` to check live event flow'); return }
  await require('./agentconfig').autoSync({ ...flags, key, appUrl })

  const r = await getConnStatus(appUrl, key, 'claude_code')
  if (!r.ok) { log('✗ ' + (r.status === 401 || r.status === 403 ? r.why : 'could not reach TokenFin — ' + r.why)); return }
  const s = r.status || {}
  if (s.last_event_at) {
    const ageMin = Math.round((Date.now() - new Date(s.last_event_at).getTime()) / 60000)
    log('✔ live — last event ' + ageMin + ' min ago · ' + Number(s.tokens_today || 0).toLocaleString() + ' tokens today · ' + (s.cost_basis || 'notional'))
  } else {
    log('· no events yet for claude_code — run a Claude Code turn')
  }
}

module.exports = { status }
