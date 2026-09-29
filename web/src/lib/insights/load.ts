/**
 * Insights loader — server-only. Fetches the rollups + bounded raw reads the
 * pure rules need and returns findings + explained spikes for one org (or one
 * member when `userKey` is set). Used by /dashboard/insights and
 * GET /api/v1/insights.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgoIn, shiftDay, tsNDaysAgo } from '@/lib/dates'
import { dashBreakdown, dashSessions, dashSummary, NO_PROJECT_ID, type DashFilters } from '@/lib/rollups'
import { getOrgPrices } from '@/lib/pricing-overrides'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { isExpensive, makePricer } from './pricer'
import {
  DEFAULT_SEAT_USD, errorStorms, expensiveShortCalls, idleSeats, keyHygiene, lowCacheReuse,
  runawaySessions, sortFindings, totalsOf,
  type CallSample, type ErrorRow, type KeyRow, type ModelUsage, type SeatUsage,
} from './waste'
import { detectSpikes, explainSpike, type BreakRow } from './spikes'
import type { SeatRow, UsageGroup } from './whatif'
import type { ExplainedSpike, Finding, InsightsResult, SpikeDim } from './types'

export interface InsightsOpts {
  timezone: string
  /** limit everything to one member's rollup key (lower(email) or user id); null = whole org */
  userKey?: string | null
  seatUsd?: number
  now?: number
  /** max spikes to explain (most recent first) */
  maxSpikes?: number
}

/** Max raw rows sampled per expensive model for the median-output rule. */
export const SAMPLE_LIMIT = 1000
const MAX_SAMPLED_MODELS = 5
const SPIKE_LOOKBACK = 30
const SPIKE_WINDOW = 14

/** A caller's rollup user key: lower(email) when known, else the user id. */
export function userKeyOf(email: string | null | undefined, userId: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e || userId || null
}

