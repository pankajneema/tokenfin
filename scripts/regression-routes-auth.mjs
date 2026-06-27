#!/usr/bin/env node
/**
 * Authenticated end-to-end regression for the LIMITS / ALERTS / NOTIFICATIONS
 * API routes. Creates a throwaway user, makes them an admin of a test org,
 * mints a real Supabase session cookie, and drives the actual route handlers
 * over HTTP (full CRUD + RBAC + cross-org IDOR), then cleans everything up.
 *
 * Run: cd web && npm run dev   then   node scripts/regression-routes-auth.mjs
 */
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:3001'
const env = {}
for (const line of readFileSync(new URL('../web/.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const REF = new URL(SUPA).hostname.split('.')[0]
const STORAGE_KEY = `sb-${REF}-auth-token`

const rest = (p, o = {}) => fetch(`${SUPA}/rest/v1/${p}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(o.headers || {}) } }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${p} -> ${r.status} ${t}`); return t ? JSON.parse(t) : null })
const admin = (path, o = {}) => fetch(`${SUPA}/auth/v1/${path}`, { ...o, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(o.headers || {}) } })

const log = (...a) => console.log(...a)
const pass = m => log(`  \x1b[32m✓\x1b[0m ${m}`)
const fail = m => { log(`  \x1b[31m✗\x1b[0m ${m}`); process.exitCode = 1 }

// Build the @supabase/ssr cookie (base64- prefix, chunked into .0/.1…)
function sessionCookies(session) {
  const full = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64')
  const SIZE = 3180, chunks = []
  for (let i = 0; i < full.length; i += SIZE) chunks.push(full.slice(i, i + SIZE))
  return chunks.map((c, i) => `${STORAGE_KEY}.${i}=${c}`).join('; ')
}
const api = (cookie) => (path, o = {}) => fetch(`${BASE}${path}`, { ...o, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(o.headers || {}) } })

