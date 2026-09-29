/**
 * Pure helpers for the traces pages (unit-tested in _lib.test.ts): range →
 * org-local start instant, keyset cursor, and the waterfall tree.
 */
import { daysAgoIn } from '@/lib/dates'

export const RANGES = ['24h', 'today', '7d', '30d'] as const
export type Range = typeof RANGES[number]
export const RANGE_LABEL: Record<Range, string> = { '24h': 'Last 24 hours', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }
export const asRange = (v: unknown): Range => (RANGES as readonly string[]).includes(String(v)) ? v as Range : '7d'

/** Offset (ms) of `tz` from UTC at instant `ms`. */
function tzOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms)
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000
}

/** The UTC instant of 00:00 on calendar day `day` (YYYY-MM-DD) in `tz`. */
export function zonedMidnightIso(day: string, tz: string): string {
  const guess = Date.parse(`${day}T00:00:00Z`)
  let t = guess - tzOffset(guess, tz)
  t = guess - tzOffset(t, tz)          // second pass settles DST edges
  return new Date(t).toISOString()
}

/** Inclusive lower bound for a range; day ranges start at org-local midnight. */
export function rangeStartIso(range: Range, tz: string, now = Date.now()): string {
  if (range === '24h') return new Date(now - 86_400_000).toISOString()
  const days = range === 'today' ? 0 : range === '7d' ? 6 : 29
  return zonedMidnightIso(daysAgoIn(days, tz), tz)
}

// ── keyset cursor over (start_time DESC, trace_id DESC) ──────────────────────
export interface Cursor { t: string; id: string }
export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.t, c.id])).toString('base64url')
export function decodeCursor(s: unknown): Cursor | null {
  if (typeof s !== 'string' || !s) return null
  try {
    const [t, id] = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
    if (typeof t !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(t)) || !/^[\w-]{1,64}$/.test(id)) return null
    return { t, id }
  } catch { return null }
}
/** PostgREST `or=` filter for rows strictly after the cursor in DESC order. */
export function cursorFilter(c: Cursor): string {
  const t = `"${new Date(c.t).toISOString()}"`
  return `start_time.lt.${t},and(start_time.eq.${t},trace_id.lt.${c.id})`
}

// ── waterfall ───────────────────────────────────────────────────────────────
export interface TreeSpanIn {
  span_id: string
  parent_span_id: string | null
  start_time: string | null
  end_time: string | null
  duration_ms: number | null
  total_tokens: number
}
export interface TreeRow<T> { span: T; depth: number; offsetPct: number; widthPct: number; startMs: number; durMs: number; aggregate: boolean; childCount: number }

/**
 * Spans in DFS order (children by start time), with depth and bars scaled to
 * the trace window. Orphans (parent never arrived) are roots. `aggregate` marks
 * spans with a token-bearing child — their tokens are not counted again.
 */
export function buildWaterfall<T extends TreeSpanIn>(spans: T[]): { rows: TreeRow<T>[]; t0: number; totalMs: number } {
  const startOf = (s: T) => (s.start_time ? Date.parse(s.start_time) : NaN)
  const endOf = (s: T) => {
    if (s.end_time) return Date.parse(s.end_time)
    const st = startOf(s)
    return Number.isFinite(st) ? st + Number(s.duration_ms ?? 0) : NaN
  }
  const starts = spans.map(startOf).filter(Number.isFinite)
  const ends = spans.map(endOf).filter(Number.isFinite)
  const t0 = starts.length ? Math.min(...starts) : 0
  const t1 = ends.length ? Math.max(...ends) : t0
  const totalMs = Math.max(t1 - t0, 0)
  const scale = Math.max(totalMs, 1)

  const ids = new Set(spans.map(s => s.span_id))
  const kids = new Map<string, T[]>()
  const roots: T[] = []
  const usageParents = new Set<string>()
  for (const s of spans) {
    if (s.parent_span_id && Number(s.total_tokens) > 0) usageParents.add(s.parent_span_id)
    if (s.parent_span_id && ids.has(s.parent_span_id) && s.parent_span_id !== s.span_id) {
      const l = kids.get(s.parent_span_id) ?? []
      l.push(s)
      kids.set(s.parent_span_id, l)
    } else roots.push(s)
  }
  const byStart = (a: T, b: T) => (startOf(a) || 0) - (startOf(b) || 0) || a.span_id.localeCompare(b.span_id)

  const rows: TreeRow<T>[] = []
  const seen = new Set<string>()
  const walk = (s: T, depth: number) => {
    if (seen.has(s.span_id)) return
    seen.add(s.span_id)
    const st = startOf(s), en = endOf(s)
    const startMs = Number.isFinite(st) ? st - t0 : 0
    const durMs = s.duration_ms != null ? Number(s.duration_ms) : Number.isFinite(st) && Number.isFinite(en) ? Math.max(0, en - st) : 0
    const children = (kids.get(s.span_id) ?? []).sort(byStart)
    rows.push({
      span: s, depth, startMs, durMs,
      offsetPct: Math.min(100, (startMs / scale) * 100),
      widthPct: Math.max(0.4, Math.min(100 - Math.min(100, (startMs / scale) * 100), (durMs / scale) * 100)),
      aggregate: usageParents.has(s.span_id), childCount: children.length,
    })
    for (const c of children) walk(c, depth + 1)
  }
  for (const r of roots.sort(byStart)) walk(r, 0)
  // Cycles (malformed parents) never reached from a root: append flat.
  for (const s of spans) if (!seen.has(s.span_id)) walk(s, 0)
  return { rows, t0, totalMs }
}
