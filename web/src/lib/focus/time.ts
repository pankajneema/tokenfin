/** Time helpers for FOCUS periods (pure). */

/** Offset (minutes, local − UTC) of `tz` at instant `ms`. */
export function tzOffsetMinutes(tz: string, ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms))
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

/** UTC instant (ISO, second precision, "Z") of local midnight starting `day` in `tz`. */
export function localMidnightUtc(day: string, tz: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let ms = guess - tzOffsetMinutes(tz, guess) * 60_000
  // Re-evaluate once in case the offset differs at the corrected instant (DST).
  ms = guess - tzOffsetMinutes(tz, ms) * 60_000
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function nextDay(day: string): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)
}

export function monthBounds(day: string): { start: string; end: string } {
  const [y, m] = day.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return { start, end: `${ny}-${String(nm).padStart(2, '0')}-01` }
}

/** Inclusive list of YYYY-MM-DD days from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = nextDay(d)) out.push(d)
  return out
}
