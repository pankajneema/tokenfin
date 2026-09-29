/**
 * Spend forecast + budget runway. Pure functions, no I/O. All days are UTC
 * (matching how limits compute period-to-date spend).
 *
 * Run-rate: the 14 complete days before today, weighted toward the recent 7
 * (each of the last 7 days weighs 0.7/7, each of days 8–14 weighs 0.3/7).
 * Days before the scope's first day with any spend are ignored, so a brand-new
 * project isn't diluted by 14 days of zeros it never had.
 *
 * Projection to period end:
 *   monthly / daily  → spent_so_far + rate × days_remaining (fractional)
 *   weekly (rolling 7d window, as the Limits page defines it)
 *                    → max(spent_so_far, rate × 7)
 * Runway = (budget − spent) / rate days; null when rate is 0 (never runs out).
 */

export type Period = 'daily' | 'weekly' | 'monthly'

export const RATE_WINDOW = 14
const DAY = 86400_000

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const startOfDay = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }

/** Sum `cost_usd` per UTC day. */
export function dailyTotals(events: readonly { cost_usd: number | string; created_at: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) {
    const d = e.created_at.slice(0, 10)
    m.set(d, (m.get(d) ?? 0) + Number(e.cost_usd))
  }
  return m
}

/** Weighted daily run-rate ($/day) from the 14 complete days before `now`. */
export function runRate(daily: ReadonlyMap<string, number>, now: Date = new Date()): number {
  const today0 = startOfDay(now.getTime())
  const days: { v: number; w: number; d: string }[] = []
  for (let i = 1; i <= RATE_WINDOW; i++) {
    const d = dayStr(today0 - i * DAY)
    days.push({ d, v: daily.get(d) ?? 0, w: i <= 7 ? 0.7 / 7 : 0.3 / 7 })
  }
  // First day (oldest) with spend inside the window — ignore anything older.
  const withData = days.filter(x => x.v > 0)
  if (withData.length === 0) return 0
  const first = withData[withData.length - 1].d
  let num = 0, den = 0
  for (const x of days) if (x.d >= first) { num += x.v * x.w; den += x.w }
  return den > 0 ? +(num / den).toFixed(6) : 0
}

/** Period window [start, end) in ms. Weekly is the rolling 7 days. */
export function periodBounds(period: Period, now: Date = new Date()): { start: number; end: number } {
  const t = now.getTime()
  const d0 = startOfDay(t)
  if (period === 'daily')  return { start: d0, end: d0 + DAY }
  if (period === 'weekly') return { start: d0 - 7 * DAY, end: t }
  const n = new Date(t)
  return { start: Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1), end: Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1) }
}

/** UTC date string a period-to-date sum starts from (same as the Limits page). */
export function periodStartDay(period: Period, now: Date = new Date()): string {
  return dayStr(periodBounds(period, now).start)
}

export interface LimitForecast {
  rate: number               // $/day
  projected: number          // projected spend at period end
  projectedPct: number       // projected / budget × 100
  runwayDays: number | null  // days until budget is exhausted at `rate`; 0 = already over; null = never
  exceedDate: string | null  // YYYY-MM-DD the budget is projected to be exceeded within this period, else null
  onTrack: boolean           // projected <= budget
}

export function forecastLimit(input: { budget: number; spent: number; rate: number; period: Period; now?: Date }): LimitForecast {
  const { budget, spent, rate, period } = input
  const now = input.now ?? new Date()
  const t = now.getTime()
  const { end } = periodBounds(period, now)
  const remainingDays = Math.max(0, (end - t) / DAY)
  const projected = period === 'weekly' ? Math.max(spent, rate * 7) : spent + rate * remainingDays

  const runwayDays = spent >= budget ? 0 : rate > 0 ? (budget - spent) / rate : null
  let exceedDate: string | null = null
  if (budget > 0 && projected > budget) {
    exceedDate = spent >= budget ? dayStr(t) : dayStr(t + (runwayDays ?? 0) * DAY)
  }
  return {
    rate: +rate.toFixed(4),
    projected: +projected.toFixed(4),
    projectedPct: budget > 0 ? +((projected / budget) * 100).toFixed(1) : 0,
    runwayDays: runwayDays == null ? null : +runwayDays.toFixed(1),
    exceedDate,
    onTrack: !(budget > 0 && projected > budget),
  }
}

/** Month-end projection for arbitrary spend (e.g. the whole org). */
export function projectMonthEnd(events: readonly { cost_usd: number | string; created_at: string }[], now: Date = new Date()) {
  const daily = dailyTotals(events)
  const from = periodStartDay('monthly', now)
  let mtd = 0
  for (const [d, v] of Array.from(daily.entries())) if (d >= from) mtd += v
  const rate = runRate(daily, now)
  const f = forecastLimit({ budget: Infinity, spent: mtd, rate, period: 'monthly', now })
  return { mtd: +mtd.toFixed(4), rate: f.rate, projected: f.projected }
}
