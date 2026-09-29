/**
 * Explore view — URL state (parse / validate / serialize) + pure helpers.
 *
 * Everything the Explore page shows is derived from its query string so a view
 * is shareable:  ?dim=model&range=30&project=<uuid>&member=a@b.com&…
 *   dim    one of EXPLORE_DIMS (default "model")
 *   range  7 | 30 | 90 | custom (default 30); custom needs from/to (YYYY-MM-DD,
 *          org-local, inclusive, from ≤ to, ≤ MAX_CUSTOM_DAYS days)
 *   project, member, model, source, repo, agent — filters (see FILTER_KEYS)
 *
 * Client-safe (no server imports): used by the page, FilterBar and the CSV export.
 */
import { toZonedDate, shiftDay } from '@/lib/dates'
import type { DashDimension, DashFilters } from '@/lib/rollups'

export const EXPLORE_DIMS = [
  'model', 'project', 'member', 'source', 'agent', 'skill', 'mcp_server', 'repo', 'cost_basis', 'day',
] as const satisfies readonly DashDimension[]
export type ExploreDim = (typeof EXPLORE_DIMS)[number]

export const DIM_LABELS: Record<ExploreDim, string> = {
  model: 'Model', project: 'Project', member: 'Member', source: 'Source', agent: 'Agent',
  skill: 'Skill', mcp_server: 'MCP server', repo: 'Repo', cost_basis: 'Cost basis', day: 'Day',
}

export const RANGE_PRESETS = [7, 30, 90] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]
export type ExploreRange = RangePreset | 'custom'
export const MAX_CUSTOM_DAYS = 366

/** URL filter names (short, human-readable) → DashFilters fields. */
export const FILTER_KEYS = ['project', 'member', 'model', 'source', 'repo', 'agent'] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
export const FILTER_TO_DASH: Record<FilterKey, keyof DashFilters> = {
  project: 'project_id', member: 'user_key', model: 'model', source: 'source', repo: 'repo', agent: 'agent',
}
export const FILTER_LABELS: Record<FilterKey, string> = {
  project: 'Project', member: 'Member', model: 'Model', source: 'Source', repo: 'Repo', agent: 'Agent',
}

export type ExploreFilters = Partial<Record<FilterKey, string>>

export interface ExploreState {
  dim: ExploreDim
  range: ExploreRange
  /** only for range = 'custom' */
  from?: string
  to?: string
  filters: ExploreFilters
}

export const DEFAULT_STATE: ExploreState = { dim: 'model', range: 30, filters: {} }

export type ParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FILTER_LEN = 320

function getParam(sp: ParamsLike, key: string): string | undefined {
  if (!sp) return undefined
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined
  const v = sp[key]
  return Array.isArray(v) ? v[0] : v
}

export function isExploreDim(v: unknown): v is ExploreDim {
  return typeof v === 'string' && (EXPLORE_DIMS as readonly string[]).includes(v)
}

/** A real calendar day "YYYY-MM-DD" (rejects 2026-02-30, 2026-1-5, …). */
export function isDayLabel(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const t = Date.parse(v + 'T00:00:00Z')
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
}

/** Inclusive number of days in [from, to]. */
export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
}

/** Validate a filter value for its key; returns the cleaned value or null. */
export function cleanFilterValue(key: FilterKey, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v || v.length > MAX_FILTER_LEN || /[\u0000-\u001f]/.test(v)) return null
  if (key === 'project' && !UUID_RE.test(v)) return null
  return key === 'member' && v.includes('@') ? v.toLowerCase() : v
}

/**
 * Parse + validate URL params. Never throws: invalid pieces fall back to the
 * defaults and are reported in `errors` so the page can say what it ignored.
 */
export function parseExploreParams(sp: ParamsLike): { state: ExploreState; errors: string[] } {
  const errors: string[] = []
  const state: ExploreState = { dim: DEFAULT_STATE.dim, range: DEFAULT_STATE.range, filters: {} }

  const dim = getParam(sp, 'dim')
  if (dim != null && dim !== '') {
    if (isExploreDim(dim)) state.dim = dim
    else errors.push(`Unknown group-by "${dim.slice(0, 40)}" — showing ${DIM_LABELS[state.dim]}.`)
  }

  const range = getParam(sp, 'range')
  const from = getParam(sp, 'from'), to = getParam(sp, 'to')
  const wantsCustom = range === 'custom' || ((range == null || range === '') && (from || to))
  if (wantsCustom) {
    if (!isDayLabel(from) || !isDayLabel(to)) errors.push('Custom range needs valid from/to dates (YYYY-MM-DD) — showing last 30 days.')
    else if (from > to) errors.push('Custom range "from" is after "to" — showing last 30 days.')
    else if (spanDays(from, to) > MAX_CUSTOM_DAYS) errors.push(`Custom range is limited to ${MAX_CUSTOM_DAYS} days — showing last 30 days.`)
    else { state.range = 'custom'; state.from = from; state.to = to }
  } else if (range != null && range !== '') {
    const n = Number(range)
    if ((RANGE_PRESETS as readonly number[]).includes(n) && String(n) === range) state.range = n as RangePreset
    else errors.push(`Unknown range "${range.slice(0, 20)}" — showing last 30 days.`)
  }

  for (const k of FILTER_KEYS) {
    const raw = getParam(sp, k)
    if (raw == null || raw === '') continue
    const v = cleanFilterValue(k, raw)
    if (v == null) errors.push(`Ignored invalid ${FILTER_LABELS[k].toLowerCase()} filter.`)
    else state.filters[k] = v
  }
  return { state, errors }
}

