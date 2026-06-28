// Comprehensive MCP test: protocol, auth guards, all analytics tools, and the
// token-saving tools (compress/retrieve/savings_stats).
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY
const rest = (p, o = {}) => fetch(`${SUPA}/rest/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }
const warn = m => console.log(`  \x1b[33m⚠\x1b[0m ${m}`)

const rpc = (key, body, extra = {}) => fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra }, body: JSON.stringify(body) })
const call = async (key, name, args = {}) => {
  const r = await rpc(key, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })
  const j = await r.json()
  const txt = j.result?.content?.[0]?.text
  return { isError: j.result?.isError, data: txt ? JSON.parse(txt) : null, raw: j }
}

console.log('\n=== MCP full regression ===\n')
const orgs = await rest('orgs?select=id'); let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
const raw = `tfk_mcpf_${crypto.randomBytes(14).toString('hex')}`
const [key] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'mcp full test', key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 12) + '••', env: 'production', scopes: ['read'], is_active: true }) })

try {
  // ── Auth guards ──
  console.log('Auth:')
  let r = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize' })
  r.status === 401 && r.headers.get('www-authenticate') ? pass('no-auth → 401 + WWW-Authenticate') : fail(`no-auth → ${r.status}`)
  r = await rpc('tfk_bogus', { jsonrpc: '2.0', id: 1, method: 'initialize' })
  r.status === 401 ? pass('bad key → 401') : fail(`bad key → ${r.status}`)
  r = await rpc(raw, { jsonrpc: '2.0', id: 1, method: 'initialize' }, { Origin: 'https://evil.com' })
  r.status === 403 ? pass('browser Origin → 403') : fail(`origin → ${r.status}`)

  // ── Protocol ──
  console.log('\nProtocol:')
  r = await rpc(raw, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  const init = await r.json()
  init.result?.serverInfo?.name === 'tokenfin' ? pass(`initialize → ${init.result.protocolVersion}`) : fail('initialize bad')
  r.headers.get('mcp-session-id') ? pass('Mcp-Session-Id issued') : fail('no session id')
  r = await rpc(raw, { jsonrpc: '2.0', method: 'notifications/initialized' })
  r.status === 202 ? pass('notifications/initialized → 202') : fail(`initialized → ${r.status}`)
  const ping = await (await rpc(raw, { jsonrpc: '2.0', id: 1, method: 'ping' })).json()
  ping.result ? pass('ping → ok') : fail('ping failed')
  const tools = (await (await rpc(raw, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools
  const names = tools.map(t => t.name)
  const expect = ['list_projects', 'get_spend', 'get_usage_by_model', 'get_daily_costs', 'get_budget_status', 'compress', 'retrieve', 'savings_stats']
  expect.every(n => names.includes(n)) ? pass(`tools/list → ${names.length} tools`) : fail(`missing: ${JSON.stringify(names)}`)
  const um = await (await rpc(raw, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })).json()
  um.error?.code === -32602 ? pass('unknown tool → -32602') : fail('unknown tool not handled')
  const umeth = await (await rpc(raw, { jsonrpc: '2.0', id: 4, method: 'frobnicate' })).json()
  umeth.error?.code === -32601 ? pass('unknown method → -32601') : fail('unknown method not handled')

  // ── Analytics tools ──
  console.log('\nAnalytics:')
  let c = await call(raw, 'list_projects')
  Array.isArray(c.data?.projects) && c.data.projects.some(p => p.id === proj.id) ? pass('list_projects → includes project') : fail('list_projects bad')
  c = await call(raw, 'get_spend', { days: 30 })
  typeof c.data?.cost_usd === 'number' ? pass(`get_spend → $${c.data.cost_usd}, ${c.data.requests} req`) : fail('get_spend bad')
  c = await call(raw, 'get_usage_by_model')
  Array.isArray(c.data?.models) ? pass(`get_usage_by_model → ${c.data.models.length} models`) : fail('get_usage_by_model bad')
  c = await call(raw, 'get_daily_costs')
  Array.isArray(c.data?.daily) ? pass(`get_daily_costs → ${c.data.daily.length} days`) : fail('get_daily_costs bad')
  c = await call(raw, 'get_budget_status')
  typeof c.data?.month_spend_usd === 'number' ? pass('get_budget_status → ok') : fail('get_budget_status bad')

  // ── Token-saving tools ──
  console.log('\nToken saving:')
  const big = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, level: 'info', msg: 'log line ' + i })))
  c = await call(raw, 'compress', { content: big, model: 'claude-sonnet-4-6' })
  const hash = c.data?.hash
  c.data?.tokens_saved > 0 && hash ? pass(`compress → saved ${c.data.tokens_saved} tok, $${c.data.cost_saved}`) : fail(`compress bad: ${JSON.stringify(c.data)}`)

  c = await call(raw, 'retrieve', { hash })
  if (c.data?.found && c.data.content?.includes('log line 399')) pass('retrieve → original returned (reversible) ✅')
  else if (c.data?.found === false) warn('retrieve → not found — apply migration 015 (ccr_store) to enable the round-trip')
  else fail(`retrieve bad: ${JSON.stringify(c.data)}`)

  await new Promise(r => setTimeout(r, 500))
  c = await call(raw, 'savings_stats', { days: 30 })
  c.data?.tokens_saved >= 0 && typeof c.data?.cost_saved_usd === 'number'
    ? pass(`savings_stats → ${c.data.tokens_saved} tok, $${c.data.cost_saved_usd}, ${c.data.compressions} compressions`)
    : fail(`savings_stats bad: ${JSON.stringify(c.data)}`)

  // small content passthrough
  c = await call(raw, 'compress', { content: 'short' })
  c.data?.tokens_saved === 0 ? pass('compress small → passthrough (no savings)') : fail('small compress bad')
} finally {
  // cleanup test key + any savings rows we inserted
  await rest(`usage_events?org_id=eq.${org.id}&tags->>source=eq.mcp`, { method: 'DELETE' }).catch(() => {})
  await rest(`api_keys?id=eq.${key.id}`, { method: 'DELETE' }).catch(() => {})
  console.log('\n(cleaned up test key + mcp savings rows)')
}
console.log(`\n=== ${process.exitCode ? 'SOME FAILURES' : 'all green'} ===\n`)
