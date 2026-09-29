/**
 * Date utilities. Days are bucketed in the workspace's time zone
 * (organizations.timezone, default Asia/Kolkata — the original behaviour).
 *
 * Rule: every page that slices a date string or builds a range boundary must use
 * these helpers so that usage_events + usage_agg always agree on what "today" is.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

const dayFormatters = new Map<string, Intl.DateTimeFormat>()
function dayFormatter(tz: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(tz)
  if (!f) {
    // en-CA formats as YYYY-MM-DD
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormatters.set(tz, f)
  }
  return f
}

/** True for a valid IANA time zone name ("UTC", "Europe/Berlin", …). */
export function isValidTimeZone(tz: string): boolean {
  try { dayFormatter(tz).format(0); return true } catch { return false }
}

/** "YYYY-MM-DD" of a timestamp in the given time zone. */
export function toZonedDate(ts: string | number | Date, tz: string = DEFAULT_TIMEZONE): string {
  const ms = typeof ts === 'string' ? new Date(ts).getTime() : ts instanceof Date ? ts.getTime() : ts
  return dayFormatter(isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE).format(ms)
}

/** Date string N days ago in the given time zone. */
export function daysAgoIn(n: number, tz: string = DEFAULT_TIMEZONE): string {
  return toZonedDate(Date.now() - n * 86_400_000, tz)
}

/**
 * Convert any UTC timestamp / Date to an IST date string "YYYY-MM-DD".
 * Kept for existing callers; prefer toZonedDate(ts, orgTimezone).
 */
export function toISTDate(ts: string | number | Date): string {
  return toZonedDate(ts, DEFAULT_TIMEZONE)
}

/** IST "today" as a date string. */
export function todayIST(): string {
  return toISTDate(Date.now())
}

/** IST date N days ago. */
export function daysAgoIST(n: number): string {
  return toISTDate(Date.now() - n * 86_400_000)
}

/**
 * Full ISO timestamp for N days ago (still UTC, for timestamp comparisons
 * against usage_events.created_at which is stored as UTC).
 */
export function tsNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

/**
 * A usage_agg.bucket is already a day label ("YYYY-MM-DD", possibly stored as a
 * midnight timestamp). Never re-convert it through a time zone — that shifts it
 * a day for zones west of UTC. Use these instead.
 */
export function bucketDay(bucket: string | Date): string {
  return (bucket instanceof Date ? bucket.toISOString() : String(bucket)).slice(0, 10)
}

/** Add n calendar days to a "YYYY-MM-DD" label. */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(day.slice(0, 10) + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
}
