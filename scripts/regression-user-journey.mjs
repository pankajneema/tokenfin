// Full real-user journey: sign in → create project → add API key (assigned to
// the user) → use the key in an MCP client (like Cursor) → tools work → usage
// flows back and is attributed to that user (My Usage).
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const S = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const REF = new URL(S).hostname.split('.')[0], KEYK = `sb-${REF}-auth-token`
const rest = (p, o = {}) => fetch(`${S}/rest/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const adm = (p, o = {}) => fetch(`${S}/auth/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', ...(o.headers || {}) } })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`); const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const cookie = s => { const f = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64'); const o = []; for (let i = 0; i < f.length; i += 3180) o.push(`${KEYK}.${i / 3180}=${f.slice(i, i + 3180)}`); return o.join('; ') }

console.log('\n=== Real user journey (create → key → MCP → usage attributed) ===\n')
const [org] = await rest('orgs?select=id,name&limit=1')

// 1. Sign in (throwaway user = "the user")
const email = `qa-journey-${org.id.slice(0, 8)}@example.com`
const exU = await adm('admin/users?per_page=200').then(r => r.json()).then(d => (d.users || []).find(u => u.email === email)); if (exU) await adm(`admin/users/${exU.id}`, { method: 'DELETE' })
const uid = (await adm('admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) }).then(r => r.json())).id
const [mem] = await rest('members', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, role: 'owner' }) })
const gl = await adm('admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) }).then(r => r.json())
const sess = await fetch(`${S}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: gl.email_otp }) }).then(r => r.json())
const C = cookie(sess)
sess.access_token ? pass('sign in (session established)') : fail('sign in failed')
const authed = (path, o = {}) => fetch(`${BASE}${path}`, { ...o, headers: { 'Content-Type': 'application/json', Cookie: C, ...(o.headers || {}) } })

const cleanup = { keyId: null, projId: null }
try {
  // 2. Create a project (dashboard action)
  let r = await authed('/api/v1/projects', { method: 'POST', body: JSON.stringify({ org_id: org.id, name: 'Journey Project', slug: 'journey-' + crypto.randomBytes(3).toString('hex') }) })
  const proj = await r.json()
  cleanup.projId = proj.id
  r.status === 201 || r.status === 200 ? pass(`create project → ${proj.name}`) : fail(`create project → ${r.status} ${JSON.stringify(proj)}`)

  // 3. Add an API key assigned to THIS user (exactly what the Keys page posts)
  r = await authed('/api/v1/keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'Cursor key', created_by: uid, user_id: uid, env: 'production', scopes: ['read', 'write'] }) })
  const kd = await r.json()
  cleanup.keyId = kd.id
  kd.raw_key ? pass(`add API key (assigned to user) → ${kd.key_prefix}`) : fail(`add key → ${r.status} ${JSON.stringify(kd)}`)
  const RAW = kd.raw_key

  // 4. Use the key in an MCP client (this is the config you paste into Cursor)
  const rpc = (b) => fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RAW}` }, body: JSON.stringify(b) }).then(r => r.json())
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  init.result?.serverInfo?.name === 'tokenfin' ? pass('MCP client connects (initialize)') : fail('MCP initialize failed')
  const tools = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length
  tools >= 9 ? pass(`MCP tools available (${tools})`) : fail(`tools/list → ${tools}`)

  // 5. Agent reports usage through MCP (record_usage) — like a tool call in Cursor
  const rec = JSON.parse((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'record_usage', arguments: { model: 'claude-sonnet-4-6', input_tokens: 800, output_tokens: 200 } } })).result.content[0].text)
  rec.recorded ? pass(`record_usage → $${rec.cost_usd}`) : fail('record_usage failed')

  await new Promise(r => setTimeout(r, 500))

  // 6. Usage is attributed to THIS user (My Usage) + this key
  const evUser = await rest(`usage_events?select=id,cost_usd&org_id=eq.${org.id}&user_id=eq.${uid}`)
  evUser.length > 0 ? pass(`usage attributed to the user → ${evUser.length} event(s) (My Usage will show these)`) : fail('no usage attributed to the user (My Usage empty)')
  const evKey = await rest(`usage_events?select=id&api_key_id=eq.${kd.id}`)
  evKey.length > 0 ? pass(`usage attributed to the key → ${evKey.length} event(s) (Keys page shows real per-key usage)`) : fail('no usage attributed to the key')

  // 7. Analytics reflect it (get_spend via the same key)
  const spend = JSON.parse((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_spend', arguments: { days: 1 } } })).result.content[0].text)
  spend.requests > 0 ? pass(`analytics reflect it (get_spend: ${spend.requests} req, $${spend.cost_usd})`) : fail('analytics did not update')
} finally {
  await rest(`usage_events?api_key_id=eq.${cleanup.keyId}`, { method: 'DELETE' }).catch(() => {})
  if (cleanup.keyId) await rest(`api_keys?id=eq.${cleanup.keyId}`, { method: 'DELETE' }).catch(() => {})
  if (cleanup.projId) await rest(`projects?id=eq.${cleanup.projId}`, { method: 'DELETE' }).catch(() => {})
  await rest(`members?id=eq.${mem.id}`, { method: 'DELETE' }).catch(() => {}); await adm(`admin/users/${uid}`, { method: 'DELETE' }).catch(() => {})
  console.log('\n(cleaned up)')
}
console.log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green — end-to-end works'} ===\n`)
