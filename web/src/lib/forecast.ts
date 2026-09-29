/**
 * End-of-month spend projection. Pure — no I/O, no clock: the caller passes the
 * org-local "today" label (daysAgoIn(0, tz)) and a zero-filled daily series
 * (e.g. DashSummary.series) so the result is deterministic and unit-testable.
 *
 * Method: average of the trailing complete days (up to `windowDays`, default 14,
 * ending yesterday and never starting before the first day with spend) ×
 * the days left in the month, plus month-to-date. Today is still in progress,
 * so it counts as max(today so far, daily average).
 *
 * Returns null when there are fewer than `minDays` (default 3) days of history
 * — too little to project honestly.
 */
import { shiftDay } from '@/lib/dates'

export interface DailyValue { day: string; value: number }

export interface MonthEndForecast {
  /** projected month total (month-to-date + remaining) */
  projected: number
  /** month-to-date actual, including today so far */
  mtd: number
  /** trailing daily average used for the projection */
  dailyAvg: number
  /** number of complete days the average is based on */
  basisDays: number
  /** whole days left after today */
  daysAfterToday: number
  /** days in the month */
  daysInMonth: number
}

export interface ForecastOpts { windowDays?: number; minDays?: number }

/** Days in the month of a "YYYY-MM-DD" label. */
export function daysInMonthOf(day: string): number {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** First day ("YYYY-MM-01") of the month of a "YYYY-MM-DD" label. */
export function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** Month-to-date sum of a daily series (days in [month start, today]). */
export function monthToDate(series: readonly DailyValue[], today: string): number {
  const start = monthStartOf(today)
  let s = 0
  for (const p of series) if (p.day >= start && p.day <= today) s += Number(p.value) || 0
  return s
}

export function projectMonthEnd(
  series: readonly DailyValue[], today: string, opts: ForecastOpts = {},
): MonthEndForecast | null {
  const windowDays = Math.max(1, opts.windowDays ?? 14)
  const minDays = Math.max(1, opts.minDays ?? 3)

  const byDay = new Map<string, number>()
  for (const p of series) byDay.set(p.day.slice(0, 10), (byDay.get(p.day.slice(0, 10)) ?? 0) + (Number(p.value) || 0))

  const firstData = Array.from(byDay.entries())
    .filter(([d, v]) => v > 0 && d <= today)
    .map(([d]) => d)
    .sort()[0]
  if (!firstData) return null

  const yesterday = shiftDay(today, -1)
  let start = shiftDay(today, -windowDays)
  if (firstData > start) start = firstData
  if (start > yesterday) return null

  let sum = 0, basisDays = 0
  for (let d = start; d <= yesterday; d = shiftDay(d, 1)) {
    sum += byDay.get(d) ?? 0
    basisDays++
  }
  if (basisDays < minDays) return null

  const dailyAvg = sum / basisDays
  const mtd = monthToDate(Array.from(byDay, ([day, value]) => ({ day, value })), today)
  const todaySoFar = byDay.get(today) ?? 0
  const dim = daysInMonthOf(today)
  const daysAfterToday = dim - Number(today.slice(8, 10))
  const projected = mtd + Math.max(0, dailyAvg - todaySoFar) + dailyAvg * daysAfterToday

  return { projected, mtd, dailyAvg, basisDays, daysAfterToday, daysInMonth: dim }
}
