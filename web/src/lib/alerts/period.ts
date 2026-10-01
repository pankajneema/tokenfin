/**
 * Calendar periods in the workspace time zone (organizations.timezone). Pure.
 *
 *   daily   → today, local midnight to midnight
 *   weekly  → ISO week, Monday 00:00 local
 *   monthly → calendar month, the 1st 00:00 local
 *
 * `key` identifies the period (limit_events.period_key): "d2026-09-30",
 * "w2026-09-28" (the Monday), "m2026-09". `fromDay` is the first org-local day
 * label (usage_daily.day is already org-local), `resetsAt` the UTC instant the
 * next period starts.
 */
import { toZonedDate, shiftDay } from '@/lib/dates'

export type Period = 'daily' | 'weekly' | 'monthly'

export interface PeriodWindow {
  period:   Period
  key:      string
  fromDay:  string
  /** First day of the NEXT period (org-local label). */
  nextDay:  string
  /** ISO timestamp (UTC) when the next period starts in the org zone. */
  resetsAt: string
  /** "today" | "this week" | "this month" */
  label:    string
}

/** Offset (ms) of `tz` from UTC at instant `ms` (positive east of UTC). */
export function tzOffsetMs(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(ms)
    const g = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
    return asUtc - Math.floor(ms / 1000) * 1000
  } catch { return 0 }
}

/** UTC instant of 00:00 on org-local `day` ("YYYY-MM-DD") in `tz` (DST-safe). */
export function zonedMidnightUtc(day: string, tz: string): Date {
  const guess = Date.parse(day + 'T00:00:00Z')
  let t = guess - tzOffsetMs(guess, tz)
  // Second pass: the offset at the real instant can differ across a DST change.
  t = guess - tzOffsetMs(t, tz)
  return new Date(t)
}

/** Monday of the ISO week containing `day`. */
export function isoWeekStart(day: string): string {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay()     // 0 = Sunday
  return shiftDay(day, -((dow + 6) % 7))
}

export function periodWindow(period: Period, now: Date = new Date(), tz = 'UTC'): PeriodWindow {
  const today = toZonedDate(now, tz)
  let fromDay: string, nextDay: string, key: string, label: string
  if (period === 'daily') {
    fromDay = today; nextDay = shiftDay(today, 1); key = 'd' + today; label = 'today'
  } else if (period === 'weekly') {
    fromDay = isoWeekStart(today); nextDay = shiftDay(fromDay, 7); key = 'w' + fromDay; label = 'this week'
  } else {
    fromDay = today.slice(0, 8) + '01'
    const [y, m] = today.split('-').map(Number)
    nextDay = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
    key = 'm' + today.slice(0, 7); label = 'this month'
  }
  return { period, key, fromDay, nextDay, resetsAt: zonedMidnightUtc(nextDay, tz).toISOString(), label }
}
