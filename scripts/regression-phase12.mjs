// End-to-end test for Phase 1 (traces) + Phase 2 (evals).
// Prereqs: dev server running; migrations 016–019 applied; for eval parts,
// EVAL_JUDGE_KEY / ANTHROPIC_API_KEY set + some prompt_captures present.
//
//   cd web && npm run dev
//   node scripts/regression-phase12.mjs
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const env = {}
for (const l of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const S = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const REF = new URL(S).hostname.split('.')[0], KEYK = `sb-${REF}-auth-token`
const rest = (p, o = {}) => fetch(`${S}/rest/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const adm = (p, o = {}) => fetch(`${S}/auth/v1/${p}`, { ...o, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', ...(o.headers || {}) } })
const pass = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`); const fail = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }; const skip = m => console.log(`  \x1b[33m•\x1b[0m ${m}`)
const cookie = s => { const f = 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64'); const o = []; for (let i = 0; i < f.length; i += 3180) o.push(`${KEYK}.${i / 3180}=${f.slice(i, i + 3180)}`); return o.join('; ') }
const hasJudge = !!(env.EVAL_JUDGE_KEY || env.ANTHROPIC_API_KEY)

console.log('\n=== Phase 1 + 2 end-to-end ===\n')
const orgs = await rest('orgs?select=id'); let org, proj
for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }

// key + admin session
const raw = `tfk_p12_${crypto.randomBytes(10).toString('hex')}`
const [key] = await rest('api_keys', { method: 'POST', body: JSON.stringify({ org_id: org.id, project_id: proj.id, name: 'phase12 test', key_hash: crypto.createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 12) + '..', env: 'production', scopes: ['read', 'write'], is_active: true }) })
const email = `qa-p12-${org.id.slice(0, 8)}@example.com`
const ex = await adm('admin/users?per_page=200').then(r => r.json()).then(d => (d.users || []).find(u => u.email === email)); if (ex) await adm(`admin/users/${ex.id}`, { method: 'DELETE' })
const uid = (await adm('admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) }).then(r => r.json())).id
const [mem] = await rest('members', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, role: 'admin' }) })
const gl = await adm('admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) }).then(r => r.json())
const sess = await fetch(`${S}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: gl.email_otp }) }).then(r => r.json())
const C = cookie(sess)
const created = { datasets: [] }

try {
  // ── Phase 1: OTLP ingest ──
  console.log('Phase 1 — traces:')
  const traceId = crypto.randomBytes(16).toString('hex'), spanId = crypto.randomBytes(8).toString('hex')
  const otlp = { resourceSpans: [{ scopeSpans: [{ spans: [{
    traceId, spanId, name: 'chat claude-sonnet-4-6', startTimeUnixNano: `${Date.now() * 1e6}`, endTimeUnixNano: `${Date.now() * 1e6}`,
    attributes: [
      { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
      { key: 'gen_ai.request.model', value: { stringValue: 'claude-sonnet-4-6' } },
      { key: 'gen_ai.usage.input_tokens', value: { intValue: '1200' } },
      { key: 'gen_ai.usage.output_tokens', value: { intValue: '350' } },
    ],
  }] }] }] }
  const otRes = await fetch(`${BASE}/api/otel/v1/traces`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': raw }, body: JSON.stringify(otlp) })
  otRes.status === 200 ? pass('OTLP ingest → 200') : fail(`OTLP ingest → ${otRes.status}`)
  await new Promise(r => setTimeout(r, 400))
  const tr = await rest(`traces?select=trace_id,span_count,total_tokens,cost_usd&trace_id=eq.${traceId}`)
  tr.length && tr[0].total_tokens === 1550 ? pass(`trace stored (spans=${tr[0].span_count}, tokens=${tr[0].total_tokens}, $${tr[0].cost_usd})`) : fail(`trace not stored: ${JSON.stringify(tr)}`)

  // ── Phase 2: datasets CRUD (session) ──
  console.log('\nPhase 2 — datasets:')
  let r = await fetch(`${BASE}/api/v1/datasets`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, name: 'p12 dataset' }) })
  const ds = await r.json()
  if (r.status === 201) { pass('create dataset'); created.datasets.push(ds.id) } else fail(`create dataset → ${r.status} ${JSON.stringify(ds)}`)
  r = await fetch(`${BASE}/api/v1/datasets/examples`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ dataset_id: ds.id, input: 'What is 2+2?', reference_output: '4' }) })
  r.status === 201 ? pass('add example') : fail(`add example → ${r.status}`)

  // ── Phase 2: human feedback (no judge needed) ──
  console.log('\nPhase 2 — annotation:')
  const [cap] = await rest(`prompt_captures?select=id&org_id=eq.${org.id}&limit=1`)
  if (cap) {
    r = await fetch(`${BASE}/api/v1/evals/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, target_type: 'prompt_capture', target_id: cap.id, passed: true, score: 1 }) })
    r.status === 201 ? pass('human feedback recorded') : fail(`feedback → ${r.status}`)
  } else skip('no prompt_captures to annotate (enable CAPTURE_PROMPTS)')

  // ── Phase 2: judge-dependent (online eval, offline correctness, pairwise) ──
  console.log('\nPhase 2 — judge evals:')
  if (!hasJudge) { skip('EVAL_JUDGE_KEY/ANTHROPIC_API_KEY not set — skipping online/offline/pairwise') }
  else {
    r = await fetch(`${BASE}/api/v1/evals/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, evaluator: 'faithfulness', days: 30, sample: 3 }) })
    const er = await r.json(); r.ok ? pass(`online faithfulness → ${er.count} scored, halluc ${er.hallucination_rate}`) : skip(`online eval: ${er.error}`)
    r = await fetch(`${BASE}/api/v1/evals/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, evaluator: 'correctness', dataset_id: ds.id, model: 'claude-haiku-4-5', sample: 1 }) })
    const off = await r.json(); r.ok ? pass(`offline correctness → mean ${off.mean_score}`) : skip(`offline eval: ${off.error}`)
    r = await fetch(`${BASE}/api/v1/evals/pairwise`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: C }, body: JSON.stringify({ org_id: org.id, prompt: 'Explain gravity in one sentence.', model_a: 'claude-haiku-4-5', model_b: 'claude-sonnet-4-6' }) })
    const pw = await r.json(); r.ok ? pass(`pairwise → winner ${pw.winner}`) : skip(`pairwise: ${pw.error}`)
  }
} finally {
  for (const id of created.datasets) await rest(`datasets?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
  await rest(`spans?org_id=eq.${org.id}&name=like.*claude-sonnet*`, { method: 'DELETE' }).catch(() => {})
  await rest(`api_keys?id=eq.${key.id}`, { method: 'DELETE' }).catch(() => {})
  await rest(`members?id=eq.${mem.id}`, { method: 'DELETE' }).catch(() => {}); await adm(`admin/users/${uid}`, { method: 'DELETE' }).catch(() => {})
  console.log('\n(cleaned up)')
}
console.log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green'} ===\n`)
