import { describe, it, expect } from 'vitest'
import { eventTimestamp, prepareEvent } from './_core'
import { reconcileClientCost, computeCost } from '@/lib/mcp/pricing'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const ORG = '11111111-1111-1111-1111-111111111111'
const PROJ = '22222222-2222-2222-2222-222222222222'
const env = (over: Partial<Parameters<typeof prepareEvent>[2]> = {}) => ({
  ctx: { orgId: ORG, projectId: null, keyId: 'k1', userId: null, timezone: 'UTC' },
  defaultProjectId: PROJ, validProjects: new Set([PROJ]), prices: [], members: new Map([['dev@acme.test', 'user-dev']]),
  capture: true, now: NOW, ...over,
})

describe('eventTimestamp', () => {
  it('accepts ISO, epoch ms and epoch seconds', () => {
    const iso = '2026-09-28T23:30:00.000Z'
    expect(eventTimestamp(iso, NOW)).toEqual({ ok: true, iso })
    expect(eventTimestamp(Date.parse(iso), NOW)).toEqual({ ok: true, iso })
    expect(eventTimestamp(Date.parse(iso) / 1000, NOW)).toEqual({ ok: true, iso })
    expect(eventTimestamp(String(Date.parse(iso) / 1000), NOW)).toEqual({ ok: true, iso })
  })
  it('defaults to now, clamps the future, rejects garbage', () => {
    expect(eventTimestamp(undefined, NOW)).toEqual({ ok: true, iso: new Date(NOW).toISOString() })
    expect(eventTimestamp(NOW + 3_600_000, NOW)).toEqual({ ok: true, iso: new Date(NOW).toISOString() })
    expect(eventTimestamp('yesterday', NOW).ok).toBe(false)
    expect(eventTimestamp('1999-01-01T00:00:00Z', NOW).ok).toBe(false)
  })
})

describe('reconcileClientCost', () => {
  it('always uses the server price for known models', () => {
    expect(reconcileClientCost(1.5, true, 0.0001)).toEqual({ cost: 1.5, usedClient: false, client: 0.0001 })
  })
  it('accepts a client figure for unknown models only within 10x', () => {
    expect(reconcileClientCost(1, false, 3)).toMatchObject({ cost: 3, usedClient: true })
    expect(reconcileClientCost(1, false, 0.05)).toMatchObject({ cost: 1, usedClient: false })
    expect(reconcileClientCost(1, false, 50)).toMatchObject({ cost: 1, usedClient: false })
    expect(reconcileClientCost(1, false, -2)).toEqual({ cost: 1, usedClient: false, client: null })
  })
})

