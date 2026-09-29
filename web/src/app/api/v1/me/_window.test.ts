import { describe, it, expect } from 'vitest'
import { midnightIn, periodStartIso, zonedMidnightIso, tightest, tzOffsetMs } from './_window'

describe('workspace-zone windows', () => {
  it('computes midnight in fixed-offset zones', () => {
    expect(midnightIn('2026-09-29', 'Asia/Kolkata')).toBe('2026-09-28T18:30:00.000Z')
    expect(midnightIn('2026-09-29', 'UTC')).toBe('2026-09-29T00:00:00.000Z')
    expect(midnightIn('2026-09-29', 'Asia/Seoul')).toBe('2026-09-28T15:00:00.000Z')
  })
  it('is DST-aware', () => {
    expect(midnightIn('2026-07-01', 'America/New_York')).toBe('2026-07-01T04:00:00.000Z')
    expect(midnightIn('2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z')
    expect(tzOffsetMs('America/New_York', Date.parse('2026-07-01T12:00:00Z'))).toBe(-4 * 3600_000)
  })
  it('today / week / month starts', () => {
    const now = Date.parse('2026-09-29T20:00:00Z') // already Sep 30 in Kolkata
    expect(zonedMidnightIso(now, 'Asia/Kolkata')).toBe('2026-09-29T18:30:00.000Z')
    expect(periodStartIso('monthly', now, 'Asia/Kolkata')).toBe('2026-08-31T18:30:00.000Z')
    expect(periodStartIso('weekly', now, 'UTC')).toBe('2026-09-22T00:00:00.000Z')
  })
  it('tightest = highest % used', () => {
    const base = { scope: 'org', period: 'monthly' as const, metric: 'cost_usd' as const }
    expect(tightest([])).toBeNull()
    expect(tightest([
      { ...base, id: 'a', budget: 100, spent: 50, pct: 50 },
      { ...base, id: 'b', budget: 10,  spent: 9,  pct: 90 },
    ])?.id).toBe('b')
  })
})
