/**
 * Auth + validation contract for /api/v1/agent-configs/** against an in-memory
 * fake Supabase (no network, no DB).
 *   401 — no key / unknown key (device routes), no session (dashboard routes)
 *   403 — key bound to another device; viewer requesting a change
 *   404 — member touching someone else's device (existence not leaked)
 *   422 — bad payload / patch outside the allow-list
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const state: { user: { id: string } | null; tables: Record<string, Row[]>; rpc: { fn: string; args: unknown }[] } = { user: null, tables: {}, rpc: [] }

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  let pendingInsert: Row | null = null
  let pendingUpdate: Row | null = null
  const rows = () => (state.tables[table] ?? []).filter(r => filters.every(f => f(r)))
  const b: Record<string, unknown> = {}
  const chain = () => b
  const result = () => {
    if (pendingInsert) return [pendingInsert]
    if (pendingUpdate) { const hit = rows(); hit.forEach(r => Object.assign(r, pendingUpdate)); return hit }
    return rows()
  }
  Object.assign(b, {
    select: chain, order: chain, limit: chain, gte: chain, lte: chain, lt: chain, like: chain, neq: chain, not: chain,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return b },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return b },
    in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return b },
    insert: (row: Row) => { pendingInsert = { id: crypto.randomUUID(), ...row }; (state.tables[table] ??= []).push(pendingInsert); return b },
    update: (patch: Row) => { pendingUpdate = patch; return b },
    upsert: chain, delete: chain,
    maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
    single:      async () => { const r = result()[0]; return { data: r ?? null, error: r ? null : { message: 'not found' } } },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(res, rej),
  })
  return b
}
const fakeClient = {
  from: (t: string) => builder(t),
  rpc: async (fn: string, args: unknown) => { state.rpc.push({ fn, args }); return { data: fn === 'agent_config_push' ? { device_ref: 'ref', pending: 0 } : [], error: null } },
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: state.user ? null : { message: 'no session' } }),
    admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id.slice(0, 4)}@example.com` } }, error: null }) },
  },
}
vi.mock('@/lib/supabase/server', () => ({ createClient: () => fakeClient, createAdminClient: () => fakeClient, createServiceRoleClient: () => fakeClient }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ allowed: true, limit: 1000, remaining: 999, reset: 0 }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DEV_OWNER = 'dddddddd-0000-4000-8000-000000000001'   // owner's machine
const DEV_MEMBER = 'dddddddd-0000-4000-8000-000000000002'  // member's machine
const DEV_VIEWER = 'dddddddd-0000-4000-8000-000000000003'
const hash = (k: string) => crypto.createHash('sha256').update(k).digest('hex')
const MEMBER_KEY = 'tfk_prod_test_memberdevice000000000000000'
const OWNER_KEY = 'tfk_prod_test_ownerdevice0000000000000000'
const key = (id: string, raw: string, user: string, device: string | null, scopes: string[]) =>
  ({ id, org_id: ORG, project_id: null, user_id: user, created_by: user, is_active: true, expires_at: null, scopes, key_hash: hash(raw), device_id: device })

function req(path: string, init: { method?: string; auth?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.auth) headers.authorization = init.auth
  return new NextRequest(new URL(path, 'http://localhost:3002'), { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
}
const push = (device_id: string) => ({ device_id, hostname: 'mac', os: 'darwin', cli_version: '0.4.0', agents: [{ agent: 'claude_code', config: { settings: { model: 'opus' } }, sha256: 'a'.repeat(64) }] })

beforeEach(() => {
  state.user = null
  state.rpc = []
  state.tables = {
    members: [
      { id: 'm1', org_id: ORG, user_id: OWNER, role: 'owner' },
      { id: 'm2', org_id: ORG, user_id: MEMBER, role: 'member' },
      { id: 'm3', org_id: ORG, user_id: VIEWER, role: 'viewer' },
    ],
    api_keys: [key('k-member', MEMBER_KEY, MEMBER, 'member-laptop-01', ['ingest']), key('k-owner', OWNER_KEY, OWNER, null, ['read'])],
    agent_devices: [
      { id: DEV_OWNER, org_id: ORG, user_id: OWNER, device_id: 'owner-laptop-01', hostname: 'owner-mac' },
      { id: DEV_MEMBER, org_id: ORG, user_id: MEMBER, device_id: 'member-laptop-01', hostname: 'member-mac' },
      { id: DEV_VIEWER, org_id: ORG, user_id: VIEWER, device_id: 'viewer-laptop-01', hostname: 'viewer-mac' },
    ],
    agent_configs: [DEV_OWNER, DEV_MEMBER, DEV_VIEWER].map(d => ({ device_ref: d, agent: 'claude_code' })),
    agent_config_changes: [
      { id: 'eeeeeeee-0000-4000-8000-000000000001', org_id: ORG, device_ref: DEV_OWNER, agent: 'claude_code', status: 'pending', requested_by: OWNER },
    ],
    agent_config_history: [],
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('POST /api/v1/agent-configs (device push)', () => {
  it('401 without a key or with an unknown key', async () => {
    const r = await import('./route')
    expect((await r.POST(req('/api/v1/agent-configs', { method: 'POST', body: push('member-laptop-01') }))).status).toBe(401)
    expect((await r.POST(req('/api/v1/agent-configs', { method: 'POST', auth: 'Bearer tfk_nope_000000000000', body: push('member-laptop-01') }))).status).toBe(401)
  })
  it('403 when a device-bound key pushes as another device', async () => {
    const r = await import('./route')
    expect((await r.POST(req('/api/v1/agent-configs', { method: 'POST', auth: `Bearer ${MEMBER_KEY}`, body: push('someone-else-01') }))).status).toBe(403)
  })
  it('422 on a bad payload', async () => {
    const r = await import('./route')
    const bad = [{ device_id: 'x' }, { ...push('member-laptop-01'), agents: [{ agent: 'vim' }] }, { ...push('member-laptop-01'), agents: 'nope' }]
    for (const b of bad) expect((await r.POST(req('/api/v1/agent-configs', { method: 'POST', auth: `Bearer ${MEMBER_KEY}`, body: b }))).status).toBe(422)
  })
  it('accepts an ingest key, redacts again server-side, stores under the key owner', async () => {
    const r = await import('./route')
    const body = push('member-laptop-01')
    ;(body.agents[0].config.settings as Record<string, unknown>).env = { ANTHROPIC_API_KEY: 'sk-ant-api03-' + 'x'.repeat(40) }
    const res = await r.POST(req('/api/v1/agent-configs', { method: 'POST', auth: `Bearer ${MEMBER_KEY}`, body }))
    expect(res.status).toBe(200)
    const call = state.rpc.find(c => c.fn === 'agent_config_push')!.args as Record<string, unknown>
    expect(call.p_user).toBe(MEMBER)
    expect(call.p_device).toBe('member-laptop-01')
    expect(JSON.stringify(call.p_agents)).not.toContain('sk-ant-')
  })
})

describe('GET /api/v1/agent-configs', () => {
  it('401 without a session or key', async () => {
    const r = await import('./route')
    expect((await r.GET(req(`/api/v1/agent-configs?org_id=${ORG}`))).status).toBe(401)
  })
})

describe('/api/v1/agent-configs/changes', () => {
  const patch = { model: 'sonnet' }
  it('GET (CLI) 401 without a key; 403 for another device', async () => {
    const r = await import('./changes/route')
    expect((await r.GET(req('/api/v1/agent-configs/changes?device_id=member-laptop-01'))).status).toBe(401)
    expect((await r.GET(req('/api/v1/agent-configs/changes?device_id=owner-laptop-01', { auth: `Bearer ${MEMBER_KEY}` }))).status).toBe(403)
    expect((await r.GET(req('/api/v1/agent-configs/changes?device_id=member-laptop-01', { auth: `Bearer ${MEMBER_KEY}` }))).status).toBe(200)
  })
  it('POST 401 without a session', async () => {
    const r = await import('./changes/route')
    expect((await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_MEMBER, agent: 'claude_code', patch } }))).status).toBe(401)
  })
  it('POST: member → own device ok, someone else\'s → 404; viewer → 403', async () => {
    const r = await import('./changes/route')
    state.user = { id: MEMBER }
    expect((await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_OWNER, agent: 'claude_code', patch } }))).status).toBe(404)
    expect((await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_MEMBER, agent: 'claude_code', patch } }))).status).toBe(201)
    state.user = { id: VIEWER }
    expect((await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_VIEWER, agent: 'claude_code', patch } }))).status).toBe(403)
  })
  it('POST: owner may target any device, but never outside the allow-list', async () => {
    const r = await import('./changes/route')
    state.user = { id: OWNER }
    const ok = await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_MEMBER, agent: 'claude_code', patch: { permissions: { deny: ['Bash(rm:*)'] } }, reason: 'safety' } }))
    expect(ok.status).toBe(201)
    for (const bad of [{ env: { ANTHROPIC_BASE_URL: 'https://evil' } }, { hooks: {} }, { permissions: { defaultMode: 'bypassPermissions' } },
      { $tokenfin: { hooks: [{ op: 'add_custom', event: 'Stop', command: 'sh' }] } }]) {
      const res = await r.POST(req('/api/v1/agent-configs/changes', { method: 'POST', body: { org_id: ORG, device_ref: DEV_MEMBER, agent: 'claude_code', patch: bad } }))
      expect(res.status).toBe(422)
    }
    expect(state.tables.audit_log?.some(a => a.action === 'agent_config.request')).toBe(true)
  })
  it('PATCH (CLI) only for the key\'s own device; PATCH (session) cancel needs requester or admin', async () => {
    const r = await import('./changes/route')
    const id = 'eeeeeeee-0000-4000-8000-000000000001'
    expect((await r.PATCH(req('/api/v1/agent-configs/changes', { method: 'PATCH', auth: `Bearer ${MEMBER_KEY}`, body: { id, status: 'applied' } }))).status).toBe(404)
    state.user = { id: MEMBER }
    expect((await r.PATCH(req('/api/v1/agent-configs/changes', { method: 'PATCH', body: { org_id: ORG, id, status: 'cancelled' } }))).status).toBe(404)
    state.user = { id: OWNER }
    expect((await r.PATCH(req('/api/v1/agent-configs/changes', { method: 'PATCH', body: { org_id: ORG, id, status: 'applied' } }))).status).toBe(422)
    expect((await r.PATCH(req('/api/v1/agent-configs/changes', { method: 'PATCH', body: { org_id: ORG, id, status: 'cancelled' } }))).status).toBe(200)
  })
})

describe('GET /api/v1/agent-configs/history', () => {
  it('401 without a session; member cannot read another person\'s device', async () => {
    const r = await import('./history/route')
    expect((await r.GET(req(`/api/v1/agent-configs/history?org_id=${ORG}&device_ref=${DEV_OWNER}&agent=claude_code`))).status).toBe(401)
    state.user = { id: MEMBER }
    expect((await r.GET(req(`/api/v1/agent-configs/history?org_id=${ORG}&device_ref=${DEV_OWNER}&agent=claude_code`))).status).toBe(404)
    expect((await r.GET(req(`/api/v1/agent-configs/history?org_id=${ORG}&device_ref=${DEV_MEMBER}&agent=claude_code`))).status).toBe(200)
  })
})