/** Serialize state → query string params (defaults omitted, stable order). */
export function toSearchParams(state: ExploreState): URLSearchParams {
  const p = new URLSearchParams()
  if (state.dim !== DEFAULT_STATE.dim) p.set('dim', state.dim)
  if (state.range === 'custom' && state.from && state.to) {
    p.set('range', 'custom'); p.set('from', state.from); p.set('to', state.to)
  } else if (state.range !== DEFAULT_STATE.range && state.range !== 'custom') {
    p.set('range', String(state.range))
  }
  for (const k of FILTER_KEYS) { const v = state.filters[k]; if (v) p.set(k, v) }
  return p
}

export function exploreHref(state: ExploreState, base = '/dashboard/explore'): string {
  const qs = toSearchParams(state).toString()
  return qs ? `${base}?${qs}` : base
}

/** Org-local inclusive [from, to] for the state (presets end today). */
export function resolveRange(state: ExploreState, tz: string, now: number = Date.now()): { from: string; to: string } {
  if (state.range === 'custom' && state.from && state.to) return { from: state.from, to: state.to }
  const days = state.range === 'custom' ? 30 : state.range
  const to = toZonedDate(now, tz)
  return { from: shiftDay(to, -(days - 1)), to }
}

export function toDashFilters(filters: ExploreFilters): DashFilters {
  const out: DashFilters = {}
  for (const k of FILTER_KEYS) { const v = filters[k]; if (v) out[FILTER_TO_DASH[k]] = v }
  return out
}

/** The filter a breakdown dimension maps to (null: skill / mcp_server / cost_basis / day). */
export function dimFilterKey(dim: ExploreDim): FilterKey | null {
  switch (dim) {
    case 'project': case 'member': case 'model': case 'source': case 'repo': case 'agent': return dim
    default: return null
  }
}

/* ── Table + CSV ─────────────────────────────────────────────────────────── */

export interface ExploreRow {
  key: string
  label: string
  metered_cost_usd: number
  notional_cost_usd: number
  cost_usd: number
  total_tokens: number
  requests: number
  /** null when the rollups can't attribute prompts to this dimension */
  prompts: number | null
  /** share of the (filtered) total cost, 0–100 */
  share_pct: number
}

export type ExploreSortKey = 'label' | 'metered_cost_usd' | 'notional_cost_usd' | 'cost_usd' | 'total_tokens' | 'requests' | 'prompts' | 'share_pct'

export function sortRows(rows: readonly ExploreRow[], key: ExploreSortKey, asc: boolean): ExploreRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key]
    let c: number
    if (typeof va === 'string' || typeof vb === 'string') c = String(va).localeCompare(String(vb))
    else c = (va ?? -1) - (vb ?? -1)
    if (c === 0) c = a.key.localeCompare(b.key)
    return asc ? c : -c
  })
}

export function sharePct(part: number, total: number): number {
  return total > 0 ? +((part / total) * 100).toFixed(1) : 0
}

function csvCell(v: string | number | null): string {
  if (v == null) return ''
  let s = String(v)
  // neutralize spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function rowsToCsv(dim: ExploreDim, rows: readonly ExploreRow[]): string {
  const head = [DIM_LABELS[dim].toLowerCase().replace(/\s+/g, '_'), 'key', 'metered_cost_usd', 'notional_cost_usd', 'total_tokens', 'requests', 'prompts', 'share_pct']
  const lines = [head.join(',')]
  for (const r of rows) {
    lines.push([
      r.label, r.key, r.metered_cost_usd.toFixed(6), r.notional_cost_usd.toFixed(6),
      r.total_tokens, r.requests, r.prompts, r.share_pct,
    ].map(csvCell).join(','))
  }
  return lines.join('\n') + '\n'
}
