/**
 * sync.ts end-to-end against a LOCAL Supabase + a local mock provider server.
 * Opt-in (skipped by default): set BILLING_SYNC_IT_SUPABASE_URL (must be a
 * localhost URL) and BILLING_SYNC_IT_SERVICE_KEY. Creates a throwaway org and
 * deletes it afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { sealKey } from '@/lib/crypto/key-reveal'
import { syncAll } from './sync'
import { reconcile } from './reconcile'
import { startMockProviders, GOOD_ANTHROPIC_KEY, GOOD_OPENAI_KEY, type MockServer } from './__fixtures__/mock-server'

const URL_ = process.env.BILLING_SYNC_IT_SUPABASE_URL ?? ''
const KEY  = process.env.BILLING_SYNC_IT_SERVICE_KEY ?? ''
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(URL_)

describe.skipIf(!isLocal || !KEY)('billing sync → local DB (integration)', () => {
  let db: SupabaseClient
  let mock: MockServer
  const orgId = crypto.randomUUID()

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET = 'billing-sync-it-secret'
    mock = await startMockProviders()
    process.env.ANTHROPIC_ADMIN_BASE_URL = mock.url
    process.env.OPENAI_ADMIN_BASE_URL = mock.url
    db = createClient(URL_, KEY, { auth: { persistSession: false } })
    const { error } = await db.from('organizations').insert({ id: orgId, name: 'billing-sync-it', slug: `billing-sync-it-${orgId.slice(0, 8)}` })
    if (error) throw error
  })

  afterAll(async () => {
    await db?.from('usage_events').delete().eq('org_id', orgId)
    await db?.from('organizations').delete().eq('id', orgId)   // cascades connections + costs
    delete process.env.ANTHROPIC_ADMIN_BASE_URL; delete process.env.OPENAI_ADMIN_BASE_URL
    await mock?.close()
  })

  it('pulls both providers into provider_costs, idempotently, and records status', async () => {
    const { error } = await db.from('provider_connections').insert([
      { org_id: orgId, provider: 'anthropic', key_enc: sealKey(GOOD_ANTHROPIC_KEY), key_hint: 'sk-ant-admin…xxxx' },
      { org_id: orgId, provider: 'openai',    key_enc: sealKey(GOOD_OPENAI_KEY),    key_hint: 'sk-admin-…yyyy' },
    ])
    expect(error).toBeNull()

    const r1 = await syncAll(db, { orgId })
    expect(r1.map(r => [r.provider, r.ok]).sort()).toEqual([['anthropic', true], ['openai', true]])

    const { data: rows } = await db.from('provider_costs').select('provider, day, line_item, model, cost_usd, output_tokens').eq('org_id', orgId)
    const sum = (p: string) => (rows ?? []).filter(r => r.provider === p).reduce((s, r) => s + Number(r.cost_usd), 0)
    expect(sum('anthropic')).toBeCloseTo(3.8345, 4)
    expect(sum('openai')).toBeCloseTo(1.77, 4)
    expect(rows!.find(r => r.line_item === 'usage:tokens')?.output_tokens).toBe(400)

    const r2 = await syncAll(db, { orgId })       // re-run → upsert, no duplicates
    expect(r2.every(r => r.ok)).toBe(true)
    const { count } = await db.from('provider_costs').select('id', { count: 'exact', head: true }).eq('org_id', orgId)
    expect(count).toBe(rows!.length)

    const { data: conns } = await db.from('provider_connections').select('provider, status, last_error, last_synced_at').eq('org_id', orgId)
    expect(conns!.every(c => c.status === 'ok' && c.last_error === null && c.last_synced_at)).toBe(true)
  })

  it('a rejected key marks the connection as error without touching costs', async () => {
    await db.from('provider_connections').update({ key_enc: sealKey('sk-admin-revoked' + 'r'.repeat(20)) }).eq('org_id', orgId).eq('provider', 'openai')
    const res = await syncAll(db, { orgId })
    const oa = res.find(r => r.provider === 'openai')!
    expect(oa.ok).toBe(false)
    expect(oa.error).toMatch(/openai API 401/)
    const { data: c } = await db.from('provider_connections').select('status, last_error').eq('org_id', orgId).eq('provider', 'openai').single()
    expect(c).toMatchObject({ status: 'error' })
    expect(c!.last_error).not.toContain('revoked')
  })

  it('reconciliation_metered_daily: metered only, provider by model, feeds variance', async () => {
    const { error } = await db.from('usage_events').insert([
      { org_id: orgId, model: 'claude-sonnet-4-6', cost_usd: 3.5, cost_basis: 'metered',  created_at: '2026-09-01T12:00:00Z' },
      { org_id: orgId, model: 'claude-sonnet-4-6', cost_usd: 99,  cost_basis: 'notional', created_at: '2026-09-01T12:00:00Z' },
      { org_id: orgId, model: 'claude-sonnet-4-6', cost_usd: 50,  provider: 'bedrock',    created_at: '2026-09-01T12:00:00Z' },
      { org_id: orgId, model: 'gpt-4o',            cost_usd: 1.0, created_at: '2026-09-01T23:30:00Z' },
    ])
    expect(error).toBeNull()
    const { data: metered, error: e2 } = await db.rpc('reconciliation_metered_daily', { p_org: orgId, p_since: '2026-08-30' })
    expect(e2).toBeNull()
    expect((metered as { day: string; provider: string; cost_usd: number }[]).map(m => [m.day, m.provider, Number(m.cost_usd)]).sort())
      .toEqual([['2026-09-01', 'anthropic', 3.5], ['2026-09-01', 'openai', 1]])

    const { data: costs } = await db.from('provider_costs').select('day, provider, cost_usd').eq('org_id', orgId).neq('line_item', 'usage:tokens')
    const rows = reconcile(costs!, metered as never, ['anthropic', 'openai'])
    const a = rows.find(r => r.day === '2026-09-01' && r.provider === 'anthropic')!
    expect(a.providerCost).toBeCloseTo(3.7345, 4)
    expect(a.variancePct).toBeCloseTo(6.3, 1)
    expect(a.flagged).toBe(false)
    const o = rows.find(r => r.day === '2026-09-01' && r.provider === 'openai')!
    expect(o.variancePct).toBeCloseTo(42.9, 1)
    expect(o.flagged).toBe(true)
  })
})
