/**
 * Pure helpers for MCP tool arguments: org-local date ranges, filters, and the
 * month-to-date forecast. No I/O — unit-tested in range.test.ts.
 */
import { shiftDay } from '@/lib/dates'
import type { DashDimension, DashFilters, DashSeriesPoint } from '@/lib/rollups'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 366

function validDay(s: unknown): s is string {
  return typeof s === 'string' && DAY_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s
}

/**
 * Inclusive [from, to] org-local day labels. `from`/`to` (YYYY-MM-DD) win over
 * `days` (default 30, 1–366). `today` is today's label in the org time zone.
 */
export function parseRange(args: Record<string, unknown>, today: string): { from: string; to: string; days: number } {
  if (args.from !== undefined && !validDay(args.from)) throw new Error('from must be a YYYY-MM-DD date')
  if (args.to !== undefined && !validDay(args.to)) throw new Error('to must be a YYYY-MM-DD date')
  const days = Math.min(Math.max(Math.floor(Number(args.days) || 30), 1), MAX_RANGE_DAYS)
  const to = (args.to as string | undefined) ?? today
  const from = (args.from as string | undefined) ?? shiftDay(to, -(days - 1))
  if (from > to) throw new Error('from must be on or before to')
  const span = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1
  if (span > MAX_RANGE_DAYS) throw new Error(`range is limited to ${MAX_RANGE_DAYS} days`)
  return { from, to, days: span }
}

export const BREAKDOWN_DIMS = ['model', 'project', 'member', 'source', 'agent', 'skill', 'mcp_server', 'repo'] as const
export type BreakdownDim = typeof BREAKDOWN_DIMS[number] & DashDimension

export function parseDim(v: unknown): BreakdownDim {
  if (typeof v === 'string' && (BREAKDOWN_DIMS as readonly string[]).includes(v)) return v as BreakdownDim
  throw new Error(`dim must be one of: ${BREAKDOWN_DIMS.join(', ')}`)
}

const FILTER_KEYS = ['project_id', 'user_key', 'model', 'source', 'repo', 'agent'] as const

/** Keeps only known filter keys with short string values. */
export function parseFilters(v: unknown): DashFilters {
  const out: DashFilters = {}
  if (!v || typeof v !== 'object') return out
  for (const k of FILTER_KEYS) {
    const val = (v as Record<string, unknown>)[k]
    if (typeof val === 'string' && val.trim() && val.length <= 320) out[k] = val.trim()
  }
  if (out.project_id && !/^[0-9a-f-]{36}$/i.test(out.project_id)) throw new Error('filters.project_id must be a project UUID (see list_projects)')
  return out
}

export function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

const r4 = (n: number) => +n.toFixed(4)

export interface Forecast {
  month: string
  day_of_month: number
  days_in_month: number
  mtd: { cost_usd: number; metered_cost_usd: number; notional_cost_usd: number }
  trailing_days: number
  trailing_avg_daily: { cost_usd: number; metered_cost_usd: number; notional_cost_usd: number }
  projected_month_end: { cost_usd: number; metered_cost_usd: number; notional_cost_usd: number }
  method: string
}

/**
 * Trailing-average forecast. `trailing` holds the last N COMPLETE days (today
 * excluded, since it is partial). Projection = MTD spend + avg/day × days left
 * after today + max(0, avg − today so far) for the rest of today. Never below
 * MTD. Metered and notional are projected separately and never mixed.
 */
export function forecastMonth(
  today: string,
  mtdSeries: Pick<DashSeriesPoint, 'day' | 'cost_usd' | 'metered_cost_usd' | 'notional_cost_usd'>[],
  trailing: Pick<DashSeriesPoint, 'day' | 'cost_usd' | 'metered_cost_usd' | 'notional_cost_usd'>[],
): Forecast {
  const dom = Number(today.slice(8, 10))
  const dim = daysInMonth(today)
  const left = dim - dom
  const fields = ['cost_usd', 'metered_cost_usd', 'notional_cost_usd'] as const
  const mtd = { cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0 }
  const todaySoFar = { cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0 }
  for (const p of mtdSeries) for (const f of fields) {
    mtd[f] += Number(p[f] ?? 0)
    if (p.day === today) todaySoFar[f] += Number(p[f] ?? 0)
  }
  const n = trailing.length
  const avg = { cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0 }
  for (const f of fields) avg[f] = n ? trailing.reduce((s, p) => s + Number(p[f] ?? 0), 0) / n : 0
  const proj = { cost_usd: 0, metered_cost_usd: 0, notional_cost_usd: 0 }
  for (const f of fields) proj[f] = Math.max(mtd[f], mtd[f] + avg[f] * left + Math.max(0, avg[f] - todaySoFar[f]))
  const round = (o: typeof mtd) => ({ cost_usd: r4(o.cost_usd), metered_cost_usd: r4(o.metered_cost_usd), notional_cost_usd: r4(o.notional_cost_usd) })
  return {
    month: today.slice(0, 7),
    day_of_month: dom,
    days_in_month: dim,
    mtd: round(mtd),
    trailing_days: n,
    trailing_avg_daily: round(avg),
    projected_month_end: round(proj),
    method: `month-to-date + trailing ${n}-day average × remaining days`,
  }
}
