// Verifies the key-storage security fix: POST /api/v1/keys returns the raw key
// ONCE, stores only a masked key_prefix (never the full key), and the key works.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const REF = new URL(SUPA).hostname.split('.')[0], KEYK = `sb-${REF}-auth-token`
const rest = (p, o = {}) => fetch(`${SUPA}/rest/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const adm = (p, o = {}) => fetch(`${SUPA}/auth/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(o.headers || {}) } })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`); const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const cookie = s => { const full = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64'); const out = []; for (let i = 0; i < full.length; i += 3180) out.push(`${KEYK}.${i / 3180}=${full.slice(i, i + 3180)}`); return out.join('; ') }

console.log('\n=== Key security regression ===\n')
const orgs = await rest('orgs?select=id'); let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
const email = `qa-keysec-${org.id.slice(0, 8)}@example.com`
const ex = await adm('admin/users?per_page=200').then(r => r.json()).then(d => (d.users || []).find(u => u.email === email)); if (ex) await adm(`admin/users/${ex.id}`, { method: 'DELETE' })
const uid = await adm('admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) }).then(r => r.json()).then(d => d.id)
const [member] = await rest('members', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, role: 'admin' }) })
const gl = await adm('admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) }).then(r => r.json())
const session = await fetch(`${SUPA}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: gl.email_otp }) }).then(r => r.json())
const C = cookie(session)

let keyId
try {
  const res = await fetch(`${BASE}/api/v1/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'qa security key', created_by: uid, user_id: uid, env: 'development', scopes: ['read', 'write'] }) })
  const data = await res.json()
  keyId = data.id
  res.status === 201 || res.status === 200 ? pass(`POST key → ${res.status}`) : fail(`POST key → ${res.status} ${JSON.stringify(data)}`)
  data.raw_key && data.raw_key.startsWith('tfk_') ? pass('raw_key returned once in POST response') : fail('raw_key missing from POST response')
  data.key_prefix && data.key_prefix.includes('…') && data.key_prefix !== data.raw_key ? pass(`key_prefix is masked: ${data.key_prefix}`) : fail(`key_prefix NOT masked: ${data.key_prefix}`)
  !('key_hash' in data) ? pass('key_hash never returned') : fail('key_hash leaked in response')

  // DB stores only the masked prefix, never the raw key
  const [row] = await rest(`api_keys?select=key_prefix,key_hash&id=eq.${keyId}`)
  row.key_prefix.includes('…') && !row.key_prefix.includes(data.raw_key.slice(14)) ? pass('DB key_prefix is masked (raw key not stored)') : fail(`DB stores raw-ish prefix: ${row.key_prefix}`)
  row.key_hash === crypto.createHash('sha256').update(data.raw_key).digest('hex') ? pass('key_hash = sha256(raw) (lookup works)') : fail('key_hash mismatch')

  // the revealed raw key actually works for ingest
  const ing = await fetch(`${BASE}/api/v1/ingest`, { method: 'POST', headers: { Authorization: `Bearer ${data.raw_key}`, 'Content-Type': 'application/json' }, body: '{"model":"gpt-4o-mini","input_tokens":10,"output_tokens":5}' })
  ing.status === 200 ? pass('raw key works for ingest → 200') : fail(`ingest with raw key → ${ing.status}`)
} finally {
  if (keyId) await rest(`api_keys?id=eq.${keyId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`members?id=eq.${member.id}`, { method: 'DELETE' }).catch(() => {})
  await adm(`admin/users/${uid}`, { method: 'DELETE' }).catch(() => {})
  console.log('\n(cleaned up)')
}
console.log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green'} ===\n`)
