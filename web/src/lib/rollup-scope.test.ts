import { describe, it, expect } from 'vitest'
import {
  resolveWindow, trendPct, zonedDayStartIso, scopeKeys, eventScopeOr,
  mergeSummaries, mergeBreakdowns, mergePages, windowLabel, sourceLabel,
} from './rollup-scope'
import type { DashSummary, DashBreakdown, DashSession, Page } from './rollups'

// 2026-09-29 20:00 UTC = 2026-09-30 01:30 in Asia/Kolkata
const NOW = Date.parse('2026-09-29T20:00:00Z')

describe('resolveWindow', () => {
  it('ends today in the org zone and is inclusive', () => {
    const w = resolveWindow({ days: '30' }, 'Asia/Kolkata', { now: NOW })
    expect(w.to).toBe('2026-09-30')
    expect(w.from).toBe('2026-09-01')
    expect(w.days).toBe(30)
    expect(w.prevTo).toBe('2026-08-31')
    expect(w.prevFrom).toBe('2026-08-02')
    expect(w.label).toBe('Last 30 days')
    expect(w.custom).toBe(false)
  })
  it('uses the zone for "today"', () => {
    expect(resolveWindow({ days: '7' }, 'UTC', { now: NOW }).to).toBe('2026-09-29')
  })
  it('falls back to the default for junk / disallowed values', () => {
    expect(resolveWindow({ days: 'abc' }, 'UTC', { now: NOW }).days).toBe(30)
    expect(resolveWindow({ days: '14' }, 'UTC', { now: NOW, allowed: [7, 30, 90] }).days).toBe(30)
    expect(resolveWindow({ days: '99999' }, 'UTC', { now: NOW }).days).toBe(1095)
  })
  it('accepts a custom range', () => {
    const w = resolveWindow({ from: '2026-09-01', to: '2026-09-20' }, 'UTC', { now: NOW })
    expect(w).toMatchObject({ from: '2026-09-01', to: '2026-09-20', days: 20, custom: true, prevFrom: '2026-08-12', prevTo: '2026-08-31' })
    expect(w.label).toBe('Sep 1 – Sep 20')
  })
  it('ignores an inverted custom range', () => {
    expect(resolveWindow({ from: '2026-09-20', to: '2026-09-01' }, 'UTC', { now: NOW }).custom).toBe(false)
  })
})

describe('labels / trend', () => {
  it('windowLabel', () => { expect(windowLabel(1)).toBe('Today'); expect(windowLabel(7)).toBe('Last 7 days') })
  it('trendPct is null without prev data', () => {
    expect(trendPct(10, 0)).toBeNull()
    expect(trendPct(15, 10)).toBe(50)
  })
  it('sourceLabel', () => { expect(sourceLabel('claude_code')).toBe('Claude Code'); expect(sourceLabel('')).toBe('Direct API'); expect(sourceLabel('x')).toBe('x') })
})

