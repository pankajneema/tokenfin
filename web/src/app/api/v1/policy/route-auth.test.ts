/**
 * Auth contract for GET /api/v1/policy, the limits API's new validation and
 * /api/v1/routes, against an in-memory fake Supabase (no network, no DB).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const state: { user: { id: string } | null; tables: Record<string, Row[]>; rpcs: string[] } = { user: null, tables: {}, rpcs: [] }

function builder(table: string) {
  const filters: [string, unknown][] = []
  let inserted: Row | null = null
  const rows = () => (state.tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
  const b: Record<string, unknown> = {}
  const chain = () => b
  Object.assign(b, {
    select: chain, order: chain, limit: chain, in: chain, gte: chain, lte: chain, lt: chain, gt: chain, is: chain, neq: chain, update: chain, delete: chain,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b },
    insert: (r: Row) => { inserted = { id: 'new-id', ...r }; (state.tables[table] ??= []).push(inserted); return b },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: inserted ?? rows()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  })
  return b
}
const fakeClient = {
  from: (t: string) => builder(t),
  rpc: async (name: string) => { state.rpcs.push(name); return { data: null, error: null } },
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { message: 'no session' } }),
    admin: { getUserById: async () => ({ data: { user: null } }) },
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: () => fakeClient, createAdminClient: () => fakeClient }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

const ORG = '11111111-1111-4111-8111-111111111111'
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const hash = (k: string) => crypto.createHash('sha256').update(k).digest('hex')
const INGEST_KEY = 'tfk_prod_test_ingest_policy_000000000000'
const READ_KEY = 'tfk_prod_test_read_policy_00000000000000'
const OTHER_KEY = 'tfk_prod_test_other_scope_0000000000000'
const key = (id: string, raw: string, scopes: string[]) => ({
  id, org_id: ORG, project_id: null, user_id: null, created_by: OWNER, is_active: true, expires_at: null, scopes, key_hash: hash(raw),
})
function req(path: string, init: { method?: string; auth?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) }
  if (init.auth) headers.authorization = init.auth
  return new NextRequest(new URL(path, 'http://localhost:3002'), { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
}

beforeEach(() => {
  state.user = null; state.rpcs = []
  state.tables = {
    members: [{ org_id: ORG, user_id: OWNER, role: 'owner' }, { org_id: ORG, user_id: MEMBER, role: 'member' }],
    api_keys: [key('k-ingest', INGEST_KEY, ['ingest']), key('k-read', READ_KEY, ['read']), key('k-other', OTHER_KEY, ['billing'])],
    model_routes: [{ id: 'r1', org_id: ORG, from_model: 'claude-opus', to_model: 'claude-sonnet-4-6', match: 'prefix', is_active: true, origin: 'auto' }],
    model_blocks: [{ id: 'b1', org_id: ORG, model: 'claude-3-opus', is_active: true }],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => { vi.restoreAllMocks() })

describe('GET /api/v1/policy', () => {
  it('401 without a Bearer key (a session is not enough) and for an unknown key', async () => {
    const { GET } = await import('./route')
    state.user = { id: OWNER }
    expect((await GET(req('/api/v1/policy'))).status).toBe(401)
    expect((await GET(req('/api/v1/policy', { auth: 'Bearer tfk_nope' }))).status).toBe(401)
  })
  it('403 for a key with neither read nor ingest scope', async () => {
    const { GET } = await import('./route')
    expect((await GET(req('/api/v1/policy', { auth: `Bearer ${OTHER_KEY}` }))).status).toBe(403)
  })
  it('200 for ingest and read keys: routes, blocks, version, ETag / 304', async () => {
    const { GET } = await import('./route')
    for (const k of [INGEST_KEY, READ_KEY]) {
      const res = await GET(req('/api/v1/policy', { auth: `Bearer ${k}` }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.routes).toEqual([{ from: 'claude-opus', to: 'claude-sonnet-4-6', match: 'prefix' }])
      expect(body.blocked_models).toEqual(['claude-3-opus'])
      expect(body.version).toMatch(/^[0-9a-f]{16}$/)
      const etag = res.headers.get('etag')!
      expect((await GET(req('/api/v1/policy', { auth: `Bearer ${k}`, headers: { 'if-none-match': etag } }))).status).toBe(304)
    }
    expect(state.rpcs).toContain('policy_fetch_touch')
  })
})

describe('limits + routes writes', () => {
  it('401 without a session', async () => {
    const limits = await import('../limits/route')
    const routes = await import('../routes/route')
    const body = { org_id: ORG, scope: 'org', period: 'weekly', model: 'claude-opus', metric: 'tokens', amount: 1e6 }
    expect((await limits.POST(req('/api/v1/limits', { method: 'POST', body }))).status).toBe(401)
    expect((await routes.DELETE(req('/api/v1/routes?id=r1', { method: 'DELETE' }))).status).toBe(401)
    expect((await routes.POST(req('/api/v1/routes', { method: 'POST', body: { org_id: ORG, from_model: 'a', to_model: 'b' } }))).status).toBe(401)
  })
  it('403 for a member (limits:write needs owner/admin)', async () => {
    state.user = { id: MEMBER }
    const limits = await import('../limits/route')
    const routes = await import('../routes/route')
    const body = { org_id: ORG, scope: 'org', period: 'weekly', model: 'claude-opus', metric: 'tokens', amount: 1e6 }
    expect((await limits.POST(req('/api/v1/limits', { method: 'POST', body }))).status).toBe(403)
    expect((await routes.DELETE(req('/api/v1/routes?id=r1', { method: 'DELETE' }))).status).toBe(403)
  })
  it('422 for invalid model-limit bodies (before any write)', async () => {
    state.user = { id: OWNER }
    const limits = await import('../limits/route')
    const base = { org_id: ORG, scope: 'org', period: 'weekly', amount: 10 }
    const bad = [
      { ...base, auto_action: 'switch_model', switch_to: 'x' },                               // action without a model
      { ...base, model: 'claude-opus', auto_action: 'switch_model' },                         // no switch_to
      { ...base, model: 'claude-opus', auto_action: 'switch_model', switch_to: 'claude-opus-4-8' }, // matches its own prefix
      { ...base, model: 'bad model!' },
      { ...base, scope: 'member' },                                                            // member without user_id
      { ...base, metric: 'tokens', amount: undefined },
    ]
    for (const b of bad) expect((await limits.POST(req('/api/v1/limits', { method: 'POST', body: b }))).status).toBe(422)
  })
  it('owner creates a model limit: amount in value, budget_usd 0 (never read by the legacy spend gate)', async () => {
    state.user = { id: OWNER }
    state.tables.limits = []
    const limits = await import('../limits/route')
    const res = await limits.POST(req('/api/v1/limits', { method: 'POST', body: {
      org_id: ORG, scope: 'org', period: 'weekly', model: 'claude-opus', metric: 'cost_usd', amount: 25,
      auto_action: 'switch_model', switch_to: 'claude-sonnet-4-6' } }))
    expect(res.status).toBe(201)
    expect(state.tables.limits[0]).toMatchObject({ model: 'claude-opus', value: 25, budget_usd: 0, notify_at: 90, auto_action: 'switch_model', switch_to: 'claude-sonnet-4-6' })
    const legacy = await limits.POST(req('/api/v1/limits', { method: 'POST', body: { org_id: ORG, scope: 'org', period: 'monthly', budget_usd: 100 } }))
    expect(legacy.status).toBe(201)
    expect(state.tables.limits[1]).toMatchObject({ model: null, value: 100, budget_usd: 100, metric: 'cost_usd' })
  })
})
