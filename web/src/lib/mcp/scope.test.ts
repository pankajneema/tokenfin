import { describe, it, expect } from 'vitest'
import { userKeysFor, scopedFilterSets, mergeBreakdowns, mergePages, inScope } from './scope'
import { NO_USER_SCOPE } from '@/lib/rbac'
import type { DashBreakdown, DashBreakdownRow } from '@/lib/rollups'

const row = (key: string, cost: number, extra: Partial<DashBreakdownRow> = {}): DashBreakdownRow => ({
  key, cost_usd: cost, metered_cost_usd: cost, notional_cost_usd: 0, vendor_cost_usd: 0, requests: 1,
  input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
  total_tokens: 2, avg_latency_ms: null, active_days: 1, users: 1, ...extra,
})

describe('userKeysFor', () => {
  it('uses lowercased email and user id', () => {
    expect(userKeysFor(' Me@X.io ', 'u1')).toEqual(['me@x.io', 'u1'])
  })
  it('fails closed to a sentinel when nothing identifies the user', () => {
    expect(userKeysFor(null, null)).toEqual([NO_USER_SCOPE])
  })
})

describe('scopedFilterSets', () => {
  it('passes filters through for org-wide callers', () => {
    expect(scopedFilterSets({ model: 'm', user_key: 'other@x.io' }, null)).toEqual([{ model: 'm', user_key: 'other@x.io' }])
  })
  it('forces a scoped caller to their own keys', () => {
    expect(scopedFilterSets({ model: 'm' }, ['me@x.io', 'u1'])).toEqual([
      { model: 'm', user_key: 'me@x.io' }, { model: 'm', user_key: 'u1' },
    ])
  })
  it('returns no runs when a scoped caller asks for someone else', () => {
    expect(scopedFilterSets({ user_key: 'boss@x.io' }, ['me@x.io', 'u1'])).toEqual([])
  })
  it('allows a scoped caller to name their own key (case-insensitive)', () => {
    expect(scopedFilterSets({ user_key: 'ME@x.io' }, ['me@x.io', 'u1'])).toEqual([{ user_key: 'me@x.io' }])
  })
})

describe('mergeBreakdowns', () => {
  it('sums rows with the same key and re-sorts by cost', () => {
    const a: DashBreakdown = { rows: [row('opus', 2), row('haiku', 1)], other: null, total_keys: 2 }
    const b: DashBreakdown = { rows: [row('haiku', 5)], other: null, total_keys: 1 }
    const m = mergeBreakdowns([a, b], 10)
    expect(m.rows.map(r => [r.key, r.cost_usd, r.requests])).toEqual([['haiku', 6, 2], ['opus', 2, 1]])
    expect(m.total_keys).toBe(2)
    expect(m.other).toBeNull()
  })
  it('folds rows past the limit into other', () => {
    const a: DashBreakdown = { rows: [row('a', 3), row('b', 2)], other: null, total_keys: 2 }
    const b: DashBreakdown = { rows: [row('c', 1)], other: null, total_keys: 1 }
    const m = mergeBreakdowns([a, b], 2)
    expect(m.rows.map(r => r.key)).toEqual(['a', 'b'])
    expect(m.other).toMatchObject({ keys: 1, cost_usd: 1 })
  })
})

describe('mergePages', () => {
  it('dedupes, sorts and applies offset/limit', () => {
    const p1 = { total: 2, rows: [{ id: 'x', v: 1 }, { id: 'y', v: 5 }] }
    const p2 = { total: 1, rows: [{ id: 'x', v: 1 }, { id: 'z', v: 3 }] }
    const m = mergePages([p1, p2], r => r.id, (a, b) => b.v - a.v, 2, 1)
    expect(m.rows.map(r => r.id)).toEqual(['z', 'x'])
    expect(m.total).toBe(3)
  })
})

describe('inScope', () => {
  it('lets org-wide callers see everything', () => { expect(inScope('anyone', null)).toBe(true) })
  it('matches only own keys', () => {
    expect(inScope('ME@x.io', ['me@x.io'])).toBe(true)
    expect(inScope('boss@x.io', ['me@x.io'])).toBe(false)
    expect(inScope('', ['me@x.io'])).toBe(false)
  })
})