describe('prepareEvent', () => {
  it('buckets by the event timestamp, prices server-side and keeps the client cost as vendor cost', () => {
    const p = prepareEvent({ model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 100, cost_usd: 99, timestamp: '2026-09-27T10:00:00Z', latency_ms: 812 }, 'idem-1', env())
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.ev.record.created_at).toBe('2026-09-27T10:00:00.000Z')
    expect(p.ev.summary.bucket).toBe('2026-09-27')
    expect(p.ev.record.cost_usd).toBe(computeCost('claude-sonnet-4-6', 1000, 100))
    expect(p.ev.record.vendor_cost_usd).toBe(99)
    expect(p.ev.record.latency_ms).toBe(812)
    expect(p.ev.record.event_id).toBe(`direct:${ORG}:idem-1`)
    expect(p.ev.record.project_id).toBe(PROJ)
  })

  it('attributes a shared key to the member with that email', () => {
    const p = prepareEvent({ model: 'gpt-5', input_tokens: 10, output_tokens: 5, user_email: 'Dev@Acme.test' }, null, env())
    expect(p.ok && p.ev.record.user_id).toBe('user-dev')
  })

  it('rejects a project from another org and bad input', () => {
    expect(prepareEvent({ model: 'gpt-5', input_tokens: 1, project_id: 'other' }, null, env())).toMatchObject({ ok: false, status: 422 })
    expect(prepareEvent({ input_tokens: 1 }, null, env())).toMatchObject({ ok: false, status: 400 })
    expect(prepareEvent({ model: 'gpt-5' }, null, env())).toMatchObject({ ok: false, status: 400 })
  })

  it('redacts prompt previews and drops prompt text when the org disallows capture', () => {
    const body = { model: 'gpt-5', input_tokens: 10, output_tokens: 5, prompt_text: 'my key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAA ok' }
    const on = prepareEvent(body, null, env())
    expect(on.ok && on.ev.record.prompt_preview).toBe('my key is [REDACTED_API_KEY] ok')
    expect(on.ok && on.ev.prompt?.prompt_text).toBeTruthy()   // redacted again at insert
    const off = prepareEvent(body, null, env({ capture: false }))
    expect(off.ok && off.ev.prompt).toBeNull()
    expect(off.ok && off.ev.record.prompt_preview).toBeNull()
    expect(off.ok && off.ev.record.prompt_hash).toBeTruthy()  // fingerprint only
  })

  it('input-only events are not given invented output tokens', () => {
    const p = prepareEvent({ model: 'gpt-5', input_tokens: 10 }, null, env())
    expect(p.ok && [p.ev.record.input_tokens, p.ev.record.output_tokens, p.ev.record.total_tokens]).toEqual([10, 0, 10])
  })
})

describe('prepareEvent — OpenCode plugin (agent source)', () => {
  const oc = {
    model: 'claude-sonnet-4-6', provider: 'anthropic', source: 'opencode',
    input_tokens: 20, output_tokens: 300, reasoning_tokens: 50, cache_read_tokens: 40_000, cache_write_tokens: 2_000,
    session_id: 'ses_1', correlation_id: 'msg_user_1', cost_usd: 0, cost_basis: 'notional', repo: 'acme/app',
  }
  it('keeps notional, server-prices tokens incl. cache + reasoning, keeps the vendor figure', () => {
    const p = prepareEvent({ ...oc, prompt_text: 'x'.repeat(20_000) }, 'msg_asst_1', env())
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const r = p.ev.record
    expect(r.cost_basis).toBe('notional')
    expect(r.cost_usd).toBe(computeCost('claude-sonnet-4-6', 20, 350, 40_000, 2_000))
    expect(Number(r.cost_usd)).toBeGreaterThan(0)
    expect(r.vendor_cost_usd).toBe(0)
    expect(r.total_tokens).toBe(20 + 300 + 50 + 40_000 + 2_000)
    expect([r.cache_read_tokens, r.cache_write_tokens, r.reasoning_tokens]).toEqual([40_000, 2_000, 50])
    expect([r.session_id, r.correlation_id, r.prompt_hash, r.repo, r.source]).toEqual(['ses_1', 'msg_user_1', 'msg_user_1', 'acme/app', 'opencode'])
    expect(String(p.ev.prompt?.prompt_text).length).toBe(20_000)
    expect(p.ev.prompt?.prompt_hash).toBe('msg_user_1')
  })
  it('an API-key provider is metered and server-priced (vendor figure cannot lower it)', () => {
    const p = prepareEvent({ ...oc, cost_usd: 0.000001, cost_basis: 'metered' }, null, env())
    expect(p.ok && p.ev.record.cost_basis).toBe('metered')
    expect(p.ok && p.ev.record.cost_usd).toBe(computeCost('claude-sonnet-4-6', 20, 350, 40_000, 2_000))
  })
  it('a non-agent source cannot claim notional (no budget dodging)', () => {
    const p = prepareEvent({ ...oc, source: 'direct' }, null, env())
    expect(p.ok && p.ev.record.cost_basis).toBeUndefined()
    // SDK convention: cache/reasoning are inside input/output, not added again.
    expect(p.ok && p.ev.record.total_tokens).toBe(320)
  })
})
