import { describe, it, expect } from 'vitest'
import { runRate, forecastLimit, dailyTotals, periodBounds, periodStartDay, projectMonthEnd } from './forecast'

const NOW = new Date('2026-09-20T12:00:00Z') // 10.5 days left in September
const d = (n: number) => new Date(Date.parse('2026-09-20T00:00:00Z') - n * 86400_000).toISOString().slice(0, 10)

describe('runRate', () => {
  it('flat series → that rate', () => {
    const m = new Map<string, number>()
    for (let i = 1; i <= 14; i++) m.set(d(i), 10)
    expect(runRate(m, NOW)).toBeCloseTo(10)
  })
  it('weights the recent 7 days at 70%', () => {
    const m = new Map<string, number>()
    for (let i = 1; i <= 7; i++) m.set(d(i), 20)
    for (let i = 8; i <= 14; i++) m.set(d(i), 10)
    expect(runRate(m, NOW)).toBeCloseTo(0.7 * 20 + 0.3 * 10)
  })
  it('ignores today (partial) and days older than 14', () => {
    const m = new Map([[d(0), 1000], [d(20), 1000], [d(3), 7]])
    // Window starts at the first data day (3 back); days 2 and 1 are real
    // zeros after it → (7 + 0 + 0) / 3 at equal (recent-7) weights.
    expect(runRate(m, NOW)).toBeCloseTo(7 / 3)
  })
  it('does not dilute a new scope with pre-history zeros', () => {
    const m = new Map([[d(1), 10], [d(2), 10]])
    expect(runRate(m, NOW)).toBeCloseTo(10)
  })
  it('no data → 0', () => expect(runRate(new Map(), NOW)).toBe(0))
})

describe('forecastLimit', () => {
  it('monthly: on track', () => {
    const f = forecastLimit({ budget: 500, spent: 190, rate: 10, period: 'monthly', now: NOW })
    expect(f.projected).toBeCloseTo(190 + 10 * 10.5)
    expect(f.onTrack).toBe(true)
    expect(f.exceedDate).toBeNull()
    expect(f.runwayDays).toBeCloseTo(31)
  })
  it('monthly: will exceed, with a date', () => {
    const f = forecastLimit({ budget: 300, spent: 250, rate: 20, period: 'monthly', now: NOW })
    expect(f.onTrack).toBe(false)
    expect(f.runwayDays).toBeCloseTo(2.5)
    expect(f.exceedDate).toBe('2026-09-23')
    expect(f.projectedPct).toBeCloseTo(((250 + 210) / 300) * 100, 0)
  })
  it('already over budget → runway 0, exceed today', () => {
    const f = forecastLimit({ budget: 100, spent: 120, rate: 5, period: 'monthly', now: NOW })
    expect(f.runwayDays).toBe(0)
    expect(f.exceedDate).toBe('2026-09-20')
  })
  it('zero rate → never runs out', () => {
    const f = forecastLimit({ budget: 100, spent: 10, rate: 0, period: 'monthly', now: NOW })
    expect(f.runwayDays).toBeNull()
    expect(f.projected).toBe(10)
  })
  it('daily and weekly periods', () => {
    expect(forecastLimit({ budget: 10, spent: 4, rate: 12, period: 'daily', now: NOW }).projected).toBeCloseTo(4 + 6)
    expect(forecastLimit({ budget: 50, spent: 30, rate: 10, period: 'weekly', now: NOW }).projected).toBe(70)
  })
})

describe('helpers', () => {
  it('periodBounds / periodStartDay', () => {
    expect(periodStartDay('monthly', NOW)).toBe('2026-09-01')
    expect(periodStartDay('daily', NOW)).toBe('2026-09-20')
    expect(periodStartDay('weekly', NOW)).toBe('2026-09-13')
    expect(new Date(periodBounds('monthly', NOW).end).toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
  it('projectMonthEnd from raw events', () => {
    const evs = [] as { cost_usd: number; created_at: string }[]
    for (let i = 0; i <= 19; i++) evs.push({ cost_usd: 10, created_at: d(i) + 'T08:00:00Z' })
    expect(dailyTotals(evs).size).toBe(20)
    const p = projectMonthEnd(evs, NOW)
    expect(p.mtd).toBe(200)
    expect(p.projected).toBeCloseTo(200 + 10 * 10.5)
  })
})
