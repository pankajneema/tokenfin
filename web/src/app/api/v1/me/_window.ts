/**
 * Time-window helpers for the /api/v1/me/* routes and connections (pure).
 * Windows are anchored to midnight in the WORKSPACE time zone.
 */
import { toZonedDate, shiftDay } from '@/lib/dates'

export type Period = 'daily' | 'weekly' | 'monthly'

/** Offset (ms) of `tz` from UTC at instant `t` (positive east of UTC). */
export function tzOffsetMs(tz: string, t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t))
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
  return asUtc - Math.floor(t / 1000) * 1000
}

/** UTC instant (ISO) of 00:00 on calendar day `day` (YYYY-MM-DD) in `tz`. DST-safe. */
export function midnightIn(day: string, tz: string): string {
  const guess = Date.parse(`${day}T00:00:00Z`)
  let at = guess - tzOffsetMs(tz, guess)
  const off2 = tzOffsetMs(tz, at)
  if (guess - off2 !== at) at = guess - off2
  return new Date(at).toISOString()
}

/** Today's midnight in `tz` as a UTC ISO instant. */
export function zonedMidnightIso(now: number, tz: string): string {
  return midnightIn(toZonedDate(now, tz), tz)
}

/** Start of a limit period in `tz`: daily = today, weekly = rolling 7 days, monthly = the 1st. */
export function periodStartIso(period: Period, now: number, tz: string): string {
  const today = toZonedDate(now, tz)
  if (period === 'daily')  return midnightIn(today, tz)
  if (period === 'weekly') return midnightIn(shiftDay(today, -7), tz)
  return midnightIn(today.slice(0, 8) + '01', tz)
}

export interface LimitUsage {
  id: string
  scope: string
  period: Period
  budget: number
  spent: number
  pct: number
  metric: 'cost_usd' | 'tokens'
}

/** The tightest limit = highest % used (ties → smaller remaining headroom). */
export function tightest(limits: readonly LimitUsage[]): LimitUsage | null {
  let best: LimitUsage | null = null
  for (const l of limits) {
    if (!best || l.pct > best.pct || (l.pct === best.pct && l.budget - l.spent < best.budget - best.spent)) best = l
  }
  return best
}