describe('zonedDayStartIso', () => {
  it('handles positive, negative and DST zones', () => {
    expect(zonedDayStartIso('2026-09-01', 'Asia/Kolkata')).toBe('2026-08-31T18:30:00.000Z')
    expect(zonedDayStartIso('2026-09-01', 'UTC')).toBe('2026-09-01T00:00:00.000Z')
    expect(zonedDayStartIso('2026-07-01', 'America/New_York')).toBe('2026-07-01T04:00:00.000Z')
    expect(zonedDayStartIso('2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z')
    expect(zonedDayStartIso('2026-01-15', 'Not/AZone')).toBe('2026-01-15T00:00:00.000Z')
  })
})

describe('scope', () => {
  it('keys = lower(email) + user id', () => {
    expect(scopeKeys('u1', ' Pat@X.io ')).toEqual(['pat@x.io', 'u1'])
    expect(scopeKeys('u1', null)).toEqual(['u1'])
  })
  it('eventScopeOr matches the id or the email (LIKE-escaped, quoted)', () => {
    expect(eventScopeOr({ userId: 'u1', email: 'a_b@x.io', keys: [] }))
      .toBe('user_id.eq.u1,user_email.ilike."a\\\\_b@x.io"')
    expect(eventScopeOr({ userId: 'u1', email: null, keys: [] })).toBe('user_id.eq.u1')
  })
})

const summary = (over: Partial<DashSummary>, series: [string, number, number][]): DashSummary => ({
  cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0, vendor_cost_usd: 0, requests: 0,
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 0,
  avg_latency_ms: null, active_days: 0, from: '2026-09-01', to: '2026-09-02', timezone: 'UTC',
  prompts: 0, sessions: 0, active_users: 0,
  series: series.map(([day, cost, requests]) => ({
    day, cost_usd: cost, metered_cost_usd: cost, notional_cost_usd: 0, requests,
    total_tokens: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
  })),
  ...over,
})

describe('merges', () => {
  it('mergeSummaries adds totals and series, weights latency', () => {
    const a = summary({ cost_usd: 1, requests: 2, prompts: 1, sessions: 1, avg_latency_ms: 100 }, [['2026-09-01', 1, 2], ['2026-09-02', 0, 0]])
    const b = summary({ cost_usd: 3, requests: 6, prompts: 2, avg_latency_ms: 200 }, [['2026-09-01', 0, 0], ['2026-09-02', 3, 6]])
    const m = mergeSummaries([a, b])
    expect(m.cost_usd).toBe(4)
    expect(m.requests).toBe(8)
    expect(m.prompts).toBe(3)
    expect(m.sessions).toBe(1)
    expect(m.avg_latency_ms).toBe(175)
    expect(m.series.map(p => p.cost_usd)).toEqual([1, 3])
    expect(m.active_days).toBe(2)
    expect(a.series[1].cost_usd).toBe(0) // inputs untouched
  })

  const row = (key: string, cost: number, requests = 1) => ({
    key, cost_usd: cost, metered_cost_usd: cost, notional_cost_usd: 0, vendor_cost_usd: 0, requests,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
    total_tokens: requests * 10, avg_latency_ms: null, active_days: 1, users: 1,
  })
  it('mergeBreakdowns sums keys, re-ranks and rolls the tail into other', () => {
    const a: DashBreakdown = { rows: [row('m1', 1), row('m2', 5)], other: null, total_keys: 2 }
    const b: DashBreakdown = { rows: [row('m1', 6), row('m3', 0.5)], other: null, total_keys: 2 }
    const m = mergeBreakdowns([a, b], 2)
    expect(m.rows.map(r => [r.key, r.cost_usd])).toEqual([['m1', 7], ['m2', 5]])
    expect(m.other).toMatchObject({ keys: 1, cost_usd: 0.5 })
    expect(m.total_keys).toBe(3)
  })
  it('mergeBreakdowns keeps day breakdowns chronological and complete', () => {
    const a: DashBreakdown = { rows: [row('2026-09-02', 1)], other: null, total_keys: 1 }
    const b: DashBreakdown = { rows: [row('2026-09-01', 9)], other: null, total_keys: 1 }
    expect(mergeBreakdowns([a, b], 1, true).rows.map(r => r.key)).toEqual(['2026-09-01', '2026-09-02'])
  })
  it('mergePages merges, orders and pages', () => {
    const s = (id: string, last: string, cost: number) => ({ session_id: id, last_at: last, cost_usd: cost, total_tokens: 0, requests: 0 }) as DashSession
    const a: Page<DashSession> = { total: 2, rows: [s('a', '2026-09-02T00:00:00Z', 1), s('b', '2026-09-01T00:00:00Z', 5)] }
    const b: Page<DashSession> = { total: 1, rows: [s('c', '2026-09-03T00:00:00Z', 2)] }
    expect(mergePages([a, b], 'recent', 0, 2)).toEqual({ total: 3, rows: [b.rows[0], a.rows[0]] })
    expect(mergePages([a, b], 'cost', 1, 5).rows.map(r => r.session_id)).toEqual(['c', 'a'])
  })
})
