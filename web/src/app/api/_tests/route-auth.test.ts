/**
 * Auth-failure contract for key API routes, against an in-memory fake Supabase
 * (no network, no DB). Asserts:
 *   401 — no session / no key / unknown key / bad CRON_SECRET
 *   403 — valid session but wrong org or role; valid key with the wrong scope
 * Success paths are covered elsewhere (and live on the local stack).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

// ── Fake Supabase ────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const state: { user: { id: string } | null; tables: Record<string, Row[]> } = { user: null, tables: {} }

function builder(table: string) {
  const filters: [string, unknown][] = []
  const rows = () => (state.tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
  const b: Record<string, unknown> = {}
  const chain = () => b
  Object.assign(b, {
    select: chain, order: chain, limit: chain, in: chain, gte: chain, lte: chain, lt: chain, like: chain, is: chain, neq: chain,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single:      async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    update: chain, insert: chain, upsert: chain, delete: chain,
  })
  return b
}
const fakeClient = {
  from: (t: string) => builder(t),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { message: 'no session' } }),
    admin: { listUsers: async () => ({ data: { users: [] }, error: null }) },
  },
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => fakeClient,
  createAdminClient: () => fakeClient,
  createServiceRoleClient: () => fakeClient,
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ allowed: true, limit: 1000, remaining: 999, reset: 0 }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────
const ORG   = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const hash = (k: string) => crypto.createHash('sha256').update(k).digest('hex')
const INGEST_KEY = 'tfk_prod_test_ingestonly0000000000000000'
const READ_KEY   = 'tfk_prod_test_readonly00000000000000000000'
const org = { timezone: 'UTC', capture_prompts: true, projects: [] }
const key = (id: string, raw: string, scopes: string[]) => ({
  id, org_id: ORG, project_id: null, user_id: null, created_by: OWNER, is_active: true, expires_at: null,
  scopes, last_used_at: new Date().toISOString(), key_hash: hash(raw), organizations: org,
})

function req(path: string, init: { method?: string; auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.auth) headers.authorization = init.auth
  return new NextRequest(new URL(path, 'http://localhost:3002'), {
    method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

beforeEach(() => {
  state.user = null
  state.tables = {
    members: [
      { id: 'm1', org_id: ORG, user_id: OWNER,  role: 'owner',  joined_at: '2026-01-01' },
      { id: 'm2', org_id: ORG, user_id: MEMBER, role: 'member', joined_at: '2026-01-02' },
    ],
    api_keys: [key('k-ingest', INGEST_KEY, ['ingest']), key('k-read', READ_KEY, ['read'])],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => { vi.restoreAllMocks() })

// ── Session-guarded admin routes ──────────────────────────────────────────────
describe('session-guarded routes', () => {
  it('401 without a session', async () => {
    const keys  = await import('@/app/api/v1/keys/route')
    const audit = await import('@/app/api/v1/audit/route')
    const mem   = await import('@/app/api/v1/members/route')
    expect((await keys.GET(req(`/api/v1/keys?org_id=${ORG}`))).status).toBe(401)
    expect((await audit.GET(req(`/api/v1/audit?org_id=${ORG}`))).status).toBe(401)
    expect((await mem.GET(req(`/api/v1/members?org_id=${ORG}`))).status).toBe(401)
    const post = await keys.POST(req('/api/v1/keys', { method: 'POST', body: { org_id: ORG, project_id: ORG, user_id: OWNER, name: 'x' } }))
    expect(post.status).toBe(401)
  })

  it('403 for a user outside the org', async () => {
    state.user = { id: OWNER }
    const keys = await import('@/app/api/v1/keys/route')
    expect((await keys.GET(req(`/api/v1/keys?org_id=${OTHER}`))).status).toBe(403)
  })

  it('403 for the wrong role', async () => {
    state.user = { id: MEMBER }
    const keys  = await import('@/app/api/v1/keys/route')
    const audit = await import('@/app/api/v1/audit/route')
    const limits = await import('@/app/api/v1/limits/route')
    const post = await keys.POST(req('/api/v1/keys', { method: 'POST', body: { org_id: ORG, project_id: ORG, user_id: MEMBER, name: 'x' } }))
    expect(post.status).toBe(403)
    expect((await audit.GET(req(`/api/v1/audit?org_id=${ORG}`))).status).toBe(403)
    const lim = await limits.POST(req('/api/v1/limits', { method: 'POST', body: { org_id: ORG, scope: 'org', metric: 'cost', period: 'monthly', value: 10 } }))
    expect([403, 422]).toContain(lim.status)   // 422 if the body schema rejects first — never 2xx
    expect(lim.status).not.toBeLessThan(400)
  })
})

describe('fake sanity (guards pass for the right caller)', () => {
  it('owner session and read key get through the guard', async () => {
    state.tables.audit_log = []
    state.user = { id: OWNER }
    const audit = await import('@/app/api/v1/audit/route')
    expect((await audit.GET(req(`/api/v1/audit?org_id=${ORG}`))).status).toBe(200)
    state.user = null
    const limits = await import('@/app/api/v1/limits/route')
    expect((await limits.GET(req('/api/v1/limits', { auth: `Bearer ${READ_KEY}` }))).status).toBe(200)
  })
})

// ── API-key read routes ─────────────────────────────────────────────────────
describe('API-key read routes', () => {
  it('401 without a key or session', async () => {
    const analytics = await import('@/app/api/v1/analytics/route')
    const limits    = await import('@/app/api/v1/limits/route')
    expect((await analytics.GET(req(`/api/v1/analytics?org_id=${ORG}`))).status).toBe(401)
    expect((await limits.GET(req(`/api/v1/limits?org_id=${ORG}`))).status).toBe(401)
  })

  it('401 for an unknown bearer key (never falls through to the session)', async () => {
    state.user = { id: OWNER }
    const analytics = await import('@/app/api/v1/analytics/route')
    const res = await analytics.GET(req(`/api/v1/analytics?org_id=${ORG}`, { auth: 'Bearer tfk_prod_nope_000000000000' }))
    expect(res.status).toBe(401)
  })

  it('403 for an ingest-only key', async () => {
    const analytics = await import('@/app/api/v1/analytics/route')
    const limits    = await import('@/app/api/v1/limits/route')
    expect((await analytics.GET(req('/api/v1/analytics', { auth: `Bearer ${INGEST_KEY}` }))).status).toBe(403)
    expect((await limits.GET(req('/api/v1/limits', { auth: `Bearer ${INGEST_KEY}` }))).status).toBe(403)
  })
})

// ── Ingest (write) ──────────────────────────────────────────────────────────
describe('ingest', () => {
  it('401 without a key or with an unknown key', async () => {
    const ingest = await import('@/app/api/v1/ingest/route')
    expect((await ingest.POST(req('/api/v1/ingest', { method: 'POST', body: { model: 'x' } }))).status).toBe(401)
    expect((await ingest.POST(req('/api/v1/ingest', { method: 'POST', auth: 'Bearer tfk_prod_unknown_0000000000', body: { model: 'x' } }))).status).toBe(401)
  })
  it('403 for a read-only key', async () => {
    const ingest = await import('@/app/api/v1/ingest/route')
    expect((await ingest.POST(req('/api/v1/ingest', { method: 'POST', auth: `Bearer ${READ_KEY}`, body: { model: 'x' } }))).status).toBe(403)
  })
})

// ── Cron (CRON_SECRET, fail closed) ─────────────────────────────────────────
describe('cron routes', () => {
  type CronMod = { GET: (r: NextRequest) => Promise<Response> }
  const JOBS: Record<string, () => Promise<CronMod>> = {
    alerts:     () => import('@/app/api/v1/cron/alerts/route'),
    retention:  () => import('@/app/api/v1/cron/retention/route'),
    digest:     () => import('@/app/api/v1/cron/digest/route'),
    reconcile:  () => import('@/app/api/v1/cron/reconcile/route'),
    connectors: () => import('@/app/api/v1/cron/connectors/route'),
    prices:     () => import('@/app/api/v1/cron/prices/route'),
  }
  const saved = process.env.CRON_SECRET
  afterEach(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved })

  it.each(Object.keys(JOBS))('%s: 401 when CRON_SECRET is unset, missing or wrong', async job => {
    const mod = await JOBS[job]()
    delete process.env.CRON_SECRET
    expect((await mod.GET(req(`/api/v1/cron/${job}`, { auth: 'Bearer ' }))).status).toBe(401)
    process.env.CRON_SECRET = 'test-cron-secret'
    expect((await mod.GET(req(`/api/v1/cron/${job}`))).status).toBe(401)
    expect((await mod.GET(req(`/api/v1/cron/${job}`, { auth: 'Bearer wrong-secret-value' }))).status).toBe(401)
    expect((await mod.GET(req(`/api/v1/cron/${job}`, { auth: 'test-cron-secret' }))).status).toBe(401)
  })
})
