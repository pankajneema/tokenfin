import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { persistRows, persistPrompts, scopedEventId } from './persist'
import { clearMemberCache } from './auth'
import { deriveMetricEvents, memoryMetricState } from './metrics'
import { invalidateOrgPrices } from '@/lib/pricing-overrides'
import type { UsageRow } from './normalize'
import type { KeyCtx } from './auth'

/** Records every round trip: table ops (when awaited) and RPCs. */
function recordingAdmin(opts: { duplicateIds?: Set<string>; members?: Array<{ email: string; user_id: string }> } = {}) {
  const trips: Array<{ kind: string; name: string; payload?: any }> = []
  const admin: any = {
    from(table: string) {
      let upserted: any[] | null = null
      let op = 'select'
      const b: any = new Proxy({}, {
        get(_t, p) {
          if (p === 'then') return (res: any) => {
            trips.push({ kind: 'table', name: `${table}.${op}`, payload: upserted })
            const data = upserted ? upserted.filter(r => !opts.duplicateIds?.has(r.event_id)).map((r, i) => ({ id: `id${i}`, event_id: r.event_id })) : []
            res({ data, error: null })
          }
          if (p === 'maybeSingle') return () => { trips.push({ kind: 'table', name: `${table}.maybeSingle` }); return Promise.resolve({ data: { id: 'proj-first' }, error: null }) }
          if (p === 'upsert') return (r: any) => { op = 'upsert'; upserted = Array.isArray(r) ? r : [r]; return b }
          return () => b
        },
      })
      return b
    },
    rpc(name: string, payload: any) {
      trips.push({ kind: 'rpc', name, payload })
      return Promise.resolve({ data: name === 'org_member_ids_by_email' ? (opts.members ?? []) : 1, error: null })
    },
    trips,
  }
  return admin
}

const ORG = 'org-a'
const ctx = (over: Partial<KeyCtx> = {}): KeyCtx => ({ orgId: ORG, projectId: 'proj1', keyId: 'key1', userId: null, timezone: 'UTC', capturePrompts: true, ...over })
const row = (i: number, over: Partial<UsageRow> = {}): UsageRow => ({
  event_id: `claude_code:req_${i}`, ts: new Date(Date.UTC(2026, 8, 29, 10, i)).toISOString(), source: 'claude_code',
  provider_request_id: `req_${i}`, correlation_id: 'p1', model: 'claude-sonnet-4-6',
  input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
  cost_usd: 0.001, cost_basis: 'notional', user_email: 'Dev@Acme.test', session_id: 's1', ...over,
})

beforeEach(() => { invalidateOrgPrices(); clearMemberCache() })
afterEach(() => { delete process.env.CAPTURE_PROMPTS })

