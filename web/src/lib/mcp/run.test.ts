import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { KeyCtx } from './types'

// ── fakes ────────────────────────────────────────────────────────────────────
const tables: Record<string, { data: unknown }> = {}
function chain(table: string) {
  const res = () => tables[table] ?? { data: null }
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit', 'gte', 'gt']) b[m] = () => b
  b.maybeSingle = () => Promise.resolve(res())
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad)
  return b
}
const fakeAdmin = {
  from: (t: string) => chain(t),
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: id === 'member-1' ? 'Member@Org.test' : 'owner@org.test' } } }) } },
}
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => fakeAdmin }))
vi.mock('@/lib/org-timezone', () => ({ getOrgTimezone: async () => 'UTC' }))
const rollups = vi.hoisted(() => ({
  dashBreakdown: vi.fn(),
  dashSessions: vi.fn(),
  dashPrompts: vi.fn(),
  dashSummary: vi.fn(),
}))
vi.mock('@/lib/rollups', () => rollups)
vi.mock('@/lib/eval/judge', () => ({ judgeFaithfulness: vi.fn(), judgeCorrectness: vi.fn() }))
vi.mock('@/lib/eval/config', () => ({ resolveJudge: vi.fn() }))

import { runTool } from './run'
import { resolveKeyIdentity } from './auth'

const owner: KeyCtx = { keyId: 'k1', orgId: 'org', projectId: null, userId: 'owner-1', scopes: ['read'], role: 'owner', scopeUserId: null }
const member: KeyCtx = { keyId: 'k2', orgId: 'org', projectId: null, userId: 'member-1', scopes: ['read'], role: 'member', scopeUserId: 'member-1' }

const bd = (keys: string[]) => ({ rows: keys.map(k => ({ key: k, cost_usd: 1, metered_cost_usd: 1, notional_cost_usd: 0, vendor_cost_usd: 0, requests: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 0, avg_latency_ms: null, active_days: 1, users: 1 })), other: null, total_keys: keys.length })

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  for (const f of Object.values(rollups)) f.mockReset()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('resolveKeyIdentity (mirrors lib/api/auth lookupApiKey)', () => {
  it('uses the owner role and scopes members to themselves', () => {
    expect(resolveKeyIdentity({ user_id: 'u1' }, 'admin')).toEqual({ userId: 'u1', role: 'admin', scopeUserId: null })
    expect(resolveKeyIdentity({ user_id: 'u1' }, 'member')).toEqual({ userId: 'u1', role: 'member', scopeUserId: 'u1' })
    expect(resolveKeyIdentity({ user_id: null, created_by: 'c1' }, 'viewer')).toMatchObject({ userId: 'c1', scopeUserId: 'c1' })
  })
  it('rejects a personal key whose owner left; org key falls back to member', () => {
    expect(resolveKeyIdentity({ user_id: 'gone' }, null)).toBeNull()
    expect(resolveKeyIdentity({ user_id: null, created_by: 'gone' }, null)).toMatchObject({ role: 'member', scopeUserId: 'gone' })
  })
  it('treats an unknown role string as viewer', () => {
    expect(resolveKeyIdentity({ user_id: 'u' }, 'superuser')).toMatchObject({ role: 'viewer', scopeUserId: 'u' })
  })
})

describe('get_breakdown scoping', () => {
  it('owner sees every member', async () => {
    rollups.dashBreakdown.mockResolvedValue(bd(['a@org.test', 'b@org.test']))
    const r = await runTool('get_breakdown', { dim: 'member', days: 7 }, owner) as { rows: { key: string }[] }
    expect(rollups.dashBreakdown).toHaveBeenCalledTimes(1)
    expect(rollups.dashBreakdown.mock.calls[0][5]).toEqual({})
    expect(r.rows).toHaveLength(2)
  })
  it('member dim=member is forced to their own user keys', async () => {
    rollups.dashBreakdown.mockResolvedValue(bd(['member@org.test']))
    await runTool('get_breakdown', { dim: 'member' }, member)
    const keys = rollups.dashBreakdown.mock.calls.map(c => c[5].user_key)
    expect(keys.sort()).toEqual(['member-1', 'member@org.test'])
  })
  it('member asking for another user gets nothing and no query runs', async () => {
    const r = await runTool('get_breakdown', { dim: 'model', filters: { user_key: 'boss@org.test' } }, member) as { rows: unknown[] }
    expect(rollups.dashBreakdown).not.toHaveBeenCalled()
    expect(r.rows).toEqual([])
  })
  it('member may still see org totals by model (analytics:view)', async () => {
    rollups.dashBreakdown.mockResolvedValue(bd(['opus']))
    await runTool('get_breakdown', { dim: 'model' }, member)
    expect(rollups.dashBreakdown.mock.calls[0][5]).toEqual({})
  })
})

