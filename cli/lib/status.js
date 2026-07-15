'use strict'

// `tokenfin status` — is Claude Code configured, and are events flowing?

const { readConfig } = require('./config')
const { MANAGED_KEYS, readClaudeSettings } = require('./otel')
const { getConnStatus } = require('./api')
const { DEFAULT_APP_URL } = require('./login')

const log = (m) => process.stdout.write(m + '\n')
const mark = (ok) => (ok ? '✔' : '✗')

async function status(flags = {}) {
  const cfg = readConfig()
  const appUrl = (flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || DEFAULT_APP_URL).replace(/\/$/, '')
  const key = (flags.key || process.env.TOKENFIN_KEY || cfg.key || '').trim()

  let env = {}
  try { env = readClaudeSettings().env || {} }
  catch (e) { log('! ' + e.message) }

  const configured = MANAGED_KEYS.every((k) => env[k])
  log(mark(configured) + ' Claude Code OTel config ' + (configured ? 'present' : 'missing — run `tokenfin setup`'))
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) log('  endpoint: ' + env.OTEL_EXPORTER_OTLP_ENDPOINT)

  if (!key) { log('· no stored key — run `tokenfin login` to check live event flow'); return }

  const r = await getConnStatus(appUrl, key, 'claude_code')
  if (!r.ok) { log('✗ could not reach TokenFin — ' + r.why); return }
  const s = r.status || {}
  if (s.last_event_at) {
    const ageMin = Math.round((Date.now() - new Date(s.last_event_at).getTime()) / 60000)
    log('✔ live — last event ' + ageMin + ' min ago · ' + Number(s.tokens_today || 0).toLocaleString() + ' tokens today · ' + (s.cost_basis || 'notional'))
  } else {
    log('· no events yet for claude_code — run a Claude Code turn')
  }
}

module.exports = { status }
