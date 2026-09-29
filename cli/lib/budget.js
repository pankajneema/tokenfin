'use strict'

// `tokenfin budget` — today / month-to-date spend and the tightest budget,
// from GET /api/v1/me/budget (read key). `tokenfin statusline` prints the
// one-line form for Claude Code's status bar (60 s cache).

const { fetchBudget, formatStatusline, money } = require('./statusline')
const { readConfig, readKeyOf } = require('./config')

const log = (m) => process.stdout.write(m + '\n')

async function budget(flags = {}) {
  const cfg = readConfig()
  const key = (flags.key || process.env.TOKENFIN_KEY || readKeyOf(cfg)).trim()
  if (!key) throw new Error('no key — run `npx tokenfin@latest login` first')
  const r = await fetchBudget({ key, appUrl: flags.appUrl, useCache: false, timeoutMs: 8000 })
  if (!r.ok) {
    if (r.status === 401) throw new Error('key revoked — run `npx tokenfin@latest login`')
    if (r.status === 403) throw new Error('this is an ingest-only key — budget needs the read key. Run `npx tokenfin@latest login`')
    if (r.status === 404) throw new Error('this TokenFin server has no /api/v1/me/budget endpoint yet')
    throw new Error('could not fetch budget — ' + r.why)
  }
  const b = r.budget
  if (flags.json) { log(JSON.stringify(r.raw, null, 2)); return }
  const who = b.scope === 'you' ? ' (you)' : b.scope === 'org' ? ' (workspace)' : ''
  log('Today' + who.padEnd(11) + ' ' + money(b.today))
  log('Month to date    ' + money(b.mtd))
  if (b.limitUsd !== null || b.limitTokens !== null || b.pct !== null) {
    const what = [b.limitScope && b.limitScope + ' limit', b.limitPeriod].filter(Boolean).join(' · ')
    const cap = b.limitUsd !== null ? money(b.limitUsd) : b.limitTokens !== null ? b.limitTokens.toLocaleString('en-US') + ' tokens' : '—'
    log('Tightest budget  ' + cap + (what ? '  (' + what + ')' : ''))
    if (b.pct !== null) log('Used             ' + Math.round(b.pct) + '%')
  } else {
    log('Budget           none set (Dashboard → Limits)')
  }
  log('\n' + formatStatusline(b))
}

async function statusline() {
  let line = 'TokenFin —'
  try {
    const r = await fetchBudget({ timeoutMs: 2000 })
    if (r.ok) line = formatStatusline(r.budget)
    else if (r.status === 401) line = 'TokenFin key revoked — npx tokenfin@latest login'
  } catch {}
  log(line)
}

module.exports = { budget, statusline }
