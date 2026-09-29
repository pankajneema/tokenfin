/**
 * Role scoping for MCP reads.
 *
 * Owners/admins (ctx.scopeUserId === null) see the whole org. Members and
 * viewers see only their OWN prompts, sessions and per-member spend. The
 * rollups key a user as lower(email), else user_id (lib/rollups userKeyFor),
 * so one person can own two keys — we resolve both and merge the results.
 *
 * Everything except resolveUserKeys is pure and unit-tested.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DashBreakdown, DashBreakdownRow, DashFilters, Page } from '@/lib/rollups'
import { NO_USER_SCOPE } from '@/lib/rbac'
import type { KeyCtx } from './types'

/** Org-wide caller → null. Scoped caller → the user_key values that are "me" (never empty). */
export type UserScope = null | string[]

/** The rollup user_keys that identify one person. Fails closed to a sentinel. */
export function userKeysFor(email: string | null | undefined, userId: string | null | undefined): string[] {
  const keys = new Set<string>()
  const e = (email ?? '').trim().toLowerCase()
  if (e) keys.add(e)
  if (userId) keys.add(userId)
  return keys.size ? Array.from(keys) : [NO_USER_SCOPE]
}

export async function resolveUserKeys(admin: SupabaseClient, ctx: KeyCtx): Promise<UserScope> {
  if (ctx.scopeUserId === null) return null
  if (ctx.scopeUserId === NO_USER_SCOPE) return [NO_USER_SCOPE]
  let email: string | null = null
  try {
    const { data } = await admin.auth.admin.getUserById(ctx.scopeUserId)
    email = data?.user?.email ?? null
  } catch { /* fall back to the user id alone */ }
  return userKeysFor(email, ctx.scopeUserId)
}

/**
 * The per-user filter sets to run for a query. Org-wide callers get their
 * filters as-is (one run). Scoped callers get one run per own user_key; a
 * requested user_key that isn't theirs yields no runs (→ empty result, never
 * someone else's data).
 */
export function scopedFilterSets(filters: DashFilters, scope: UserScope): DashFilters[] {
  if (scope === null) return [filters]
  const want = filters.user_key ? String(filters.user_key).trim().toLowerCase() : null
  const keys = want ? scope.filter(k => k.toLowerCase() === want) : scope
  return keys.map(k => ({ ...filters, user_key: k }))
}

const SUM_FIELDS = [
  'cost_usd', 'metered_cost_usd', 'notional_cost_usd', 'vendor_cost_usd', 'requests',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'total_tokens',
] as const

/** Merge breakdowns of the same dimension run for different user_keys. */
export function mergeBreakdowns(parts: DashBreakdown[], limit: number): DashBreakdown {
  if (parts.length === 1) return parts[0]
  const byKey = new Map<string, DashBreakdownRow>()
  for (const p of parts) {
    for (const r of p.rows) {
      const cur = byKey.get(r.key)
      if (!cur) { byKey.set(r.key, { ...r }); continue }
      const m = cur as unknown as Record<string, number>
      for (const f of SUM_FIELDS) m[f] = Number(m[f] ?? 0) + Number((r as unknown as Record<string, number>)[f] ?? 0)
      cur.active_days = Math.max(cur.active_days, r.active_days)
      cur.users = Math.max(cur.users, r.users)
      cur.avg_latency_ms = cur.avg_latency_ms ?? r.avg_latency_ms
    }
  }
  const rows = Array.from(byKey.values()).sort((a, b) => b.cost_usd - a.cost_usd)
  const kept = rows.slice(0, limit)
  const rest = rows.slice(limit)
  const others = parts.map(p => p.other).filter(Boolean) as NonNullable<DashBreakdown['other']>[]
  const other = rest.length || others.length ? {
    keys: rest.length + others.reduce((s, o) => s + o.keys, 0),
    requests: rest.reduce((s, r) => s + r.requests, 0) + others.reduce((s, o) => s + o.requests, 0),
    total_tokens: rest.reduce((s, r) => s + r.total_tokens, 0) + others.reduce((s, o) => s + o.total_tokens, 0),
    cost_usd: rest.reduce((s, r) => s + r.cost_usd, 0) + others.reduce((s, o) => s + o.cost_usd, 0),
    metered_cost_usd: rest.reduce((s, r) => s + r.metered_cost_usd, 0) + others.reduce((s, o) => s + o.metered_cost_usd, 0),
    notional_cost_usd: rest.reduce((s, r) => s + r.notional_cost_usd, 0) + others.reduce((s, o) => s + o.notional_cost_usd, 0),
  } : null
  return { rows: kept, other, total_keys: rows.length + (others.reduce((s, o) => s + o.keys, 0)) }
}

/**
 * Merge pages (sessions / prompts) fetched per user_key — each fetched with
 * offset 0 and limit offset+limit — then dedupe by id, re-sort and slice.
 */
export function mergePages<T>(
  parts: Page<T>[], idOf: (r: T) => string, cmp: (a: T, b: T) => number, limit: number, offset = 0,
): Page<T> {
  const seen = new Map<string, T>()
  for (const p of parts) for (const r of p.rows) if (!seen.has(idOf(r))) seen.set(idOf(r), r)
  return {
    total: parts.reduce((s, p) => s + p.total, 0),
    rows: Array.from(seen.values()).sort(cmp).slice(offset, offset + limit),
  }
}

/** True when a row's user_key belongs to the caller's scope. */
export function inScope(userKey: string | null | undefined, scope: UserScope): boolean {
  if (scope === null) return true
  const k = (userKey ?? '').toLowerCase()
  return !!k && scope.some(s => s.toLowerCase() === k)
}
