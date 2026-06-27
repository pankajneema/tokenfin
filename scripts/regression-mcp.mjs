// Live MCP protocol test: initialize → tools/list → tools/call, plus auth guards.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
const BASE = 'http://localhost:3001'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY
const rest = (p, o = {}) => fetch(`${SUPA}/rest/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`); const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

const rpc = (key, body, extra = {}) => fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra }, body: JSON.stringify(body) })

console.log('\n=== MCP server regression ===\n')
const orgs = await rest('orgs?select=id'); let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
const raw = `tfk_mcp_${proj.id.replace(/-/g, '').slice(0, 4)}_${crypto.randomBytes(16).toString('hex')}`
const [key] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'mcp test (auto)', key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 12) + '••••', env: 'production', scopes: ['read'], is_active: true }) })

try {
  // auth guards
  let r = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize' })
  r.status === 401 && r.headers.get('www-authenticate') ? pass('no-auth → 401 + WWW-Authenticate') : fail(`no-auth → ${r.status}`)
  r = await rpc('tfk_bogus', { jsonrpc: '2.0', id: 1, method: 'initialize' })
  r.status === 401 ? pass('bad key → 401') : fail(`bad key → ${r.status}`)
  r = await rpc(raw, { jsonrpc: '2.0', id: 1, method: 'initialize' }, { Origin: 'https://evil.com' })
  r.status === 403 ? pass('browser Origin → 403 (DNS-rebinding guard)') : fail(`origin → ${r.status}`)

  // initialize
  r = await rpc(raw, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  const init = await r.json()
  init.result?.serverInfo?.name === 'tokenfin' && init.result?.capabilities?.tools ? pass(`initialize → serverInfo=${init.result.serverInfo.name}, protocol=${init.result.protocolVersion}`) : fail(`initialize bad: ${JSON.stringify(init)}`)
  r.headers.get('mcp-session-id') ? pass('Mcp-Session-Id header issued') : fail('no Mcp-Session-Id')

  // notification → 202 no body
  r = await rpc(raw, { jsonrpc: '2.0', method: 'notifications/initialized' })
  r.status === 202 ? pass('notifications/initialized → 202') : fail(`initialized → ${r.status}`)

  // tools/list
  r = await rpc(raw, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const list = (await r.json()).result?.tools ?? []
  const names = list.map(t => t.name)
  const expected = ['list_projects', 'get_spend', 'get_usage_by_model', 'get_daily_costs', 'get_budget_status']
  expected.every(n => names.includes(n)) ? pass(`tools/list → ${names.join(', ')}`) : fail(`tools/list missing: ${JSON.stringify(names)}`)
  list.every(t => t.annotations?.readOnlyHint === true) ? pass('all tools annotated readOnlyHint:true') : fail('a tool is not marked read-only')

  // tools/call — get_spend
  r = await rpc(raw, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_spend', arguments: { days: 30 } } })
  const call = (await r.json()).result
  const spend = call?.content?.[0]?.text ? JSON.parse(call.content[0].text) : null
  call && !call.isError && typeof spend?.cost_usd === 'number' ? pass(`tools/call get_spend → cost_usd=${spend.cost_usd}, requests=${spend.requests}`) : fail(`get_spend bad: ${JSON.stringify(call)}`)

  // tools/call — list_projects returns the org's project
  r = await rpc(raw, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_projects' } })
  const lp = JSON.parse((await r.json()).result.content[0].text)
  Array.isArray(lp.projects) && lp.projects.some(p => p.id === proj.id) ? pass('tools/call list_projects → includes org project') : fail('list_projects missing project')

  // tools/call — budget status shape
  r = await rpc(raw, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_budget_status' } })
  const bs = JSON.parse((await r.json()).result.content[0].text)
  typeof bs.month_spend_usd === 'number' && Array.isArray(bs.limits) ? pass('tools/call get_budget_status → ok') : fail('budget status bad')

  // unknown tool → JSON-RPC error
  r = await rpc(raw, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'delete_everything' } })
  const ut = await r.json()
  ut.error?.code === -32602 ? pass('unknown tool → JSON-RPC -32602') : fail(`unknown tool → ${JSON.stringify(ut)}`)

  // unknown method → -32601
  r = await rpc(raw, { jsonrpc: '2.0', id: 7, method: 'frobnicate' })
  ;(await r.json()).error?.code === -32601 ? pass('unknown method → -32601') : fail('unknown method not handled')
} finally {
  await rest(`api_keys?id=eq.${key.id}`, { method: 'DELETE' }).catch(() => {})
  console.log('\n(cleaned up test key)')
}
console.log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green'} ===\n`)
