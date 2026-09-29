import { describe, it, expect } from 'vitest'
import { cheaperTier, makePricer } from './pricer'
import { computeCost } from '@/lib/mcp/pricing'
import {
  cacheHitRate, errorStorms, expensiveShortCalls, idleSeats, keyHygiene, lowCacheReuse, median, percentile,
  runawaySessions, sortFindings, splitSaving, totalsOf, withCacheHit, MONTH_FACTOR,
  type CallSample, type KeyRow, type ModelUsage,
} from './waste'
import type { DashSession } from '@/lib/rollups'

const w = { from: '2026-09-01', to: '2026-09-30' }
const pricer = makePricer()

function usage(p: Partial<ModelUsage> & { model: string }): ModelUsage {
  const base = { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, ...p }
  const cost = p.cost_usd ?? computeCost(base.model, base.input_tokens, base.output_tokens, base.cache_read_tokens, base.cache_write_tokens)
  return { ...base, cost_usd: cost, metered_cost_usd: p.metered_cost_usd ?? cost, notional_cost_usd: p.notional_cost_usd ?? 0 }
}

describe('helpers', () => {
  it('median / percentile', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
    const xs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(xs, 0.95)).toBe(95)
    expect(percentile([], 0.5)).toBe(0)
  })
  it('splitSaving follows the metered/notional mix', () => {
    expect(splitSaving(10, 3, 1)).toEqual({ bill: 7.5, notional: 2.5 })
    expect(splitSaving(10, 0, 0)).toEqual({ bill: 10, notional: 0 })
    expect(splitSaving(-5, 1, 1)).toEqual({ bill: 0, notional: 0 })
  })
  it('cheaperTier suggests one family tier down', () => {
    expect(cheaperTier('claude-opus-4-8-20260101')).toBe('claude-sonnet-5')
    expect(cheaperTier('claude-sonnet-4-6')).toBe('claude-haiku-4-5')
    expect(cheaperTier('gpt-5.5-pro')).toBe('gpt-5.4-mini')
    expect(cheaperTier('claude-haiku-4-5')).toBeNull()
  })
  it('makePricer honours org overrides (longest prefix)', () => {
    const p = makePricer([{ model_prefix: 'claude-opus', input_per_m: 1, output_per_m: 2, cache_read_per_m: null, cache_write_per_m: null }])
    expect(p.price('claude-opus-4-8')).toEqual({ in: 1, out: 2, cacheRead: 0.1, cacheWrite: 1.25 })
    expect(p.cost('claude-opus-4-8', { input_tokens: 1e6, output_tokens: 1e6, cache_read_tokens: 0, cache_write_tokens: 0 })).toBe(3)
    expect(p.price('claude-sonnet-5').out).toBe(10)
  })
})

describe('rule: expensive model on short outputs', () => {
  const opus = usage({ model: 'claude-opus-4-8', requests: 300, input_tokens: 3_000_000, output_tokens: 30_000 })
  const shortSample: CallSample[] = Array.from({ length: 300 }, () => ({ output_tokens: 80, cost_usd: 0.052 }))

  it('flags opus with median output < 200 and prices the cheaper tier', () => {
    const [f] = expensiveShortCalls([opus], new Map([[opus.model, shortSample]]), pricer, w)
    expect(f.rule).toBe('expensive_model_short_output')
    expect(f.metrics.target).toBe('claude-sonnet-5')
    const ratio = computeCost('claude-sonnet-5', 3e6, 3e4) / computeCost('claude-opus-4-8', 3e6, 3e4)
    expect(f.monthly_saving_usd).toBeCloseTo(opus.cost_usd * (1 - ratio) * MONTH_FACTOR, 1)
    expect(f.confidence).toBe('high')
    expect(f.evidence.href).toContain('model=claude-opus-4-8')
  })
  it('ignores long outputs, cheap models, and tiny samples', () => {
    const long = Array.from({ length: 300 }, () => ({ output_tokens: 900, cost_usd: 0.1 }))
    expect(expensiveShortCalls([opus], new Map([[opus.model, long]]), pricer, w)).toEqual([])
    const haiku = usage({ model: 'claude-haiku-4-5', requests: 300, input_tokens: 3e6, output_tokens: 3e4 })
    expect(expensiveShortCalls([haiku], new Map([[haiku.model, shortSample]]), pricer, w)).toEqual([])
    expect(expensiveShortCalls([opus], new Map([[opus.model, shortSample.slice(0, 5)]]), pricer, w)).toEqual([])
  })
  it('only counts the short share of spend and splits notional', () => {
    const mixed = [...Array.from({ length: 60 }, () => ({ output_tokens: 50, cost_usd: 0.01 })), ...Array.from({ length: 40 }, () => ({ output_tokens: 2000, cost_usd: 0.09 }))]
    const m = { ...opus, metered_cost_usd: 0, notional_cost_usd: opus.cost_usd }
    const [f] = expensiveShortCalls([m], new Map([[m.model, mixed]]), pricer, w)
    expect(f.metrics.short_share_pct).toBe(14)   // 0.6 / (0.6 + 3.6)
    expect(f.bill_saving_usd).toBe(0)
    expect(f.notional_saving_usd).toBeGreaterThan(0)
    expect(f.confidence).toBe('medium')
  })
})

