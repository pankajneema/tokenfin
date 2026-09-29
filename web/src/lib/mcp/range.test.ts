import { describe, it, expect } from 'vitest'
import { parseRange, parseDim, parseFilters, forecastMonth, daysInMonth } from './range'

describe('parseRange', () => {
  it('defaults to the last 30 days including today', () => {
    expect(parseRange({}, '2026-09-29')).toEqual({ from: '2026-08-31', to: '2026-09-29', days: 30 })
  })
  it('honours days and explicit from/to', () => {
    expect(parseRange({ days: 7 }, '2026-09-29')).toEqual({ from: '2026-09-23', to: '2026-09-29', days: 7 })
    expect(parseRange({ from: '2026-09-01', to: '2026-09-10' }, '2026-09-29')).toMatchObject({ days: 10 })
  })
  it('rejects bad dates and inverted or oversized ranges', () => {
    expect(() => parseRange({ from: '2026-02-30' }, '2026-09-29')).toThrow()
    expect(() => parseRange({ from: '2026-09-10', to: '2026-09-01' }, '2026-09-29')).toThrow()
    expect(() => parseRange({ from: '2024-01-01', to: '2026-01-01' }, '2026-09-29')).toThrow(/limited/)
  })
})

describe('parseDim / parseFilters', () => {
  it('accepts only known dimensions', () => {
    expect(parseDim('repo')).toBe('repo')
    expect(() => parseDim('day')).toThrow()
    expect(() => parseDim('user_id; drop')).toThrow()
  })
  it('keeps known string filters and validates project_id', () => {
    expect(parseFilters({ model: ' opus ', bogus: 'x', repo: 3 })).toEqual({ model: 'opus' })
    expect(() => parseFilters({ project_id: 'nope' })).toThrow()
  })
})

describe('forecastMonth', () => {
  const p = (day: string, cost: number, notional = 0) => ({ day, cost_usd: cost + notional, metered_cost_usd: cost, notional_cost_usd: notional })
  it('projects MTD + trailing average over the remaining days, metered and notional separately', () => {
    // Sep has 30 days; today = the 10th. MTD metered 9 (1/day for days 1..9), today 0.
    const mtd = Array.from({ length: 10 }, (_, i) => p(`2026-09-${String(i + 1).padStart(2, '0')}`, i < 9 ? 1 : 0, i < 9 ? 2 : 0))
    const trailing = Array.from({ length: 7 }, (_, i) => p(`2026-09-0${i + 3}`, 1, 2))
    const f = forecastMonth('2026-09-10', mtd, trailing)
    expect(f.days_in_month).toBe(30)
    expect(f.mtd.metered_cost_usd).toBe(9)
    // 9 + 1 × 20 days left + (1 − 0) for the rest of today = 30
    expect(f.projected_month_end.metered_cost_usd).toBe(30)
    expect(f.projected_month_end.notional_cost_usd).toBe(60)
  })
  it('never projects below MTD and handles no history', () => {
    const f = forecastMonth('2026-02-28', [p('2026-02-28', 5)], [])
    expect(daysInMonth('2026-02-28')).toBe(28)
    expect(f.projected_month_end.cost_usd).toBe(5)
  })
})
