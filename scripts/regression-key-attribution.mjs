// Proves per-key usage attribution: two keys on one project; use only one;
// the new/unused key must show ZERO usage. Requires migration 016.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const S = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const rest = (p, o = {}) => fetch(`${S}/rest/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`); const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

console.log('\n=== Per-key usage attribution ===\n')
const orgs = await rest('orgs?select=id'); let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
const mk = async (nm) => { const raw = 'tfk_at_' + crypto.randomBytes(10).toString('hex'); const [k] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: nm, key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 12) + '..', env: 'production', scopes: ['read', 'write'], is_active: true }) }); return { raw, id: k.id } }
const A = await mk('USED key'), B = await mk('NEW unused key')
const call = (raw, n, a) => fetch('http://localhost:3001/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + raw }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: n, arguments: a } }) }).then(r => r.json())
try {
  const r = await call(A.raw, 'record_usage', { model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 500 })
  const rec = JSON.parse(r.result.content[0].text)
  rec.recorded ? pass('record_usage on key A ok') : fail('record_usage failed — is migration 016 applied? ' + JSON.stringify(rec))
  await new Promise(r => setTimeout(r, 500))
  const evA = await rest(`usage_events?select=cost_usd&api_key_id=eq.${A.id}`)
  const evB = await rest(`usage_events?select=cost_usd&api_key_id=eq.${B.id}`)
  evA.length > 0 ? pass(`USED key A → ${evA.length} event(s)`) : fail('key A has no attributed usage')
  evB.length === 0 ? pass('NEW key B → ZERO usage (attribution correct)') : fail(`NEW key B wrongly shows ${evB.length} events`)
} finally {
  await rest(`usage_events?api_key_id=eq.${A.id}`, { method: 'DELETE' }).catch(() => {})
  await rest(`api_keys?id=eq.${A.id}`, { method: 'DELETE' }); await rest(`api_keys?id=eq.${B.id}`, { method: 'DELETE' })
  console.log('\n(cleaned up)')
}
console.log(`\n=== ${process.exitCode ? 'FAIL (apply migration 016?)' : 'all green'} ===\n`)