describe('rule: low cache reuse', () => {
  it('flags large contexts with a low cache-hit rate', () => {
    const m = usage({ model: 'claude-sonnet-4-6', requests: 600, input_tokens: 600 * 20_000, output_tokens: 600 * 500, cache_read_tokens: 600 * 1000 })
    expect(cacheHitRate(m)).toBeCloseTo(1 / 21, 5)
    const [f] = lowCacheReuse([m], pricer, w)
    expect(f.rule).toBe('low_cache_reuse')
    expect(f.confidence).toBe('medium')
    expect(f.monthly_saving_usd).toBeGreaterThan(0)
    expect(f.monthly_saving_usd).toBeLessThan(m.cost_usd)
  })
  it('skips small contexts, few requests, and already-cached traffic', () => {
    expect(lowCacheReuse([usage({ model: 'x', requests: 600, input_tokens: 600 * 100, output_tokens: 100 })], pricer, w)).toEqual([])
    expect(lowCacheReuse([usage({ model: 'x', requests: 10, input_tokens: 10 * 50_000, output_tokens: 100 })], pricer, w)).toEqual([])
    expect(lowCacheReuse([usage({ model: 'x', requests: 600, input_tokens: 600 * 5_000, cache_read_tokens: 600 * 20_000, output_tokens: 100 })], pricer, w)).toEqual([])
  })
  it('withCacheHit moves input to cache reads and adds writes, never negative', () => {
    const t = withCacheHit({ input_tokens: 1000, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 }, 0.6)
    expect(t.cache_read_tokens).toBe(600)
    expect(t.cache_write_tokens).toBe(60)
    expect(t.input_tokens).toBe(340)
    const all = withCacheHit({ input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }, 1)
    expect(all.input_tokens).toBeGreaterThanOrEqual(0)
    expect(withCacheHit({ input_tokens: 100, output_tokens: 0, cache_read_tokens: 900, cache_write_tokens: 0 }, 0.5).cache_read_tokens).toBe(900)
  })
})

describe('rule: error storms', () => {
  const models = [usage({ model: 'claude-opus-4-8', requests: 100, cost_usd: 50, metered_cost_usd: 50 })]
  it('groups by member + model and estimates retry cost', () => {
    const rows = [
      { user_key: 'a@x.com', model: 'claude-opus-4-8', day: '2026-09-10', errors: 30 },
      { user_key: 'a@x.com', model: 'claude-opus-4-8', day: '2026-09-11', errors: 10 },
      { user_key: 'b@x.com', model: 'claude-opus-4-8', day: '2026-09-11', errors: 3 },
    ]
    const fs = errorStorms(rows, models, w)
    expect(fs).toHaveLength(1)
    expect(fs[0].metrics).toMatchObject({ user_key: 'a@x.com', errors: 40, peak_day: '2026-09-10', peak_errors: 30 })
    expect(fs[0].monthly_saving_usd).toBeCloseTo(40 * 0.5 * MONTH_FACTOR, 2)
    expect(fs[0].evidence.href).toContain('from=2026-09-10')
  })
  it('flags sustained errors by total too, and prices unknown models at $0', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ user_key: '', model: 'mystery', day: `2026-09-${String(i + 10)}`, errors: 6 }))
    const [f] = errorStorms(rows, models, w)
    expect(f.metrics.errors).toBe(60)
    expect(f.monthly_saving_usd).toBe(0)
    expect(f.title).toContain('unattributed')
  })
})

