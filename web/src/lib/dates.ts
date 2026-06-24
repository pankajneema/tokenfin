/**
 * Date utilities — all dates in IST (UTC+5:30) for consistent Indian timezone display.
 *
 * Rule: every page that slices a date string or builds a range boundary must use
 * these helpers so that usage_events + usage_agg always agree on what "today" is.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000   // 5 hours 30 minutes in ms

/**
 * Convert any UTC timestamp / Date to an IST date string "YYYY-MM-DD".
 * Use this wherever you currently write `someTs.slice(0, 10)` or
 * `new Date(...).toISOString().slice(0, 10)`.
 */
export function toISTDate(ts: string | number | Date): string {
  const ms = typeof ts === 'string'
    ? new Date(ts).getTime()
    : ts instanceof Date ? ts.getTime() : ts
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * IST "today" as a date string.
 */
export function todayIST(): string {
  return toISTDate(Date.now())
}

/**
 * IST date N days ago.
 */
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
