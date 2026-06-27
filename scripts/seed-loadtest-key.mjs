// Seeds a temp API key for load testing; prints "RAWKEY <key>" and "KEYID <id>".
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const S = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
const rest = (p, o = {}) => fetch(`${S}/rest/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const orgs = await rest('orgs?select=id')
let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
const raw = `tfk_load_${proj.id.replace(/-/g, '').slice(0, 4)}_${crypto.randomBytes(16).toString('hex')}`
const [k] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'loadtest key (auto)', key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 12) + '••••', env: 'development', scopes: ['read', 'write'], is_active: true }) })
console.log('RAWKEY', raw)
console.log('KEYID', k.id)