describe('rule: runaway sessions', () => {
  const s = (id: string, cost: number): DashSession => ({
    session_id: id, first_at: '', last_at: '', user_key: 'a@x.com', source: 'claude_code', repo: 'r', project_id: '', model: 'm', agent: '',
    requests: 10, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1000, cost_usd: cost,
  })
  it('flags sessions over 3 × P95 and counts the excess', () => {
    const fs = runawaySessions([s('big', 40), s('ok', 9), s('mid', 20)], 5, 100, 0.25)
    expect(fs.map(f => f.metrics.session_id)).toEqual(['big', 'mid'])
    expect(fs[0].monthly_saving_usd).toBeCloseTo(25 * MONTH_FACTOR, 1)
    expect(fs[0].bill_saving_usd).toBeCloseTo(25 * MONTH_FACTOR * 0.75, 1)
    expect(fs[0].evidence.href).toBe('/dashboard/sessions/big')
  })
  it("uses the session model's cost basis when known", () => {
    const [f] = runawaySessions([s('big', 40)], 5, 100, 0.25, 5, [usage({ model: 'm', cost_usd: 10, metered_cost_usd: 0, notional_cost_usd: 10 })])
    expect(f.bill_saving_usd).toBe(0)
    expect(f.notional_saving_usd).toBeGreaterThan(0)
  })
  it('needs enough sessions for a meaningful P95', () => {
    expect(runawaySessions([s('big', 40)], 5, 10, 0)).toEqual([])
    expect(runawaySessions([s('big', 40)], 0, 100, 0)).toEqual([])
  })
})

describe('rule: key hygiene', () => {
  const now = Date.parse('2026-09-29T00:00:00Z')
  const k = (p: Partial<KeyRow>): KeyRow => ({
    id: Math.random().toString(36), name: 'k', key_prefix: 'tfk_…', project_id: 'p', user_id: 'u', created_by: 'u',
    kind: 'ingest', device_id: null, last_used_at: '2026-09-28T00:00:00Z', created_at: '2026-01-01T00:00:00Z', ...p,
  })
  it('finds idle keys (never or long unused) but not new ones', () => {
    const fs = keyHygiene([
      k({ name: 'old', last_used_at: '2026-07-01T00:00:00Z', user_id: 'a' }),
      k({ name: 'never', last_used_at: null, user_id: 'b' }),
      k({ name: 'fresh', last_used_at: null, created_at: '2026-09-20T00:00:00Z', user_id: 'c' }),
    ], now)
    expect(fs).toHaveLength(1)
    expect(fs[0]).toMatchObject({ rule: 'idle_key', monthly_saving_usd: 0, confidence: 'high' })
    expect(fs[0].metrics.keys).toBe(2)
  })
  it('finds duplicate keys per owner/project/kind/device', () => {
    const fs = keyHygiene([k({ name: 'a' }), k({ name: 'b' }), k({ name: 'c', kind: 'read' }), k({ name: 'd', device_id: 'laptop' })], now)
    expect(fs).toHaveLength(1)
    expect(fs[0].rule).toBe('duplicate_keys')
    expect(fs[0].metrics).toMatchObject({ groups: 1, extra_keys: 1 })
    expect(fs[0].detail).toBe('a / b (2 keys).')
  })
})

describe('rule: idle seats', () => {
  it('flags subscription users who went quiet, at the assumed seat price', () => {
    const fs = idleSeats([
      { user_key: 'quiet@x.com', requests: 2, notional_cost_usd: 0.1, prev_notional_cost_usd: 30 },
      { user_key: 'busy@x.com', requests: 500, notional_cost_usd: 80, prev_notional_cost_usd: 90 },
      { user_key: 'api@x.com', requests: 0, notional_cost_usd: 0, prev_notional_cost_usd: 0 },
    ], 25, w)
    expect(fs).toHaveLength(1)
    expect(fs[0]).toMatchObject({ rule: 'idle_seat', bill_saving_usd: 25, notional_saving_usd: 0, confidence: 'low' })
    expect(fs[0].detail).toContain('quiet@x.com')
    expect(fs[0].detail).not.toContain('api@x.com')
  })
  it('returns nothing without idle seats', () => expect(idleSeats([], 20, w)).toEqual([]))
})

describe('ordering + totals', () => {
  it('sorts by saving then confidence and sums bill/notional separately', () => {
    const base = { title: '', detail: '', recommendation: '', evidence: { label: '', href: '' }, metrics: {}, rule: 'idle_key' as const }
    const fs = sortFindings([
      { ...base, id: 'a', monthly_saving_usd: 0, bill_saving_usd: 0, notional_saving_usd: 0, confidence: 'high' },
      { ...base, id: 'b', monthly_saving_usd: 10, bill_saving_usd: 4, notional_saving_usd: 6, confidence: 'low' },
      { ...base, id: 'c', monthly_saving_usd: 10, bill_saving_usd: 10, notional_saving_usd: 0, confidence: 'high' },
    ])
    expect(fs.map(f => f.id)).toEqual(['c', 'b', 'a'])
    expect(totalsOf(fs)).toEqual({ monthly_saving_usd: 20, bill_saving_usd: 14, notional_saving_usd: 6, findings: 3 })
  })
})
