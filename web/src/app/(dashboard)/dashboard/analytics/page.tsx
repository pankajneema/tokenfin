import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { dashSummary, dashBreakdown, NO_PROJECT_ID } from '@/lib/rollups'
import { resolveWindow, sourceLabel, fmtDayLabel } from '@/lib/rollup-scope'
import { AnalyticsClient }    from './_client'
import type { AnalyticsData, DayData, ModelSlice, ProjectSlice, PlatformSlice, SourceSlice } from './_types'
import { computeCacheStats } from '@/components/dashboard/cache-efficiency'

const PLATFORM_COLORS: Record<string, string> = {
  'Claude Code':     '#E8533A',
  'Gemini CLI':      '#4285F4',
  'OpenCode':        '#0EA5E9',
  'Codex':           '#00C48C',
  'MCP':             '#4285F4',
  'SDK':             '#F59E0B',
  'Direct API':      '#6B7280',
  'Proxy':           '#94A3B8',
}

export const metadata = { title: 'Analytics — TokenFin' }

// Always render fresh — usage data changes on every ingested event.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const MODEL_COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#6B7280']
const pctOf = (v: number, total: number) => total > 0 ? +(v / total * 100).toFixed(1) : 0

export default async function AnalyticsPage({ searchParams: searchParamsPromise }: { searchParams?: Promise<{ days?: string; from?: string; to?: string }> }) {
  const searchParams = await searchParamsPromise
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(searchParams, ctx.timezone, { defaultDays: 30 })

  // Everything below is read from the rollups (usage_daily / usage_daily_prompts),
  // which include metered AND notional rows, bucketed in the org's time zone.
  const [cur, prev, byModelBd, byProjectBd, bySourceBd, { data: projects }, { data: apiKeys }, { data: orgLimit }] = await Promise.all([
    dashSummary(admin, orgId, win.from, win.to),
    dashSummary(admin, orgId, win.prevFrom, win.prevTo),
    dashBreakdown(admin, orgId, win.from, win.to, 'model', undefined, 50),
    dashBreakdown(admin, orgId, win.from, win.to, 'project', undefined, 50),
    dashBreakdown(admin, orgId, win.from, win.to, 'source', undefined, 20),
    admin.from('projects').select('id,name').eq('org_id', orgId),
    admin.from('api_keys').select('id,name,project_id').eq('org_id', orgId).eq('is_active', true),
    // Org-level cost limit (metric='cost', no project_id)
    admin.from('limits')
      .select('value,budget_usd')
      .eq('org_id', orgId)
      .eq('metric', 'cost')
      .is('project_id', null)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  const totalCost = cur.cost_usd

  /* ── Daily series: prev window aligned index-by-index (same length) ── */
  const avgCost = cur.series.length > 0 ? totalCost / cur.series.length : 0
  const daily: DayData[] = cur.series.map((p, i) => {
    const pp = prev.series[i]
    return {
      d:         fmtDayLabel(p.day),
      cost:      p.cost_usd,
      prev:      pp?.cost_usd ?? 0,
      tok:       p.total_tokens / 1_000_000,
      prevTok:   (pp?.total_tokens ?? 0) / 1_000_000,
      calls:     p.requests,
      prevCalls: pp?.requests ?? 0,
      spike:     avgCost > 0 && p.cost_usd > avgCost * 2.5,
    }
  })

  /* ── By model ── */
  const byModel: ModelSlice[] = byModelBd.rows.slice(0, 6).map((r, i) => ({
    name:  r.key || 'unknown',
    color: MODEL_COLORS[i % MODEL_COLORS.length],
    cost:  r.cost_usd,
    pct:   pctOf(r.cost_usd, totalCost),
  }))

  /* ── By project (top 5, prompts per project from the rollup) ── */
  const projNames = new Map((projects ?? []).map(p => [p.id as string, p.name as string]))
  const topProjects = byProjectBd.rows.slice(0, 5)
  const projPrompts = await Promise.all(topProjects.map(r =>
    dashSummary(admin, orgId, win.from, win.to, { project_id: r.key }).then(s => s.prompts)))
  const byProject: ProjectSlice[] = topProjects.map((r, i) => ({
    name:    r.key === NO_PROJECT_ID ? 'Uncategorized' : projNames.get(r.key) ?? r.key.slice(0, 8),
    cost:    r.cost_usd,
    pct:     pctOf(r.cost_usd, totalCost),
    calls:   r.requests,
    prompts: projPrompts[i],
  }))
  const projCost = new Map(byProjectBd.rows.map(r => [r.key, r.cost_usd]))

  /* ── By platform (api key → its project's cost) ── */
  const platformColors = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']
  const platformMap    = new Map<string, { cost: number; color: string }>()
  for (const key of apiKeys ?? []) {
    const name = key.name ?? projNames.get(key.project_id) ?? String(key.id).slice(0, 8)
    if (!platformMap.has(name)) {
      platformMap.set(name, {
        cost:  projCost.get(key.project_id) ?? 0,
        color: platformColors[platformMap.size % platformColors.length],
      })
    }
  }
  const byPlatform: PlatformSlice[] = Array.from(platformMap.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 5)
    .map(([name, v]) => ({ name, cost: v.cost, pct: pctOf(v.cost, totalCost), color: v.color }))

  /* ── By source (usage_events.source) ── */
  const srcPrompts = await Promise.all(bySourceBd.rows.map(r =>
    dashSummary(admin, orgId, win.from, win.to, { source: r.key }).then(s => s.prompts)))
  const bySource: SourceSlice[] = bySourceBd.rows
    .map((r, i) => {
      const platform = sourceLabel(r.key)
      return {
        platform,
        calls:   r.requests,
        prompts: srcPrompts[i],
        tokens:  r.total_tokens,
        cost:    r.cost_usd,
        pct:     pctOf(r.cost_usd, totalCost),
        color:   PLATFORM_COLORS[platform] ?? '#6B7280',
      }
    })
    .sort((a, b) => b.calls - a.calls)

  const limitRow  = orgLimit as Record<string, unknown> | null
  const orgBudget = limitRow ? Number(limitRow.budget_usd ?? limitRow.value ?? 0) || null : null

  const analyticsData: AnalyticsData = {
    rangeDays:    win.days,
    windowLabel:  win.label,
    customRange:  win.custom,
    prompts:      cur.prompts,
    prevPrompts:  prev.prompts,
    meteredCost:  cur.metered_cost_usd,
    notionalCost: cur.notional_cost_usd,
    daily, byModel, byProject, byPlatform, bySource,
    totalCost,
    totalPrev:    prev.cost_usd,
    orgBudget,
    tokensUsed:   cur.total_tokens,
    inputTokens:  cur.input_tokens,
    outputTokens: cur.output_tokens,
    // Cache efficiency per model over every row in range (metered + notional).
    cache: computeCacheStats(byModelBd.rows.map(r => ({
      model: r.key, input_tokens: r.input_tokens, cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
    }))),
  }

  return <AnalyticsClient initialData={analyticsData} />
}