async function main() {
  log('\n=== Authenticated route regression: limits / alerts / notifications ===\n')

  // org with a project
  const orgs = await rest('orgs?select=id,name')
  let org, proj
  for (const o of orgs) { const [p] = await rest(`projects?select=id&org_id=eq.${o.id}&limit=1`); if (p) { org = o; proj = p; break } }
  const otherOrg = orgs.find(o => o.id !== org.id) // for IDOR test
  log(`Org: ${org.name} (${org.id})`)

  // throwaway user
  const email = `qa+${REF}-${org.id.slice(0, 8)}@example.com`
  const password = 'Test-Passw0rd!' + REF.slice(0, 4)
  // clean any prior
  const existing = await admin('admin/users?per_page=200').then(r => r.json()).then(d => (d.users || []).find(u => u.email === email))
  if (existing) await admin(`admin/users/${existing.id}`, { method: 'DELETE' })
  const createdUser = await admin('admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then(r => r.json())
  const uid = createdUser.id
  if (!uid) throw new Error('user create failed: ' + JSON.stringify(createdUser))
  const [member] = await rest('members', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, role: 'admin' }) })
  pass(`created throwaway admin user ${email}`)

  // sign in → session (admin generate-link + OTP verify; bypasses captcha)
  const gl = await admin('admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) }).then(r => r.json())
  const otp = gl.email_otp || gl.properties?.email_otp
  const session = await fetch(`${SUPA}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, token: otp }) }).then(r => r.json())
  if (!session.access_token) throw new Error('signin failed: ' + JSON.stringify(session))
  const cookie = sessionCookies(session)
  const A = api(cookie)
  const created = { limits: [], alerts: [], notifs: [] }

  try {
    // ── self-check: auth actually works ──
    const sc = await A('/api/v1/notifications')
    if (sc.status !== 200) { fail(`AUTH SELF-CHECK FAILED — notifications GET → ${sc.status}; cannot trust route tests`); return }
    pass('auth self-check: session cookie accepted (notifications GET → 200)')

    // ── LIMITS CRUD ──
    log('\nLimits:')
    let r = await A('/api/v1/limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'org', period: 'monthly', budget_usd: 100, warn_at: 70, throttle_at: 90, block_at: 100 }) })
    const lim = await r.json().catch(() => ({}))
    const limId = Array.isArray(lim) ? lim[0]?.id : lim?.id
    if ((r.status === 200 || r.status === 201) && limId) { pass(`POST limit → ${r.status}`); created.limits.push(limId) } else fail(`POST limit → ${r.status} ${JSON.stringify(lim)}`)

    r = await A(`/api/v1/limits?org_id=${org.id}`); const list = await r.json()
    Array.isArray(list) && list.some(l => l.id === limId) ? pass('GET limits includes new row') : fail('GET limits missing new row')

    r = await A('/api/v1/limits', { method: 'PATCH', body: JSON.stringify({ id: limId, budget_usd: 250, block_at: 95 }) })
    r.status === 200 ? pass('PATCH limit → 200') : fail(`PATCH limit → ${r.status}`)
    const [check] = await rest(`limits?select=budget_usd,block_at&id=eq.${limId}`)
    Number(check.budget_usd) === 250 && Number(check.block_at) === 95 ? pass('PATCH persisted (budget=250, block_at=95)') : fail(`PATCH not persisted: ${JSON.stringify(check)}`)

    r = await A(`/api/v1/limits?id=${limId}`, { method: 'DELETE' })
    r.status === 200 ? pass('DELETE limit → 200') : fail(`DELETE limit → ${r.status}`)
    const gone = await rest(`limits?select=id&id=eq.${limId}`)
    gone.length === 0 ? (pass('limit row deleted'), created.limits.pop()) : fail('limit row still present')

    // bad body → 422 (before any DB op)
    r = await A('/api/v1/limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'bogus', period: 'monthly', budget_usd: -5 }) })
    r.status === 422 ? pass('POST invalid body → 422 (zod)') : fail(`POST invalid body → ${r.status} (expected 422)`)

    // threshold ordering: block_at < throttle_at must be rejected
    r = await A('/api/v1/limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'org', period: 'monthly', budget_usd: 100, warn_at: 50, throttle_at: 90, block_at: 80 }) })
    r.status === 422 ? pass('POST out-of-order thresholds → 422') : fail(`POST out-of-order thresholds → ${r.status} (expected 422)`)

    // scope=project without project_id must be rejected
    r = await A('/api/v1/limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'project', period: 'monthly', budget_usd: 100 }) })
    r.status === 422 ? pass('POST scope=project without project_id → 422') : fail(`POST scope=project without project_id → ${r.status} (expected 422)`)

    // PATCH that would invert thresholds must be rejected (merge-validated)
    const [tmpLim] = await rest('limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'org', period: 'monthly', budget_usd: 100, warn_at: 50, throttle_at: 70, block_at: 90, is_active: true }) })
    created.limits.push(tmpLim.id)
    r = await A('/api/v1/limits', { method: 'PATCH', body: JSON.stringify({ id: tmpLim.id, block_at: 40 }) })
    r.status === 422 ? pass('PATCH inverting thresholds → 422 (merge-validated)') : fail(`PATCH inverting thresholds → ${r.status} (expected 422)`)
    await rest(`limits?id=eq.${tmpLim.id}`, { method: 'DELETE' }); created.limits.pop()

    // ── ALERTS CRUD ──
    log('\nAlerts:')
    r = await A('/api/v1/alerts', { method: 'POST', body: JSON.stringify({ org_id: org.id, name: 'QA threshold', trigger_type: 'threshold', condition: 'cost>100', scope: 'All projects', threshold: 100, cooldown_hours: 4 }) })
    const al = await r.json().catch(() => ({})); const alId = Array.isArray(al) ? al[0]?.id : al?.id
    if ((r.status === 200 || r.status === 201) && alId) { pass(`POST alert → ${r.status}`); created.alerts.push(alId) } else fail(`POST alert → ${r.status} ${JSON.stringify(al)}`)

    // threshold trigger without a threshold value must be rejected
    r = await A('/api/v1/alerts', { method: 'POST', body: JSON.stringify({ org_id: org.id, name: 'no threshold', trigger_type: 'threshold', cooldown_hours: 4 }) })
    r.status === 422 ? pass('POST threshold alert w/o threshold → 422') : fail(`POST threshold alert w/o threshold → ${r.status} (expected 422)`)

    // alert with all channels off must be rejected
    r = await A('/api/v1/alerts', { method: 'POST', body: JSON.stringify({ org_id: org.id, name: 'no channels', trigger_type: 'anomaly', cooldown_hours: 4, channels: { email: false, slack: false, webhook: false, inapp: false } }) })
    r.status === 422 ? pass('POST alert with no channels → 422') : fail(`POST alert with no channels → ${r.status} (expected 422)`)

    r = await A(`/api/v1/alerts?org_id=${org.id}`); const alist = await r.json()
    Array.isArray(alist) && alist.some(a => a.id === alId) ? pass('GET alerts includes new rule') : fail('GET alerts missing new rule')

    r = await A('/api/v1/alerts', { method: 'PATCH', body: JSON.stringify({ id: alId, is_active: false }) })
    r.status === 200 ? pass('PATCH alert (toggle) → 200') : fail(`PATCH alert → ${r.status}`)
    const [acheck] = await rest(`alert_rules?select=is_active&id=eq.${alId}`)
    acheck.is_active === false ? pass('PATCH toggle persisted (is_active=false)') : fail(`toggle not persisted: ${JSON.stringify(acheck)}`)

    r = await A(`/api/v1/alerts?id=${alId}`, { method: 'DELETE' })
    r.status === 200 ? (pass('DELETE alert → 200'), created.alerts.pop()) : fail(`DELETE alert → ${r.status}`)

    // ── NOTIFICATIONS ──
    log('\nNotifications:')
    const [n1] = await rest('notifications', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, title: 'QA test notification', body: 'hello', type: 'info', is_read: false }) })
    created.notifs.push(n1.id)
    r = await A('/api/v1/notifications'); const notifs = await r.json()
    const found = notifs.find(n => n.dbId === n1.id)
    found ? pass(`GET notifications returns new (read=${found.read})`) : fail('GET notifications missing new row')
    // invoice/sales_inquiry must be excluded
    const [inv] = await rest('notifications', { method: 'POST', body: JSON.stringify({ org_id: org.id, title: 'QA invoice', type: 'invoice', is_read: false }) })
    created.notifs.push(inv.id)
    const notifs2 = await A('/api/v1/notifications').then(x => x.json())
    notifs2.some(n => n.dbId === inv.id) ? fail('invoice notification leaked into GET') : pass('invoice/sales_inquiry excluded from GET')

    r = await A('/api/v1/notifications', { method: 'PATCH', body: JSON.stringify({ id: n1.id }) })
    const [nr] = await rest(`notifications?select=is_read&id=eq.${n1.id}`)
    r.status === 200 && nr.is_read === true ? pass('PATCH {id} marked read') : fail(`PATCH {id} → ${r.status}, is_read=${nr?.is_read}`)

    await rest('notifications', { method: 'POST', body: JSON.stringify({ org_id: org.id, user_id: uid, title: 'QA test 2', type: 'info', is_read: false }) }).then(([x]) => created.notifs.push(x.id))
    await A('/api/v1/notifications', { method: 'PATCH', body: JSON.stringify({ all: true }) })
    const unread = await rest(`notifications?select=id&org_id=eq.${org.id}&is_read=eq.false`)
    unread.length === 0 ? pass('PATCH {all:true} cleared all unread for org') : fail(`${unread.length} unread remain after mark-all`)

    // ── RBAC: viewer cannot write ──
    log('\nRBAC + IDOR:')
    await rest(`members?id=eq.${member.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'viewer' }) })
    r = await A('/api/v1/limits', { method: 'POST', body: JSON.stringify({ org_id: org.id, scope: 'org', period: 'monthly', budget_usd: 10 }) })
    r.status === 403 ? pass('viewer POST limit → 403 (RBAC enforced)') : fail(`viewer POST limit → ${r.status} (expected 403)`)
    await rest(`members?id=eq.${member.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })

    // ── IDOR: cannot touch another org's limit ──
    if (otherOrg) {
      const [foreign] = await rest('limits', { method: 'POST', body: JSON.stringify({ org_id: otherOrg.id, scope: 'org', period: 'monthly', budget_usd: 50 }) })
      r = await A('/api/v1/limits', { method: 'PATCH', body: JSON.stringify({ id: foreign.id, budget_usd: 999 }) })
      r.status === 403 || r.status === 404 ? pass(`cross-org PATCH → ${r.status} (IDOR blocked)`) : fail(`cross-org PATCH → ${r.status} (expected 403/404)`)
      const [fchk] = await rest(`limits?select=budget_usd&id=eq.${foreign.id}`)
      Number(fchk.budget_usd) === 50 ? pass('foreign limit unchanged') : fail('foreign limit was modified!')
      await rest(`limits?id=eq.${foreign.id}`, { method: 'DELETE' })
    }
  } finally {
    for (const id of created.limits) await rest(`limits?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    for (const id of created.alerts) await rest(`alert_rules?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    for (const id of created.notifs) await rest(`notifications?id=eq.${id}`, { method: 'DELETE' }).catch(() => {})
    await rest(`members?id=eq.${member.id}`, { method: 'DELETE' }).catch(() => {})
    await admin(`admin/users/${uid}`, { method: 'DELETE' }).catch(() => {})
    log('\n(cleaned up user, membership, and all test rows)')
  }
  log(`\n=== ${process.exitCode ? 'FAILURES' : 'all green'} ===\n`)
}
main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