describe('sessions and prompts scoping', () => {
  it('member get_sessions only queries their own keys', async () => {
    rollups.dashSessions.mockResolvedValue({ total: 0, rows: [] })
    await runTool('get_sessions', { filters: { user_key: 'boss@org.test' } }, member)
    expect(rollups.dashSessions).not.toHaveBeenCalled()
    await runTool('get_sessions', {}, member)
    expect(rollups.dashSessions.mock.calls.map(c => c[4].user_key).sort()).toEqual(['member-1', 'member@org.test'])
  })
  it('get_session hides another user\'s session', async () => {
    tables.usage_sessions = { data: { session_id: 's1', user_key: 'boss@org.test' } }
    expect(await runTool('get_session', { session_id: 's1' }, member)).toEqual({ found: false, session_id: 's1' })
    tables.organizations = { data: { capture_prompts: false } }
    tables.usage_events = { data: [{ model: 'm', prompt_preview: 'secret' }] }
    const r = await runTool('get_session', { session_id: 's1' }, owner) as { found: boolean; events: Record<string, unknown>[] }
    expect(r.found).toBe(true)
    expect(r.events[0]).not.toHaveProperty('prompt_preview') // capture off → no text
  })
  it('get_prompts returns redacted text only when capture is on', async () => {
    rollups.dashPrompts.mockResolvedValue({ total: 1, rows: [{ prompt_key: 'p1', user_key: 'owner@org.test', cost_usd: 1, last_at: '', total_tokens: 1, requests: 1 }] })
    tables.usage_events = { data: [{ correlation_id: 'p1', prompt_preview: 'use key sk-abcdefghijklmnopqrstuv please' }] }
    tables.organizations = { data: { capture_prompts: true } }
    const on = await runTool('get_prompts', {}, owner) as { prompts: { prompt_preview?: string }[] }
    expect(on.prompts[0].prompt_preview).toContain('[REDACTED')
    expect(on.prompts[0].prompt_preview).not.toContain('sk-abcdef')
    tables.organizations = { data: { capture_prompts: false } }
    const off = await runTool('get_prompts', {}, owner) as { prompts: Record<string, unknown>[] }
    expect(off.prompts[0]).not.toHaveProperty('prompt_preview')
  })
})

describe('other tools', () => {
  it('forecast runs MTD + trailing summaries', async () => {
    rollups.dashSummary.mockResolvedValue({ series: [] })
    const r = await runTool('get_mtd_and_forecast', {}, owner) as { projected_month_end: unknown }
    expect(rollups.dashSummary).toHaveBeenCalledTimes(2)
    expect(r.projected_month_end).toEqual({ cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0 })
  })
  it('member cannot forecast someone else', async () => {
    await expect(runTool('get_mtd_and_forecast', { filters: { user_key: 'boss@org.test' } }, member)).rejects.toThrow(/own spend/)
  })
  it('get_insights degrades gracefully when the route is absent', async () => {
    const f = vi.fn(async (_url: string) => new Response('nf', { status: 404 }))
    vi.stubGlobal('fetch', f)
    const r = await runTool('get_insights', {}, { ...owner, forward: { baseUrl: 'http://x', authorization: 'Bearer k' } })
    expect(r).toMatchObject({ available: false })
    expect(f.mock.calls[0][0]).toContain('/api/v1/insights?org_id=org')
    expect(await runTool('get_insights', {}, owner)).toMatchObject({ available: false })
  })
  it('evaluate needs an owner/admin key', async () => {
    await expect(runTool('evaluate', { evaluator: 'faithfulness', answer: 'x' }, member)).rejects.toThrow(/owner or admin/)
  })
})
