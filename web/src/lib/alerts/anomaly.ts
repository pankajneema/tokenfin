/**
 * Robust spend-anomaly detection (median + MAD). Pure functions, no I/O.
 *
 * For every key in a scope (the whole org, each project, each member, each
 * model) we build a daily spend series. The baseline is the previous 28 days
 * EXCLUDING today, using only days that had spend ("data days") so sporadic
 * usage (e.g. a project touched twice a week) is compared with a typical
 * active day rather than a median of zeros. At least 7 data days are required.
 *
 *   z_robust = (today − median) / (1.4826 · MAD)
 *
 * 1.4826·MAD is a consistent estimator of σ for normal data. When MAD is 0
 * (perfectly flat history) the scale is floored at max(10% of the median, $0.01)
 * so a flat $2/day series still flags a $20 day but not a $2.10 day.
 * A key is flagged when z_robust > 3.5 AND today's spend > $1.
 */

export type AnomalyScope = 'org' | 'project' | 'member' | 'model'
export const ANOMALY_SCOPES: readonly AnomalyScope[] = ['org', 'project', 'member', 'model']

export const ANOMALY_Z = 3.5
export const ANOMALY_MIN_TODAY_USD = 1
export const BASELINE_DAYS = 28
export const MIN_DATA_DAYS = 7

export interface AnomalyEvent {
  cost_usd: number | string
  created_at: string
  project_id?: string | null
  user_id?: string | null
  user_email?: string | null
  model?: string | null
}

export interface AnomalyResult {
  key: string
  today: number
  median: number
  mad: number
  z: number
  dataDays: number
  flagged: boolean
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median absolute deviation (unscaled). */
export function mad(xs: readonly number[], med = median(xs)): number {
  return median(xs.map(x => Math.abs(x - med)))
}

/**
 * Score today's value against a baseline of daily values (data days only —
 * callers pass non-zero days). Returns null when there is not enough history.
 */
export function robustScore(baseline: readonly number[], today: number): Omit<AnomalyResult, 'key'> | null {
  const days = baseline.filter(v => v > 0)
  if (days.length < MIN_DATA_DAYS) return null
  const med = median(days)
  const m = mad(days, med)
  const scale = Math.max(1.4826 * m, 0.1 * med, 0.01)
  const z = (today - med) / scale
  return {
    today: +today.toFixed(4), median: +med.toFixed(4), mad: +m.toFixed(4),
    z: +z.toFixed(2), dataDays: days.length,
    flagged: z > ANOMALY_Z && today > ANOMALY_MIN_TODAY_USD,
  }
}

/** Key an event belongs to for a scope; null = excluded (e.g. no project). */
export function scopeKey(e: AnomalyEvent, scope: AnomalyScope): string | null {
  switch (scope) {
    case 'org':     return 'org'
    case 'project': return e.project_id ?? null
    case 'member':  return (e.user_email && e.user_email.toLowerCase()) || e.user_id || null
    case 'model':   return e.model ?? null
  }
}

const dayOf = (ts: string) => ts.slice(0, 10)
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)

/**
 * Evaluate every key in `scope`. `todayDay` is the UTC date (YYYY-MM-DD) being
 * scored; the baseline is the 28 days before it. Results sorted by z desc.
 */
export function detectAnomalies(
  events: readonly AnomalyEvent[],
  scope: AnomalyScope,
  todayDay: string = new Date().toISOString().slice(0, 10),
  filter?: (e: AnomalyEvent) => boolean,
): AnomalyResult[] {
  const from = addDays(todayDay, -BASELINE_DAYS)
  // key → day → spend
  const series = new Map<string, Map<string, number>>()
  for (const e of events) {
    if (filter && !filter(e)) continue
    const d = dayOf(e.created_at)
    if (d < from || d > todayDay) continue
    const k = scopeKey(e, scope)
    if (!k) continue
    let m = series.get(k)
    if (!m) series.set(k, (m = new Map()))
    m.set(d, (m.get(d) ?? 0) + Number(e.cost_usd))
  }
  const out: AnomalyResult[] = []
  for (const [key, days] of Array.from(series.entries())) {
    const today = days.get(todayDay) ?? 0
    const baseline: number[] = []
    for (const [d, v] of Array.from(days.entries())) if (d < todayDay) baseline.push(v)
    const r = robustScore(baseline, today)
    if (r) out.push({ key, ...r })
  }
  return out.sort((a, b) => b.z - a.z)
}

/** Parse the rule's anomaly scope; unknown/missing → 'org' (old rules). */
export function parseAnomalyScope(v: unknown): AnomalyScope {
  return typeof v === 'string' && (ANOMALY_SCOPES as readonly string[]).includes(v) ? v as AnomalyScope : 'org'
}