async function modelUsage(admin: SupabaseClient, orgId: string, from: string, to: string, filters: DashFilters): Promise<ModelUsage[]> {
  const b = await dashBreakdown(admin, orgId, from, to, 'model', filters, 100)
  return b.rows.map(r => ({
    model: r.key, requests: r.requests,
    input_tokens: r.input_tokens, output_tokens: r.output_tokens,
    cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
    cost_usd: r.cost_usd, metered_cost_usd: r.metered_cost_usd, notional_cost_usd: r.notional_cost_usd,
  }))
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

async function sampleCalls(admin: SupabaseClient, orgId: string, model: string, userKey: string | null): Promise<CallSample[]> {
  let q = admin.from('usage_events').select('output_tokens, cost_usd')
    .eq('org_id', orgId).eq('model', model).gte('created_at', tsNDaysAgo(30))
  if (userKey) q = userKey.includes('@') ? q.ilike('user_email', escapeLike(userKey)) : q.eq('user_id', userKey)
  // Bounded on purpose: the newest SAMPLE_LIMIT calls are a sample, not a total.
  const { data, error } = await q.order('created_at', { ascending: false }).limit(SAMPLE_LIMIT)
  if (error) throw new Error(`sample ${model}: ${error.message}`)
  return (data ?? []).map((r: { output_tokens: number | string | null; cost_usd: number | string | null }) => ({
    output_tokens: Number(r.output_tokens ?? 0), cost_usd: Number(r.cost_usd ?? 0),
  }))
}

async function errorRows(admin: SupabaseClient, orgId: string, from: string, userKey: string | null): Promise<ErrorRow[]> {
  try {
    const rows = await fetchAllRows<{ user_key: string; model: string; day: string; errors: number }>((a, b) => {
      let q = admin.from('api_errors_daily').select('user_key, model, day, errors').eq('org_id', orgId).gte('day', from)
      if (userKey) q = q.eq('user_key', userKey)
      return q.order('day').order('user_key').order('model').range(a, b)
    })
    return rows.map(r => ({ user_key: r.user_key ?? '', model: r.model ?? '', day: String(r.day).slice(0, 10), errors: Number(r.errors ?? 0) }))
  } catch { return [] }  // table missing before migration 007
}

async function sessionFindings(admin: SupabaseClient, orgId: string, from: string, to: string, filters: DashFilters, notionalShare: number, models: ModelUsage[]): Promise<Finding[]> {
  const head = await dashSessions(admin, orgId, from, to, filters, { order: 'cost', limit: 20 })
  if (head.total < 20) return []
  // P95 by nearest rank on the cost-ordered list: the row at offset floor(5% of n).
  const off = Math.floor(head.total * 0.05)
  const at = off < head.rows.length ? head.rows[off] : (await dashSessions(admin, orgId, from, to, filters, { order: 'cost', limit: 1, offset: off })).rows[0]
  const p95 = at?.cost_usd ?? 0
  return runawaySessions(head.rows, p95, head.total, notionalShare, 5, models)
}

async function keyRows(admin: SupabaseClient, orgId: string): Promise<KeyRow[]> {
  return fetchAllRows<KeyRow>((a, b) => admin.from('api_keys')
    .select('id, name, key_prefix, project_id, user_id, created_by, kind, device_id, last_used_at, created_at')
    .eq('org_id', orgId).eq('is_active', true).order('created_at').order('id').range(a, b))
}

async function seatUsage(admin: SupabaseClient, orgId: string, from: string, to: string): Promise<SeatUsage[]> {
  const prevTo = shiftDay(from, -1), prevFrom = shiftDay(from, -60)
  const [cur, prev] = await Promise.all([
    dashBreakdown(admin, orgId, from, to, 'member', {}, 1000),
    dashBreakdown(admin, orgId, prevFrom, prevTo, 'member', {}, 1000),
  ])
  const m = new Map<string, SeatUsage>()
  for (const r of prev.rows) if (r.key) m.set(r.key, { user_key: r.key, requests: 0, notional_cost_usd: 0, prev_notional_cost_usd: r.notional_cost_usd })
  for (const r of cur.rows) {
    if (!r.key) continue
    const s = m.get(r.key) ?? { user_key: r.key, requests: 0, notional_cost_usd: 0, prev_notional_cost_usd: 0 }
    s.requests = r.requests; s.notional_cost_usd = r.notional_cost_usd
    m.set(r.key, s)
  }
  return [...m.values()]
}

async function projectNames(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const { data } = await admin.from('projects').select('id, name').eq('org_id', orgId).limit(1000)
  const m = new Map<string, string>((data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
  m.set(NO_PROJECT_ID, 'No project')
  return m
}

export async function loadSpikes(
  admin: SupabaseClient, orgId: string, tz: string, filters: DashFilters, max = 5, names?: Map<string, string>,
): Promise<ExplainedSpike[]> {
  const to = daysAgoIn(0, tz)
  const since = shiftDay(to, -(SPIKE_LOOKBACK - 1))
  const from = shiftDay(since, -SPIKE_WINDOW)
  const sum = await dashSummary(admin, orgId, from, to, filters)
  const spikes = detectSpikes(sum.series.map(p => ({ day: p.day, cost: p.cost_usd })), { window: SPIKE_WINDOW, since })
  if (!spikes.length) return []
  const pn = names ?? await projectNames(admin, orgId)
  const fetch = async (dim: SpikeDim, f: string, t: string, fl: DashFilters): Promise<BreakRow[]> =>
    (await dashBreakdown(admin, orgId, f, t, dim, fl, 25)).rows.map(r => ({ key: r.key, cost_usd: r.cost_usd }))
  const label = (dim: SpikeDim, key: string) =>
    dim === 'project' ? (pn.get(key) ?? key) : key || '(none)'
  const recent = spikes.slice(-max).reverse()
  return Promise.all(recent.map(s => explainSpike(s, fetch, { base: filters, label })))
}

export async function computeInsights(admin: SupabaseClient, orgId: string, opts: InsightsOpts): Promise<InsightsResult> {
  const tz = opts.timezone
  const userKey = opts.userKey ?? null
  const seatUsd = opts.seatUsd && opts.seatUsd > 0 ? opts.seatUsd : DEFAULT_SEAT_USD
  const to = daysAgoIn(0, tz)
  const from = shiftDay(to, -29)
  const w = { from, to }
  const filters: DashFilters = userKey ? { user_key: userKey } : {}

  const [models, overrides, names] = await Promise.all([
    modelUsage(admin, orgId, from, to, filters),
    getOrgPrices(admin, orgId),
    projectNames(admin, orgId),
  ])
  const pricer = makePricer(overrides)
  const hasUsage = models.some(m => m.requests > 0)
  const totalCost = models.reduce((a, m) => a + m.cost_usd, 0)
  const notionalShare = totalCost > 0 ? models.reduce((a, m) => a + m.notional_cost_usd, 0) / totalCost : 0

  const expensive = models.filter(m => m.requests >= 20 && isExpensive(pricer.price(m.model)))
    .sort((a, b) => b.cost_usd - a.cost_usd).slice(0, MAX_SAMPLED_MODELS)

  const [samples, errors, sessions, keys, seats, spikes] = await Promise.all([
    Promise.all(expensive.map(async m => [m.model, await sampleCalls(admin, orgId, m.model, userKey)] as const)).then(e => new Map(e)),
    errorRows(admin, orgId, from, userKey),
    hasUsage ? sessionFindings(admin, orgId, from, to, filters, notionalShare, models) : Promise.resolve([]),
    userKey ? Promise.resolve([] as KeyRow[]) : keyRows(admin, orgId),
    userKey ? Promise.resolve([] as SeatUsage[]) : seatUsage(admin, orgId, from, to),
    hasUsage ? loadSpikes(admin, orgId, tz, filters, opts.maxSpikes ?? 5, names) : Promise.resolve([]),
  ])

  const findings = sortFindings([
    ...expensiveShortCalls(models, samples, pricer, w),
    ...lowCacheReuse(models, pricer, w),
    ...errorStorms(errors, models, w),
    ...sessions,
    ...keyHygiene(keys, opts.now),
    ...idleSeats(seats, seatUsd, w),
  ])

  return {
    org_id: orgId,
    generated_at: new Date(opts.now ?? Date.now()).toISOString(),
    timezone: tz,
    window: w,
    has_usage: hasUsage,
    scoped_to: userKey,
    findings,
    totals: totalsOf(findings),
    spikes,
    assumptions: { seat_usd: seatUsd },
  }
}

/* ── What-if inputs ─────────────────────────────────────────────────────── */

export interface WhatIfData {
  window: { from: string; to: string }
  groups: UsageGroup[]
  seats: SeatRow[]
  recorded: { metered_usd: number; notional_usd: number }
}

/** Last-30-day tokens per (model, cost basis), exact from the rollups. */
export async function loadWhatIfData(admin: SupabaseClient, orgId: string, tz: string, userKey: string | null): Promise<WhatIfData> {
  const to = daysAgoIn(0, tz)
  const from = shiftDay(to, -29)
  const filters: DashFilters = userKey ? { user_key: userKey } : {}
  const models = await dashBreakdown(admin, orgId, from, to, 'model', filters, 40)
  const perModel = await Promise.all(models.rows.map(async m =>
    [m.key, await dashBreakdown(admin, orgId, from, to, 'cost_basis', { ...filters, model: m.key }, 10)] as const))
  const groups: UsageGroup[] = []
  for (const [model, b] of perModel) {
    const acc: Record<'metered' | 'notional', UsageGroup> = {
      metered: { model, basis: 'metered', requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      notional: { model, basis: 'notional', requests: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    }
    for (const r of b.rows) {
      const g = acc[r.key === 'notional' ? 'notional' : 'metered']
      g.requests += r.requests; g.input_tokens += r.input_tokens; g.output_tokens += r.output_tokens
      g.cache_read_tokens += r.cache_read_tokens; g.cache_write_tokens += r.cache_write_tokens
    }
    for (const g of Object.values(acc)) if (g.requests > 0 || g.input_tokens + g.output_tokens > 0) groups.push(g)
  }
  const seats: SeatRow[] = userKey ? [] : (await dashBreakdown(admin, orgId, from, to, 'member', {}, 1000)).rows
    .filter(r => r.key && r.notional_cost_usd > 0)
    .map(r => ({ user_key: r.key, notional_cost_usd: r.notional_cost_usd }))
  const recorded = models.rows.reduce((a, r) => ({ metered_usd: a.metered_usd + r.metered_cost_usd, notional_usd: a.notional_usd + r.notional_cost_usd }), { metered_usd: 0, notional_usd: 0 })
  if (models.other) { recorded.metered_usd += models.other.metered_cost_usd; recorded.notional_usd += models.other.notional_cost_usd }
  return { window: { from, to }, groups, seats, recorded }
}
