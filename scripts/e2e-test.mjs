#!/usr/bin/env node
/**
 * TokenFin end-to-end ingest test.
 *
 * What it does (as a "real tester"):
 *   1. Reads Supabase creds from web/.env.local
 *   2. Picks your first org + project (service-role read)
 *   3. Creates a temporary test API key (tfk_test_...) directly in api_keys
 *   4. Sends N realistic usage events to POST /api/v1/ingest
 *   5. Verifies usage_events + usage_agg were written
 *   6. Cleans up the test key (revokes it)
 *
 * Run:
 *   cd web && npm run dev          # in one terminal (port 3001)
 *   node scripts/e2e-test.mjs      # in another (from repo root)
 *
 * Flags:
 *   --keep      don't revoke the test key afterwards
 *   --n=20      number of events to send (default 12)
 *   --base=...  base URL (default http://localhost:3001)
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=')
  return [k, v ?? true]
}))
const BASE = args.base || 'http://localhost:3001'
const N = Number(args.n || 12)

// --- load env from web/.env.local ---
const env = {}
for (const line of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL
const SR = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA || !SR) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local')

const rest = (path, opts = {}) => fetch(`${SUPA}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
}).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`); return t ? JSON.parse(t) : null })

const log = (...a) => console.log(...a)
const pass = m => log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = m => { log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

const MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-4o', 'gpt-4o-mini', 'gemini-1.5-pro']

async function main() {
  log('\n=== TokenFin E2E ingest test ===\n')

  // 1. org + project — pick the first org that actually has a project
  // (override with --org=<uuid> / --project=<uuid>)
  let org, proj
  if (args.project) {
    [proj] = await rest(`projects?select=id,name,org_id&id=eq.${args.project}`)
    if (!proj) throw new Error(`project ${args.project} not found`)
    ;[org] = await rest(`orgs?select=id,name,plan&id=eq.${proj.org_id}`)
  } else {
    const orgs = await rest(`orgs?select=id,name,plan${args.org ? `&id=eq.${args.org}` : ''}`)
    for (const o of orgs) {
      const [p] = await rest(`projects?select=id,name&org_id=eq.${o.id}&limit=1`)
      if (p) { org = o; proj = p; break }
    }
    if (!proj) throw new Error('No org with a project found. Create a project first.')
  }
  log(`Org: ${org.name} (${org.plan})   Project: ${proj.name}`)

  // 2. create test key
  const raw = `tfk_test_${proj.id.replace(/-/g, '').slice(0, 4)}_${crypto.randomBytes(16).toString('hex')}`
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const [key] = await rest('api_keys', { method: 'POST', body: JSON.stringify({
    org_id: org.id, project_id: proj.id, name: 'E2E test key (auto)',
    key_hash: keyHash, key_prefix: raw, env: 'development', scopes: ['read', 'write'], is_active: true,
  }) })
  pass(`created test key ${raw.slice(0, 20)}…`)

  // baseline counts
  const countOf = async (table) => {
    const r = await fetch(`${SUPA}/rest/v1/${table}?select=id&org_id=eq.${org.id}`, {
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, Prefer: 'count=exact', Range: '0-0' } })
    return Number((r.headers.get('content-range') || '0/0').split('/')[1])
  }
  const eventsBefore = await countOf('usage_events')

  // 3. send events
  log(`\nSending ${N} events to ${BASE}/api/v1/ingest …`)
  let ok = 0, totalCost = 0
  for (let i = 0; i < N; i++) {
    const model = MODELS[i % MODELS.length]
    const input = 200 + Math.floor((i * 137) % 4000)
    const output = 80 + Math.floor((i * 91) % 1500)
    const body = { model, input_tokens: input, output_tokens: output,
      tags: { feature: ['chat', 'summarize', 'codegen'][i % 3], env: 'test' },
      metadata: { prompt_hash: `h${i % 5}`, latency_ms: 300 + (i * 53) % 1800 } }
    const res = await fetch(`${BASE}/api/v1/ingest`, { method: 'POST',
      headers: { Authorization: `Bearer ${raw}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.ok) { ok++; totalCost += j.cost_usd || 0 }
    else fail(`event ${i} (${model}) -> ${res.status} ${JSON.stringify(j)}`)
  }
  if (ok === N) pass(`${ok}/${N} events accepted (total cost ~$${totalCost.toFixed(4)})`)
  else fail(`${ok}/${N} events accepted`)

  // 4. verify writes (usage_agg upsert is async-ish; give it a beat)
  await new Promise(r => setTimeout(r, 1200))
  const eventsAfter = await countOf('usage_events')
  if (eventsAfter - eventsBefore >= ok) pass(`usage_events grew by ${eventsAfter - eventsBefore} (expected ≥ ${ok})`)
  else fail(`usage_events grew by ${eventsAfter - eventsBefore}, expected ≥ ${ok}`)

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) // IST date
  const agg = await rest(`usage_agg?select=model,total_tokens,cost_usd,request_count&org_id=eq.${org.id}&bucket=eq.${today}`)
  const reqSum = agg.reduce((s, r) => s + (r.request_count || 0), 0)
  if (agg.length > 0) pass(`usage_agg has ${agg.length} rows for ${today}, request_count sum = ${reqSum}`)
  else fail(`usage_agg has no rows for IST bucket ${today}`)
  if (reqSum >= ok) pass(`request_count correctly incremented (migration 009 fix working)`)
  else fail(`request_count sum ${reqSum} < ${ok} — upsert_usage_agg may be overwriting instead of incrementing`)

  // negative tests
  log('\nNegative tests:')
  const noauth = await fetch(`${BASE}/api/v1/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  noauth.status === 401 ? pass('no-auth → 401') : fail(`no-auth → ${noauth.status}`)
  const badkey = await fetch(`${BASE}/api/v1/ingest`, { method: 'POST', headers: { Authorization: 'Bearer tfk_nope', 'Content-Type': 'application/json' }, body: '{"model":"gpt-4o"}' })
  badkey.status === 401 ? pass('bad-key → 401') : fail(`bad-key → ${badkey.status}`)

  // read-only key must be rejected (scope enforcement)
  const roRaw = `tfk_test_${proj.id.replace(/-/g, '').slice(0, 4)}_${crypto.randomBytes(16).toString('hex')}`
  const [roKey] = await rest('api_keys', { method: 'POST', body: JSON.stringify({
    org_id: org.id, project_id: proj.id, name: 'E2E read-only key (auto)',
    key_hash: crypto.createHash('sha256').update(roRaw).digest('hex'), key_prefix: roRaw,
    env: 'development', scopes: ['read'], is_active: true }) })
  const roRes = await fetch(`${BASE}/api/v1/ingest`, { method: 'POST',
    headers: { Authorization: `Bearer ${roRaw}`, 'Content-Type': 'application/json' },
    body: '{"model":"gpt-4o","input_tokens":10,"output_tokens":5}' })
  roRes.status === 403 ? pass('read-only key → 403 (scope enforced)') : fail(`read-only key → ${roRes.status} (expected 403)`)
  await rest(`api_keys?id=eq.${roKey.id}`, { method: 'DELETE' })

  // 5. cleanup
  if (!args.keep) {
    await rest(`api_keys?id=eq.${key.id}`, { method: 'DELETE' })
    pass('test key deleted')
  } else {
    log(`  (kept test key id=${key.id}, raw=${raw})`)
  }

  log(`\n=== done${process.exitCode ? ' WITH FAILURES' : ' — all green'} ===\n`)
}
main().catch(e => { console.error('\n\x1b[31mFATAL:\x1b[0m', e.message); process.exit(1) })