describe('persistRows batching', () => {
  it('writes a 20-record export in one usage_events round trip (warm caches)', async () => {
    const admin = recordingAdmin()
    await persistRows(admin, ctx({ userId: 'u1' }), Array.from({ length: 20 }, (_, i) => row(i)))   // warms prices
    admin.trips.length = 0
    const res = await persistRows(admin, ctx({ userId: 'u1' }), Array.from({ length: 20 }, (_, i) => row(i + 100)))
    expect(res).toEqual({ inserted: 20, duplicate: 0 })
    expect(admin.trips.map((t: any) => t.name)).toEqual(['usage_events.upsert'])   // notional → no usage_agg
  })

  it('metered rows add exactly one usage_agg batch RPC, pre-summed per project·model·day', async () => {
    const admin = recordingAdmin()
    await persistRows(admin, ctx({ userId: 'u1' }), Array.from({ length: 20 }, (_, i) => row(i, { cost_basis: 'metered', source: 'ingest' })))
    const agg = admin.trips.filter((t: any) => t.name === 'upsert_usage_agg_batch')
    expect(agg).toHaveLength(1)
    expect(agg[0].payload.rows).toHaveLength(1)
    expect(agg[0].payload.rows[0]).toMatchObject({ p_requests: 20, p_project_id: 'proj1', p_bucket: '2026-09-29' })
  })

  it('org-scopes event ids and only aggregates rows that were really inserted', async () => {
    const admin = recordingAdmin({ duplicateIds: new Set([`${ORG}:claude_code:req_0`]) })
    const res = await persistRows(admin, ctx({ userId: 'u1' }), [row(0, { cost_basis: 'metered' }), row(1, { cost_basis: 'metered' })])
    expect(res).toEqual({ inserted: 1, duplicate: 1 })
    const up = admin.trips.find((t: any) => t.name === 'usage_events.upsert')
    expect(up.payload.map((r: any) => r.event_id)).toEqual([`${ORG}:claude_code:req_0`, `${ORG}:claude_code:req_1`])
    const agg = admin.trips.find((t: any) => t.name === 'upsert_usage_agg_batch')
    expect(agg.payload.rows[0].p_requests).toBe(1)
    expect(scopedEventId(ORG, `direct:${ORG}:k`)).toBe(`direct:${ORG}:k`)
  })

  it('attributes shared-key rows to the member with the reported email (one lookup)', async () => {
    const admin = recordingAdmin({ members: [{ email: 'dev@acme.test', user_id: 'user-dev' }] })
    await persistRows(admin, ctx(), [row(0), row(1)])
    expect(admin.trips.filter((t: any) => t.name === 'org_member_ids_by_email')).toHaveLength(1)
    const up = admin.trips.find((t: any) => t.name === 'usage_events.upsert')
    expect(up.payload.every((r: any) => r.user_id === 'user-dev')).toBe(true)
    admin.trips.length = 0
    await persistRows(admin, ctx(), [row(2)])
    expect(admin.trips.filter((t: any) => t.name === 'org_member_ids_by_email')).toHaveLength(0)   // cached
  })

  it('stores redacted prompt text in one RPC, and none when the org disallows capture', async () => {
    const admin = recordingAdmin()
    const withText = (i: number) => row(i, { prompt_text: `deploy with key sk-live-${'x'.repeat(20)} to ops@acme.test`, prompt_preview: 'mail ops@acme.test' })
    await persistRows(admin, ctx({ userId: 'u1' }), [withText(0), withText(1)])
    const cap = admin.trips.filter((t: any) => t.name === 'insert_prompt_captures')
    expect(cap).toHaveLength(1)
    expect(cap[0].payload.p_rows[0].prompt_text).toBe('deploy with key [REDACTED_API_KEY] to [REDACTED_EMAIL]')
    expect(admin.trips.find((t: any) => t.name === 'usage_events.upsert').payload[0].prompt_preview).toBe('mail [REDACTED_EMAIL]')

    const off = recordingAdmin()
    await persistRows(off, ctx({ userId: 'u1', capturePrompts: false }), [withText(0)])
    expect(off.trips.filter((t: any) => t.name === 'insert_prompt_captures')).toHaveLength(0)
    expect(off.trips.find((t: any) => t.name === 'usage_events.upsert').payload[0].prompt_preview).toBeNull()

    process.env.CAPTURE_PROMPTS = '0'
    const envOff = recordingAdmin()
    expect(await persistPrompts(envOff, ctx(), [{ prompt_id: 'p', prompt_text: 'hi', prompt_chars: 2, ts: new Date().toISOString(), source: 'claude_code', user_email: null }])).toBe(0)
    expect(envOff.trips).toHaveLength(0)
  })
})

describe('metric state claims', () => {
  const kv = (key: string, s: string) => ({ key, value: { stringValue: s } })
  const body = (input: number, time: number) => ({ resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [{ metrics: [
    { name: 'codex.turn.token_usage', sum: { aggregationTemporality: 2, dataPoints: [
      { timeUnixNano: time, asInt: input, attributes: [kv('type', 'input'), kv('model', 'gpt-5'), kv('conversation.id', 'c1')] },
    ] } },
  ] }] }] })

  it('advances state in one call and reports what it claimed (for compensation)', async () => {
    const calls: number[] = []
    const mem = memoryMetricState()
    const st = { advance: async (e: any[]) => { calls.push(e.length); return mem.advance(e) } }
    const first = await deriveMetricEvents(body(100, 1e15), ctx(), st)
    expect(first.rows).toHaveLength(0)
    expect(first.claims).toEqual([{ key: expect.any(String), value: 100, prev: null }])
    const second = await deriveMetricEvents(body(160, 2e15), ctx(), st)
    expect(second.rows[0].input_tokens).toBe(60)
    expect(second.claims[0]).toMatchObject({ value: 160, prev: 100 })
    expect(calls).toEqual([1, 1])
    // A stale / out-of-order export can't move the counter backwards (GREATEST).
    const stale = await deriveMetricEvents(body(130, 3e15), ctx(), st)
    expect(stale.rows).toHaveLength(0)
    expect(mem.m.get(second.claims[0].key)).toBe(160)
  })
})
