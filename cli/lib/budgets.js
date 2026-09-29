'use strict'
// tokenfin budgets apply <file> [--dry-run] [--yes] [--key K] [--app-url U]
// Budgets-as-code: uploads the YAML to POST /api/v1/budgets/apply, which parses,
// validates and diffs it server-side (so the CLI needs no YAML parser). Needs an
// ADMIN-scoped key (the per-device login keys are ingest/read only).
const fs = require('fs')
const http = require('http')
const https = require('https')

function post(url, key, body) {
  return new Promise((resolve) => {
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'text/yaml', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let buf = ''; res.setEncoding('utf8')
      res.on('data', (c) => (buf += c))
      res.on('end', () => { let json = null; try { json = JSON.parse(buf) } catch {} ; resolve({ status: res.statusCode, json }) })
    })
    req.on('error', (e) => resolve({ status: 0, json: { error: e.code || e.message } }))
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, json: { error: 'timeout' } }) })
    req.end(body)
  })
}

async function budgetsApply({ file, appUrl, key, dryRun, yes, log = console.log }) {
  if (!file) { log('usage: tokenfin budgets apply ./tokenfin-budgets.yaml [--dry-run] [--yes]'); return 2 }
  if (!key) { log('No API key. Pass --key or set TOKENFIN_API_KEY (needs the admin scope).'); return 2 }
  let yaml
  try { yaml = fs.readFileSync(file, 'utf8') } catch (e) { log(`Cannot read ${file}: ${e.message}`); return 2 }
  const base = String(appUrl).replace(/\/$/, '') + '/api/v1/budgets/apply'

  const plan = await post(base + '?dry_run=true', key, yaml)
  if (plan.status === 401) { log('Key rejected (401). Run `npx tokenfin@latest login` or pass --key.'); return 1 }
  if (plan.status === 403) { log('This key cannot manage budgets — it needs the admin scope.'); return 1 }
  if (plan.status === 422) {
    const j = plan.json || {}
    if (j.message) log(`${file}: ${j.message}`)
    for (const i of j.issues || []) log(`${file}: ${i.path}: ${i.message}`)
    if (j.diff) log(j.diff)
    return 1
  }
  if (plan.status !== 200) { log(`Server error (${plan.status}): ${(plan.json && plan.json.error) || 'unknown'}`); return 1 }
  log(plan.json.diff)
  const s = plan.json.plan.summary
  if (dryRun || s.create + s.update + s.delete === 0) return 0

  if (!yes) {
    if (!process.stdin.isTTY) { log('Refusing to apply without --yes in a non-interactive shell.'); return 1 }
    const ok = await new Promise((r) => {
      process.stdout.write('Apply these changes? [y/N] ')
      process.stdin.once('data', (d) => r(/^y(es)?$/i.test(String(d).trim())))
    })
    process.stdin.pause()
    if (!ok) { log('Aborted.'); return 1 }
  }
  const res = await post(base + '?apply=true', key, yaml)
  if (res.status !== 200 || !res.json || !res.json.applied) {
    log(`Apply failed (${res.status}). ${((res.json && res.json.failures) || []).join('; ')}`)
    return 1
  }
  log(`Applied: ${s.create} created, ${s.update} updated, ${s.delete} deleted.`)
  return 0
}

async function budgets(args, flags) {
  const { readConfig } = require('./config')
  const cfg = readConfig() || {}
  if (args[1] !== 'apply') {
    console.log('usage: tokenfin budgets apply ./tokenfin-budgets.yaml [--dry-run] [--yes] [--key <admin key>]')
    return 2
  }
  return budgetsApply({
    file: args[2],
    appUrl: flags.appUrl || process.env.TOKENFIN_APP_URL || cfg.appUrl || 'https://tokenfin.curiousdevs.com',
    key: flags.key || process.env.TOKENFIN_API_KEY,
    dryRun: !!flags.dryRun, yes: !!flags.yes,
  })
}

module.exports = { budgetsApply, budgets }
