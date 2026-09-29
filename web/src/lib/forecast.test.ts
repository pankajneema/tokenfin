import { describe, it, expect } from 'vitest'
import { projectMonthEnd, monthToDate, daysInMonthOf, monthStartOf } from './forecast'
import { shiftDay } from './dates'

/** n days ending at `last` (inclusive), each with value fn(i) (i=0 oldest). */
function series(last: string, n: number, fn: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => ({ day: shiftDay(last, i - (n - 1)), value: fn(i) }))
}

describe('forecast helpers', () => {
  it('knows month lengths and starts', () => {
    expect(daysInMonthOf('2026-02-10')).toBe(28)
    expect(daysInMonthOf('2028-02-10')).toBe(29)
    expect(daysInMonthOf('2026-09-29')).toBe(30)
    expect(daysInMonthOf('2026-12-31')).toBe(31)
    expect(monthStartOf('2026-09-29')).toBe('2026-09-01')
  })

  it('sums month to date only within the month', () => {
    const s = series('2026-09-03', 10, () => 1) // Aug 25 .. Sep 3
    expect(monthToDate(s, '2026-09-03')).toBe(3)
  })
})

describe('projectMonthEnd', () => {
  it('hides the projection with fewer than 3 days of history', () => {
    // data only today and yesterday → 1 complete day
    const s = [{ day: '2026-09-28', value: 5 }, { day: '2026-09-29', value: 5 }]
    expect(projectMonthEnd(s, '2026-09-29')).toBeNull()
    expect(projectMonthEnd([], '2026-09-29')).toBeNull()
    expect(projectMonthEnd(series('2026-09-29', 30, () => 0), '2026-09-29')).toBeNull()
  })

  it('projects a flat $10/day spend to the full month', () => {
    // 30 days of $10 ending today (Sep 20); today is complete at $10 too
    const s = series('2026-09-20', 30, () => 10)
    const f = projectMonthEnd(s, '2026-09-20')!
    expect(f.basisDays).toBe(14)
    expect(f.dailyAvg).toBe(10)
    expect(f.mtd).toBe(200)
    expect(f.daysAfterToday).toBe(10)
    expect(f.projected).toBe(300)
  })

  it('tops up a partial today to the daily average', () => {
    const s = series('2026-09-20', 30, i => (i === 29 ? 2 : 10)) // today only $2 so far
    const f = projectMonthEnd(s, '2026-09-20')!
    expect(f.mtd).toBe(192)
    expect(f.projected).toBe(192 + 8 + 100)
  })

  it('uses only the trailing 14 complete days', () => {
    // old days $100, last 14 complete days $1
    const s = series('2026-09-29', 40, i => (i >= 25 && i < 39 ? 1 : i < 25 ? 100 : 1))
    const f = projectMonthEnd(s, '2026-09-29')!
    expect(f.basisDays).toBe(14)
    expect(f.dailyAvg).toBe(1)
    expect(f.daysAfterToday).toBe(1)
  })

  it('starts the average at the first day with data', () => {
    // first spend 4 days ago → 4 complete days (incl. zero days after it)
    const s = series('2026-09-29', 30, i => (i === 25 ? 8 : 0))
    const f = projectMonthEnd(s, '2026-09-29')!
    expect(f.basisDays).toBe(4)
    expect(f.dailyAvg).toBe(2)
    expect(f.projected).toBe(8 + 2 + 2)
  })

  it('handles the last day of the month (no days left)', () => {
    const s = series('2026-09-30', 20, () => 3)
    const f = projectMonthEnd(s, '2026-09-30')!
    expect(f.daysAfterToday).toBe(0)
    expect(f.mtd).toBe(60) // Sep 11..30
    expect(f.projected).toBe(60)
  })
})
