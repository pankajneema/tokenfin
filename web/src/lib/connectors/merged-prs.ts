/**
 * Cost per merged PR — server loader + pure summariser for the MergedPrs
 * component (components/dashboard/merged-prs.tsx). Attribution happens in SQL
 * (merged_pr_costs): TokenFin usage in the PR's repo by the PR's author between
 * the author's previous merge in that repo (else the PR's open time) and this merge.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'

export interface MergedPrCostRow {
  repo: string; number: number; title: string; author_login: string; user_key: string | null
  merged_at: string; window_start: string; additions: number | null; deletions: number | null
  cost_usd: number; notional_usd: number; events: number
}
export interface MergedPrAgg {
  key: string; label: string; sub: string
  prs: number; attributed: number; cost: number; notional: number
  costPerPr: number | null; additions: number; deletions: number
}
export interface MergedPrData {
  days: number
  connected: boolean
  lastSyncedAt: string | null
  lastError: string | null
  totals: { prs: number; attributed: number; cost: number; notional: number; costPerPr: number | null }
  byRepo: MergedPrAgg[]
  byAuthor: MergedPrAgg[]
  recent: MergedPrCostRow[]
}

const n = (v: unknown) => Number(v ?? 0) || 0

export function summarizeMergedPrs(
  rows: MergedPrCostRow[],
  people: Map<string, { name: string; email: string }> = new Map(),
): Pick<MergedPrData, 'totals' | 'byRepo' | 'byAuthor' | 'recent'> {
  const agg = (m: Map<string, MergedPrAgg>, key: string, label: string, sub: string, r: MergedPrCostRow) => {
    const a = m.get(key) ?? { key, label, sub, prs: 0, attributed: 0, cost: 0, notional: 0, costPerPr: null, additions: 0, deletions: 0 }
    a.prs++
    if (r.user_key) { a.attributed++; a.cost += n(r.cost_usd); a.notional += n(r.notional_usd) }
    a.additions += n(r.additions); a.deletions += n(r.deletions)
    m.set(key, a)
  }
  const repos = new Map<string, MergedPrAgg>()
  const authors = new Map<string, MergedPrAgg>()
  let cost = 0, notional = 0, attributed = 0
  for (const r of rows) {
    agg(repos, r.repo, r.repo, '', r)
    const p = r.user_key ? people.get(r.user_key) : undefined
    const aKey = r.user_key ?? `login:${r.author_login.toLowerCase()}`
    agg(authors, aKey, p?.name ?? r.author_login ?? 'unknown', r.user_key ? (p?.email ?? r.user_key) : `@${r.author_login} · not mapped`, r)
    if (r.user_key) { attributed++; cost += n(r.cost_usd); notional += n(r.notional_usd) }
  }
  const finish = (m: Map<string, MergedPrAgg>) => Array.from(m.values())
    .map(a => ({ ...a, costPerPr: a.attributed ? a.cost / a.attributed : null }))
    .sort((x, y) => y.cost - x.cost || y.prs - x.prs)
  return {
    totals: { prs: rows.length, attributed, cost, notional, costPerPr: attributed ? cost / attributed : null },
    byRepo: finish(repos),
    byAuthor: finish(authors),
    recent: [...rows].sort((a, b) => b.merged_at.localeCompare(a.merged_at)).slice(0, 50),
  }
}

/** Load cost-per-merged-PR data for an org (service-role client). */
export async function loadMergedPrData(
  admin: SupabaseClient, orgId: string, days: number,
  people: Map<string, { name: string; email: string }> = new Map(),
): Promise<MergedPrData> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const [{ data: conn }, rows] = await Promise.all([
    admin.from('provider_connections').select('last_synced_at, last_error').eq('org_id', orgId).eq('provider', 'github').maybeSingle(),
    fetchAllRows<MergedPrCostRow>((from, to) => admin.rpc('merged_pr_costs', { p_org: orgId, p_since: since })
      .order('merged_at', { ascending: false }).order('repo').order('number').range(from, to))
      .catch(e => { console.error('[merged-prs] load failed:', (e as Error)?.message ?? e); return [] as MergedPrCostRow[] }),
  ])
  return {
    days,
    connected: !!conn,
    lastSyncedAt: (conn?.last_synced_at as string | null) ?? null,
    lastError: (conn?.last_error as string | null) ?? null,
    ...summarizeMergedPrs(rows, people),
  }
}
