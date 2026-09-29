import { describe, it, expect } from 'vitest'
import { computeCost } from '@/lib/mcp/pricing'
import { makePricer } from './pricer'
import { simulate, type UsageGroup } from './whatif'

const pricer = makePricer()
const g = (model: string, basis: 'metered' | 'notional', p: Partial<UsageGroup> = {}): UsageGroup => ({
  model, basis, requests: 1000, input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 0, cache_write_tokens: 0, ...p,
})

describe('simulate', () => {
  it('re-prices the baseline from tokens and returns no change without scenarios', () => {
    const r = simulate([g('claude-opus-4-8', 'metered'), g('claude-sonnet-4-6', 'notional')], [], {}, pricer)
    expect(r.before.metered_usd).toBe(30)   // 5 + 25
    expect(r.before.notional_usd).toBe(18)  // 3 + 15
    expect(r.before.bill_usd).toBe(30)      // notional is never billed
    expect(r.after).toEqual(r.before)
    expect(r.delta).toEqual({ metered_usd: 0, notional_usd: 0, seat_fees_usd: 0, bill_usd: 0 })
  })

  it('switches a share of model A to model B', () => {
    const r = simulate([g('claude-opus-4-8', 'metered')], [], { switch: { from: 'claude-opus-4-8', to: 'claude-haiku-4-5', share: 0.5 } }, pricer)
    // half at opus ($15) + half at haiku (0.5 + 2.5 = $3)
    expect(r.after.metered_usd).toBe(18)
    expect(r.delta.bill_usd).toBe(-12)
    expect(r.lines.find(l => l.model === 'claude-haiku-4-5')?.after_usd).toBe(3)
    expect(r.lines.find(l => l.model === 'claude-haiku-4-5')?.before_usd).toBe(0)
    expect(r.lines.find(l => l.model === 'claude-haiku-4-5')?.requests_after).toBe(500)
  })

  it('share is clamped and a same-model switch is a no-op', () => {
    const r = simulate([g('claude-opus-4-8', 'metered')], [], { switch: { from: 'claude-opus-4-8', to: 'claude-haiku-4-5', share: 7 } }, pricer)
    expect(r.after.metered_usd).toBe(6)
    expect(simulate([g('a', 'metered')], [], { switch: { from: 'a', to: 'a', share: 1 } }, pricer).delta.bill_usd).toBe(0)
  })

  it('raises the cache-hit rate token-accurately', () => {
    const r = simulate([g('claude-sonnet-4-6', 'metered', { output_tokens: 0 })], [], { cache: { hitRate: 0.5 } }, pricer)
    // 500k → cache read, 50k → cache write, 450k stays input
    expect(r.after.metered_usd).toBeCloseTo(computeCost('claude-sonnet-4-6', 450_000, 0, 500_000, 50_000), 2)
    expect(r.delta.bill_usd).toBeLessThan(0)
  })

  it('caps output tokens using the per-call average', () => {
    const r = simulate([g('claude-opus-4-8', 'metered')], [], { outputCap: { maxOutput: 400 } }, pricer)
    // 1000 calls × 400 = 400k output tokens
    expect(r.after.metered_usd).toBeCloseTo(computeCost('claude-opus-4-8', 1e6, 400_000), 2)
    const none = simulate([g('claude-opus-4-8', 'metered')], [], { outputCap: { maxOutput: 5000 } }, pricer)
    expect(none.delta.bill_usd).toBe(0)
  })

  it('moves light notional seats to API and keeps notional out of the bill', () => {
    const groups = [g('claude-sonnet-4-6', 'notional')]   // $18 notional
    const seats = [{ user_key: 'light@x.com', notional_cost_usd: 3 }, { user_key: 'heavy@x.com', notional_cost_usd: 15 }]
    const r = simulate(groups, seats, { seats: { seatUsd: 20 } }, pricer)
    expect(r.before).toMatchObject({ metered_usd: 0, notional_usd: 18, seat_fees_usd: 40, bill_usd: 40 })
    // both cost less than $20 at API rates → both move
    expect(r.seats).toMatchObject({ total: 2, moved: 2, moved_api_usd: 18 })
    expect(r.after).toMatchObject({ metered_usd: 18, notional_usd: 0, seat_fees_usd: 0, bill_usd: 18 })
    expect(r.delta.bill_usd).toBe(-22)

    const pricey = simulate(groups, seats, { seats: { seatUsd: 10 } }, pricer)
    expect(pricey.seats.moved_keys).toEqual(['light@x.com'])
    expect(pricey.after.bill_usd).toBe(13)   // 3 API + 1 seat × 10
  })

  it('applies earlier scenarios before judging seats', () => {
    const groups = [g('claude-opus-4-8', 'notional')]     // $30 notional
    const seats = [{ user_key: 'a@x.com', notional_cost_usd: 30 }]
    expect(simulate(groups, seats, { seats: { seatUsd: 20 } }, pricer).seats.moved).toBe(0)
    const r = simulate(groups, seats, { switch: { from: 'claude-opus-4-8', to: 'claude-haiku-4-5', share: 1 }, seats: { seatUsd: 20 } }, pricer)
    expect(r.seats.moved).toBe(1)   // $6 at haiku rates < $20
    expect(r.after.bill_usd).toBe(6)
  })

  it('honours org price overrides', () => {
    const p = makePricer([{ model_prefix: 'claude-opus', input_per_m: 1, output_per_m: 1, cache_read_per_m: null, cache_write_per_m: null }])
    expect(simulate([g('claude-opus-4-8', 'metered')], [], {}, p).before.metered_usd).toBe(2)
  })
})
