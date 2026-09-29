/**
 * Connector sync end-to-end against a LOCAL Supabase + the local mock vendor
 * server. Opt-in (skipped by default): set CONNECTORS_IT_SUPABASE_URL (must be
 * a localhost URL) and CONNECTORS_IT_SERVICE_KEY. Creates a throwaway org and
 * deletes it afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { sealKey } from '@/lib/crypto/key-reveal'
import { syncAllConnectors } from './sync'
import { syncAll as syncBilling } from '@/lib/billing-sync/sync'
import { startMockConnectors, GOOD_CLAUDE_KEY, GOOD_CURSOR_KEY, GOOD_GH_TOKEN, GH_ORG, type MockServer } from './__fixtures__/mock-server'

const URL_ = process.env.CONNECTORS_IT_SUPABASE_URL ?? ''
const KEY  = process.env.CONNECTORS_IT_SERVICE_KEY ?? ''
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(URL_)
const NOW = new Date('2026-09-29T12:00:00Z')

describe.skipIf(!isLocal || !KEY)('connector sync → local DB (integration)', () => {
  let db: SupabaseClient
  let mock: MockServer
  const orgId = crypto.randomUUID()

  beforeAll(async () => {
    process.env.KEY_ENCRYPTION_SECRET = 'connectors-it-secret'
    mock = await startMockConnectors()
    process.env.ANTHROPIC_ADMIN_BASE_URL = mock.url
    process.env.CURSOR_API_BASE_URL = mock.url
    process.env.GITHUB_API_BASE_URL = mock.url
    db = createClient(URL_, KEY, { auth: { persistSession: false } })
    const { error } = await db.from('organizations').insert({ id: orgId, name: 'tfit-connectors', slug: `tfit-connectors-${orgId.slice(0, 8)}` })
    if (error) throw error
  })

  afterAll(async () => {
    await db?.from('usage_events').delete().eq('org_id', orgId)
    await db?.from('organizations').delete().eq('id', orgId)   // cascades connections, usage, PRs, map
    delete process.env.ANTHROPIC_ADMIN_BASE_URL; delete process.env.CURSOR_API_BASE_URL; delete process.env.GITHUB_API_BASE_URL
    await mock?.close()
  })

  it('syncs all four connectors idempotently and leaves billing sync alone', async () => {
    const { error } = await db.from('provider_connections').insert([
      { org_id: orgId, provider: 'claude_code_analytics', key_enc: sealKey(GOOD_CLAUDE_KEY), key_hint: 'x' },
      { org_id: orgId, provider: 'cursor',                key_enc: sealKey(GOOD_CURSOR_KEY), key_hint: 'x' },
      { org_id: orgId, provider: 'github_copilot',        key_enc: sealKey(GOOD_GH_TOKEN),   key_hint: 'x', config: { github_org: GH_ORG } },
      { org_id: orgId, provider: 'github',                key_enc: sealKey(GOOD_GH_TOKEN),   key_hint: 'x', config: { repos: ['acme/web'] } },
    ])
    expect(error).toBeNull()

    const r1 = await syncAllConnectors(db, { orgId, now: NOW })
    expect(r1.map(r => [r.provider, r.ok, r.error ?? null]).sort()).toEqual([
      ['claude_code_analytics', true, null], ['cursor', true, null], ['github', true, null], ['github_copilot', true, null],
    ])
    // Billing sync must ignore connector rows (they are not anthropic/openai).
    expect(await syncBilling(db, { orgId })).toEqual([])

    const count = async (t: string) => (await db.from(t).select('id', { count: 'exact', head: true }).eq('org_id', orgId)).count
    const usage1 = await count('coding_tool_usage'); const prs1 = await count('merged_prs')
    expect(usage1).toBeGreaterThan(5)
    expect(prs1).toBe(2)

    const r2 = await syncAllConnectors(db, { orgId, now: NOW })
    expect(r2.every(r => r.ok)).toBe(true)
    expect(await count('coding_tool_usage')).toBe(usage1)
    expect(await count('merged_prs')).toBe(prs1)
    const { data: pr12 } = await db.from('merged_prs').select('additions, author_email').eq('org_id', orgId).eq('number', 12).single()
    expect(pr12).toEqual({ additions: 120, author_email: 'octo@acme.test' })   // not clobbered by the "known" re-sync

    const { data: cost } = await db.from('coding_tool_usage').select('tool, cost_usd, cost_basis').eq('org_id', orgId).gt('cost_usd', 0)
    const sum = (t: string) => (cost ?? []).filter(c => c.tool === t).reduce((s, c) => s + Number(c.cost_usd), 0)
    expect(sum('claude_code_analytics')).toBeCloseTo(3.63, 4)
    expect(sum('cursor')).toBeCloseTo(0.2286232, 5)
    expect(sum('github_copilot')).toBeCloseTo(2.3, 4)
    expect(cost!.some(c => c.tool === 'claude_code_analytics' && c.cost_basis === 'notional')).toBe(true)
  })

  it('a rejected key marks only that connection as error, without the key', async () => {
    const bad = 'key_revoked_' + 'r'.repeat(30)
    await db.from('provider_connections').update({ key_enc: sealKey(bad) }).eq('org_id', orgId).eq('provider', 'cursor')
    const res = await syncAllConnectors(db, { orgId, now: NOW })
    expect(res.find(r => r.provider === 'cursor')).toMatchObject({ ok: false })
    expect(res.filter(r => r.provider !== 'cursor').every(r => r.ok)).toBe(true)
    const { data: c } = await db.from('provider_connections').select('status, last_error').eq('org_id', orgId).eq('provider', 'cursor').single()
    expect(c!.status).toBe('error')
    expect(c!.last_error).toMatch(/cursor API 401/)
    expect(c!.last_error).not.toContain('revoked')
    const { count } = await db.from('coding_tool_usage').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('tool', 'cursor')
    expect(count).toBeGreaterThan(0)     // history kept
  })

  it('merged_pr_costs attributes repo usage by author between merges; coding_tools_summary resolves logins', async () => {
    const ev = (created_at: string, cost: number, repo = 'web', email = 'octo@acme.test') =>
      ({ org_id: orgId, model: 'claude-sonnet-4-6', cost_usd: cost, cost_basis: 'notional', source: 'claude_code', repo, user_email: email, created_at })
    const { error } = await db.from('usage_events').insert([
      ev('2026-09-11T12:00:00Z', 1),                         // → PR 10 (opened 09-11 09:00 .. merged 09-12 10:00)
      ev('2026-09-15T12:00:00Z', 2),                         // → PR 12 (09-12 10:00 .. 09-20 10:00)
      ev('2026-09-16T12:00:00Z', 0.5, 'https://github.com/acme/web.git'),   // URL form, same repo → PR 12
      ev('2026-09-15T12:00:00Z', 7, 'api'),                  // other repo
      ev('2026-09-15T12:00:00Z', 9, 'web', 'else@acme.test'),// other author
      ev('2026-09-21T12:00:00Z', 5),                         // after the last merge
    ])
    expect(error).toBeNull()

    type PrCost = { number: number; user_key: string | null; cost_usd: number; events: number }
    const run = async () => ((await db.rpc('merged_pr_costs', { p_org: orgId, p_since: '2026-07-31T00:00:00Z' })).data ?? []) as PrCost[]
    let rows = await run()
    expect(rows.find(r => r.number === 12)).toMatchObject({ user_key: 'octo@acme.test', events: 2 })
    expect(Number(rows.find(r => r.number === 12)!.cost_usd)).toBeCloseTo(2.5, 6)
    expect(rows.find(r => r.number === 10)).toMatchObject({ user_key: null, events: 0 })   // noreply email → unattributed

    await db.from('github_user_map').insert({ org_id: orgId, login: 'octodev', user_key: 'octo@acme.test' })
    rows = await run()
    expect(rows.find(r => r.number === 10)).toMatchObject({ user_key: 'octo@acme.test', events: 1 })

    const { data: sum, error: e2 } = await db.rpc('coding_tools_summary', { p_org: orgId, p_since: '2026-08-25', p_since_ts: '2026-08-25T00:00:00Z' })
    expect(e2).toBeNull()
    const s = sum as { tool: string; user_key: string; requests: number; lines_added: number }[]
    expect(s.find(r => r.tool === 'github_copilot' && r.user_key === 'octo@acme.test')?.lines_added).toBe(220)
    expect(s.find(r => r.tool === 'github_copilot' && r.user_key === 'github:unmapped-user')).toBeTruthy()
    expect(s.find(r => r.tool === 'otel:claude_code' && r.user_key === 'octo@acme.test')?.requests).toBe(5)
  })
})
