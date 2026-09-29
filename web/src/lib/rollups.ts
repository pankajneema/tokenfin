/**
 * Typed wrappers for the rollup RPCs (migration 011).
 *
 * usage_daily / usage_sessions / usage_daily_prompts are kept current by a
 * trigger on usage_events, so every dashboard can read O(days × dimensions)
 * rows instead of paging raw events. Days are org-local (organizations.timezone)
 * and `from` / `to` are inclusive "YYYY-MM-DD" labels in that zone — build them
 * with lib/dates (daysAgoIn / toZonedDate), never by slicing UTC ISO strings.
 *
 * Server-only: call with createAdminClient() (the RPCs are service_role only).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** usage_daily / sessions / prompts use this id for "no project". */
export const NO_PROJECT_ID = '00000000-0000-0000-0000-000000000000'

export interface DashFilters {
  project_id?: string | null
  /** lower(user_email), else user_id, else '' — see userKeyFor() */
  user_key?: string | null
  model?: string | null
  source?: string | null
  repo?: string | null
  /** agent_name, else query_source */
  agent?: string | null
}

export type DashDimension =
  | 'model' | 'project' | 'member' | 'source' | 'agent' | 'skill' | 'mcp_server' | 'repo' | 'day' | 'cost_basis'

export interface DashTotals {
  cost_usd: number
  /** everything not notional (metered + vendor_reported) — a real bill */
  metered_cost_usd: number
  /** subscription usage priced at API rates — never add to a bill */
  notional_cost_usd: number
  vendor_cost_usd: number
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  total_tokens: number
  avg_latency_ms: number | null
  active_days: number
}

export interface DashSeriesPoint {
  day: string
  cost_usd: number
  metered_cost_usd: number
  notional_cost_usd: number
  requests: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
}

export interface DashSummary extends DashTotals {
  from: string
  to: string
  timezone: string
  prompts: number
  sessions: number
  active_users: number
  /** one point per day in [from, to], zero-filled */
  series: DashSeriesPoint[]
}

export interface DashBreakdownRow extends Omit<DashTotals, 'active_days'> {
  key: string
  active_days: number
  users: number
  /** Prompts attributed to this key (migration 019); null for skill / mcp_server / cost_basis, or before 019. */
  prompts?: number | null
}

export interface DashBreakdown {
  rows: DashBreakdownRow[]
  /** sum of the keys beyond `limit` (null when everything fit) */
  other: { keys: number; requests: number; total_tokens: number; cost_usd: number; metered_cost_usd: number; notional_cost_usd: number } | null
  total_keys: number
}

export interface DashSession {
  session_id: string
  first_at: string
  last_at: string
  user_key: string
  source: string
  repo: string
  project_id: string
  model: string
  agent: string
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  cost_usd: number
}

export interface DashPrompt {
  prompt_key: string
  user_key: string
  model: string
  source: string
  repo: string
  agent: string
  project_id: string
  first_at: string
  last_at: string
  requests: number
  total_tokens: number
  cost_usd: number
}

export interface Page<T> { total: number; rows: T[] }

export interface PageOpts { limit?: number; offset?: number }

/** The rollups' per-user key for an event: lower(email), else user id, else ''. */
export function userKeyFor(e: { user_email?: string | null; user_id?: string | null }): string {
  const email = (e.user_email ?? '').trim().toLowerCase()
  return email || (e.user_id ?? '') || ''
}

function cleanFilters(f?: DashFilters): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(f ?? {})) if (v != null && v !== '') out[k] = String(v)
  return out
}

// numeric columns arrive as JSON numbers already (jsonb), but guard against
// strings from older PostgREST versions.
function numify<T>(o: any): T {
  if (Array.isArray(o)) return o.map(numify) as any
  if (o && typeof o === 'object') {
    const r: any = {}
    for (const [k, v] of Object.entries(o)) {
      r[k] = typeof v === 'string' && /(_usd|_tokens|requests|_ms|days|users|keys|prompts|sessions|total)$/.test(k) && v.trim() !== '' && !Number.isNaN(Number(v))
        ? Number(v) : numify(v)
    }
    return r
  }
  return o
}

async function call<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(`${fn} failed: ${error.message}`)
  return numify<T>(data)
}

/** Totals + a zero-filled per-day series for [from, to]. */
export function dashSummary(admin: SupabaseClient, orgId: string, from: string, to: string, filters?: DashFilters): Promise<DashSummary> {
  return call(admin, 'dash_summary', { p_org: orgId, p_from: from, p_to: to, p_filters: cleanFilters(filters) })
}

/** Top `limit` keys of one dimension by cost (`day`: chronological, unlimited). */
export function dashBreakdown(
  admin: SupabaseClient, orgId: string, from: string, to: string,
  dim: DashDimension, filters?: DashFilters, limit = 50,
): Promise<DashBreakdown> {
  return call(admin, 'dash_breakdown', { p_org: orgId, p_from: from, p_to: to, p_dim: dim, p_filters: cleanFilters(filters), p_limit: limit })
}

/** Sessions whose last activity falls in [from, to]. */
export function dashSessions(
  admin: SupabaseClient, orgId: string, from: string, to: string,
  filters?: DashFilters, opts: PageOpts & { order?: 'recent' | 'cost' | 'tokens' } = {},
): Promise<Page<DashSession>> {
  return call(admin, 'dash_sessions', {
    p_org: orgId, p_from: from, p_to: to, p_filters: cleanFilters(filters),
    p_limit: opts.limit ?? 50, p_offset: opts.offset ?? 0, p_order: opts.order ?? 'recent',
  })
}

/** Prompts (by prompt_key) active in [from, to], summed across days. */
export function dashPrompts(
  admin: SupabaseClient, orgId: string, from: string, to: string,
  filters?: DashFilters, opts: PageOpts & { order?: 'cost' | 'recent' | 'tokens' | 'requests' } = {},
): Promise<Page<DashPrompt>> {
  return call(admin, 'dash_prompts', {
    p_org: orgId, p_from: from, p_to: to, p_filters: cleanFilters(filters),
    p_limit: opts.limit ?? 50, p_offset: opts.offset ?? 0, p_order: opts.order ?? 'cost',
  })
}

/** Spend since a timestamp (org-local whole days come from usage_daily). */
export async function orgSpendSince(admin: SupabaseClient, orgId: string, since: string | Date, meteredOnly = false): Promise<number> {
  const { data, error } = await admin.rpc('org_spend_since', {
    p_org: orgId, p_since: since instanceof Date ? since.toISOString() : since, p_metered_only: meteredOnly,
  })
  if (error) throw new Error(`org_spend_since failed: ${error.message}`)
  return Number(data ?? 0)
}

/** Recompute an org's rollups from usage_events (runs automatically on a time-zone change). */
export async function rebuildRollups(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data, error } = await admin.rpc('rebuild_rollups', { p_org: orgId })
  if (error) throw new Error(`rebuild_rollups failed: ${error.message}`)
  return Number(data ?? 0)
}
