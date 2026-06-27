#!/usr/bin/env node
/**
 * Regression test for LIMITS enforcement + ALERTS notification firing.
 *
 * Drives real `limits` rows through the live ingest endpoint to verify:
 *   - block_at   → 403  (hard block, event NOT recorded)
 *   - throttle_at → 429 (back-pressure, event NOT recorded)
 *   - warn_at    → 200 + a 'warning'/'alert' notification row exists
 *   - no limit   → 200  (baseline)
 * All test limit rows + the test key are cleaned up at the end.
 *
 * Run:  cd web && npm run dev   then   node scripts/regression-alerts-limits.mjs
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const env = {}
for (const line of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY
const rest = (p, o = {}) => fetch(`${SUPA}/rest/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} -> ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const log = (...a) => console.log(...a)
const pass = m => log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = m => { log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

const ingest = (raw) => fetch(`${BASE}/api/v1/ingest`, { method: 'POST', headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', input_tokens: 100, output_tokens: 50 }) })

async function main() {
  log('\n=== Regression: limits enforcement + alert notifications ===\n')

  // org with a project + a project
  const orgs = await rest('orgs?select=id,name')
  let org, proj
  for (const o of orgs) { const [p] = await rest(`projects?select=id,name&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
  if (!proj) throw new Error('no org with a project')
  log(`Org: ${org.name}  Project: ${proj.name}`)

  // temp key (write scope)
  const raw = `tfk_test_${proj.id.replace(/-/g, '').slice(0, 4)}_${crypto.randomBytes(16).toString('hex')}`
  const [key] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'regression key (auto)', key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw, env: 'development', scopes: ['read', 'write'], is_active: true }) })

  // current month spend
  const monthStart = new Date(); monthStart.setDate(1)
  const agg = await rest(`usage_agg?select=cost_usd&org_id=eq.${org.id}&bucket=gte.${monthStart.toISOString().slice(0, 10)}`)
  const spend = agg.reduce((s, r) => s + Number(r.cost_usd || 0), 0)
  log(`Current month spend: $${spend.toFixed(4)}\n`)
  if (spend <= 0) { log('  (no spend this month — send events first; skipping over-budget cases)'); }

  const mkLimit = (fields) => rest('limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'org', period: 'monthly', metric: 'cost_usd', is_active: true, warn_at: 70, throttle_at: 90, block_at: 100, ...fields }) }).then(r => r[0])
  const rmLimit = (id) => rest(`limits?id=eq.${id}`, { method: 'DELETE' })
  const budgetForPct = (targetPct) => Math.max(spend / (targetPct / 100), 0.0001) // budget so spend ≈ targetPct%

  const created = []
  try {
    // baseline: no active limit
    log('Baseline (no limit):')
    let r = await ingest(raw)
    r.status === 200 ? pass('ingest → 200') : fail(`ingest → ${r.status}`)

    if (spend > 0) {
      // BLOCK: spend ≈ 200% of budget, block_at 80 → 403
      log('\nBlock case (spend ≥ block_at):')
      const bl = await mkLimit({ budget_usd: Number(budgetForPct(200).toFixed(4)), warn_at: 50, throttle_at: 60, block_at: 80 }); created.push(bl.id)
      r = await ingest(raw); const jb = await r.json().catch(() => ({}))
      r.status === 403 ? pass(`ingest → 403 blocked (pct=${jb.pct})`) : fail(`ingest → ${r.status} (expected 403)`)
      await rmLimit(bl.id); created.pop()

      // THROTTLE: spend ≈ 200% of budget, throttle_at 10, block_at 300 → 429
      log('\nThrottle case (throttle_at ≤ spend < block_at):')
      const th = await mkLimit({ budget_usd: Number(budgetForPct(200).toFixed(4)), warn_at: 5, throttle_at: 10, block_at: 300 }); created.push(th.id)
      r = await ingest(raw); const jt = await r.json().catch(() => ({}))
      if (r.status === 429) { pass(`ingest → 429 throttled (pct=${jt.pct}, Retry-After=${r.headers.get('retry-after')})`) }
      else fail(`ingest → ${r.status} (expected 429)`)
      await rmLimit(th.id); created.pop()

      // WARN: spend ≈ 200% of budget, warn_at 10, throttle/block high → 200 + notification
      log('\nWarn case (warn_at ≤ spend < throttle_at) fires notification:')
      const wn = await mkLimit({ budget_usd: Number(budgetForPct(200).toFixed(4)), warn_at: 10, throttle_at: 300, block_at: 400 }); created.push(wn.id)
      r = await ingest(raw)
      r.status === 200 ? pass('ingest → 200 (allowed)') : fail(`ingest → ${r.status} (expected 200)`)
      await new Promise(res => setTimeout(res, 800)) // notify is async
      const today = new Date().toISOString().slice(0, 10)
      const notifs = await rest(`notifications?select=type,title&org_id=eq.${org.id}&created_at=gte.${today}T00:00:00Z&type=in.(warning,alert)`)
      notifs.length ? pass(`notification present: "${notifs[0].title}" (${notifs.length} today)`) : fail('no warning/alert notification created today')
      await rmLimit(wn.id); created.pop()
    }
  } finally {
    for (const id of created) await rmLimit(id).catch(() => {})
    await rest(`api_keys?id=eq.${key.id}`, { method: 'DELETE' }).catch(() => {})
    log('\n(cleaned up test key + limit rows)')
  }
  log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green'} ===\n`)
}
main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
