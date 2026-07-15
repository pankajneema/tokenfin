import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { toISTDate, daysAgoIST, tsNDaysAgo } from '@/lib/dates'
import { AnalyticsClient }    from './_client'
import type { AnalyticsData, DayData, ModelSlice, ProjectSlice, PlatformSlice, SourceSlice } from './_types'

/* ── Platform detection from usage_events.tags ─────────────────
 * Tags set by proxy: { source: 'proxy', tool: 'codex' }
 * Tags set by MCP:   { source: 'mcp' }
 * Tags set by SDK:   { source: 'sdk' }
 * No tags / unknown → "Direct API"
 * ─────────────────────────────────────────────────────────────── */
const PLATFORM_COLORS: Record<string, string> = {
  'Codex':           '#00C48C',
  'Claude CLI':      '#E8533A',
  'Claude Web':      '#8B5CF6',
  'GitHub Copilot':  '#24292F',
  'Cursor':          '#0D8A6A',
  'MCP':             '#4285F4',
  'SDK':             '#F59E0B',
  'Direct API':      '#6B7280',
  'Proxy':           '#94A3B8',
}

function detectPlatform(tags: Record<string, string> | null): string {
  if (!tags) return 'Direct API'
  const source = tags.source ?? ''
  const tool   = tags.tool   ?? ''
  if (source === 'proxy') {
    if (tool === 'codex')       return 'Codex'
    if (tool === 'cursor')      return 'Cursor'
    if (tool === 'copilot')     return 'GitHub Copilot'
    if (tool === 'claude-cli')  return 'Claude CLI'
    if (tool === 'claude-web')  return 'Claude Web'
    return 'Proxy'
  }
  if (source === 'mcp')         return 'MCP'
  if (source === 'sdk')         return 'SDK'
  if (tool === 'claude-web')    return 'Claude Web'
  if (tool === 'claude-cli')    return 'Claude CLI'
  return 'Direct API'
}

export const metadata = { title: 'Analytics — TokenFin' }

// Always render fresh — usage data changes on every ingested event.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const MODEL_COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#6B7280']

function fmtDay(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function AnalyticsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30     = tsNDaysAgo(30)    // UTC ts for usage_events.created_at
  const since60     = tsNDaysAgo(60)
  const since30date = daysAgoIST(30)   // IST date for usage_agg.bucket
  const since60date = daysAgoIST(60)

  /**
   * Strategy: split the two concerns cleanly.
   *
   * COST + TOKENS  → usage_agg  (pre-aggregated, fast, written by Go worker)
   *                  Falls back to usage_events when usage_agg is empty.
   *
   * REQUEST COUNTS → usage_events always (one row = one request, always accurate,
   *                  never depends on the Go worker being online).
   *
   * This way concurrent hits to the ingest API are always counted correctly even
   * if the aggregation worker is lagging or not running.
   */
  const [
    { data: agg     },   // current 30d from usage_agg
    { data: aggPrev },   // prior 30d from usage_agg
    { data: evts    },   // current 30d from usage_events (source of truth for counts)
    { data: evtsPrev},   // prior 30d from usage_events
    { data: projects},
    { data: apiKeys },
    { data: orgLimit },
  ] = await Promise.all([
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd')
      .eq('org_id', orgId).gte('bucket', since30date),
    admin.from('usage_agg')
      .select('bucket,model,project_id,total_tokens,cost_usd')
      .eq('org_id', orgId).gte('bucket', since60date).lt('bucket', since30date),
    admin.from('usage_events')
      .select('project_id,model,created_at,cost_usd,total_tokens,input_tokens,output_tokens,tags')
      .eq('org_id', orgId).gte('created_at', since30),
    admin.from('usage_events')
      .select('project_id,model,created_at,cost_usd,total_tokens,input_tokens,output_tokens,tags')
      .eq('org_id', orgId).gte('created_at', since60).lt('created_at', since30),
    admin.from('projects').select('id,name').eq('org_id', orgId),
    admin.from('api_keys').select('id,name,project_id').eq('org_id', orgId).eq('is_active', true),
    // Org-level cost limit (scope='org', metric='cost', no project_id)
    admin.from('limits')
      .select('value,budget_usd')
      .eq('org_id', orgId)
      .eq('metric', 'cost')
      .is('project_id', null)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  /* ── Use usage_agg for cost/tokens, usage_events for counts ── */
  const aggHasCost = (agg ?? []).some(r => Number(r.cost_usd ?? 0) > 0)

  /* ── Build per-day cost+tokens from usage_agg (or usage_events fallback) ── */
  const costMap     = new Map<string, { cost: number; tokens: number }>()
  const costMapPrev = new Map<string, { cost: number; tokens: number }>()

  if (aggHasCost) {
    for (const r of agg ?? []) {
      const key = toISTDate(r.bucket)   // bucket is IST date string; toISTDate normalises it
      const e   = costMap.get(key) ?? { cost: 0, tokens: 0 }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      costMap.set(key, e)
    }
    for (const r of aggPrev ?? []) {
      const shifted = toISTDate(new Date(r.bucket).getTime() + 30 * 86400_000)
      const e = costMapPrev.get(shifted) ?? { cost: 0, tokens: 0 }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      costMapPrev.set(shifted, e)
    }
  } else {
    // fallback — aggregate cost+tokens from raw events (bucket by IST date)
    for (const r of evts ?? []) {
      const key = toISTDate(r.created_at)
      const e   = costMap.get(key) ?? { cost: 0, tokens: 0 }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      costMap.set(key, e)
    }
    for (const r of evtsPrev ?? []) {
      const shifted = toISTDate(new Date(r.created_at).getTime() + 30 * 86400_000)
      const e = costMapPrev.get(shifted) ?? { cost: 0, tokens: 0 }
      e.cost   += Number(r.cost_usd     ?? 0)
      e.tokens += Number(r.total_tokens ?? 0)
      costMapPrev.set(shifted, e)
    }
  }

  /* ── Build per-day request counts from usage_events (always authoritative) ── */
  const callMap     = new Map<string, number>()
  const callMapPrev = new Map<string, number>()
  for (const r of evts ?? []) {
    const key = toISTDate(r.created_at)
    callMap.set(key, (callMap.get(key) ?? 0) + 1)
  }
  for (const r of evtsPrev ?? []) {
    const shifted = toISTDate(new Date(r.created_at).getTime() + 30 * 86400_000)
    callMapPrev.set(shifted, (callMapPrev.get(shifted) ?? 0) + 1)
  }

  /* ── Merge into sorted daily array ── */
  const allDays    = new Set([...Array.from(costMap.keys()), ...Array.from(callMap.keys())])
  const sortedDays = Array.from(allDays).sort()
  const avgCost    = sortedDays.length > 0
    ? sortedDays.reduce((s, k) => s + (costMap.get(k)?.cost ?? 0), 0) / sortedDays.length
    : 0

  const daily: DayData[] = sortedDays.map(dateStr => {
    const c  = costMap.get(dateStr)     ?? { cost: 0, tokens: 0 }
    const cp = costMapPrev.get(dateStr) ?? { cost: 0, tokens: 0 }
    return {
      d:         fmtDay(dateStr),
      cost:      c.cost,
      prev:      cp.cost,
      tok:       c.tokens / 1_000_000,
      prevTok:   cp.tokens / 1_000_000,
      calls:     callMap.get(dateStr)     ?? 0,
      prevCalls: callMapPrev.get(dateStr) ?? 0,
      spike:     avgCost > 0 && c.cost > avgCost * 2.5,
    }
  })

  /* ── By model — cost/tokens from agg, counts from events ── */
  const modelCost  = new Map<string, { cost: number; tokens: number }>()
  const modelCalls = new Map<string, number>()

  const costSource = aggHasCost ? (agg ?? []) : (evts ?? [])
  for (const r of costSource) {
    const m = r.model ?? 'unknown'
    const e = modelCost.get(m) ?? { cost: 0, tokens: 0 }
    e.cost   += Number(r.cost_usd     ?? 0)
    e.tokens += Number(r.total_tokens ?? 0)
    modelCost.set(m, e)
  }
  for (const r of evts ?? []) {
    const m = r.model ?? 'unknown'
    modelCalls.set(m, (modelCalls.get(m) ?? 0) + 1)
  }

  const totalCost  = Array.from(modelCost.values()).reduce((s, v) => s + v.cost, 0)
  const byModel: ModelSlice[] = Array.from(modelCost.entries())
    .sort(([, a], [, b]) => b.cost - a.cost)
    .slice(0, 6)
    .map(([name, v], i) => ({
      name,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
      cost:  v.cost,
      pct:   totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
    }))

  /* ── By project — cost from agg, counts from events ── */
  const projNames  = new Map((projects ?? []).map(p => [p.id, p.name]))
  const projCost   = new Map<string, number>()
  const projCalls  = new Map<string, number>()

  for (const r of costSource) {
    const pid = r.project_id ?? '__none__'
    projCost.set(pid, (projCost.get(pid) ?? 0) + Number(r.cost_usd ?? 0))
  }
  for (const r of evts ?? []) {
    const pid = r.project_id ?? '__none__'
    projCalls.set(pid, (projCalls.get(pid) ?? 0) + 1)
  }

  const allProjIds = new Set([...Array.from(projCost.keys()), ...Array.from(projCalls.keys())])
  const byProject: ProjectSlice[] = Array.from(allProjIds)
    .map(pid => ({
      name:  projNames.get(pid) ?? (pid === '__none__' ? 'Uncategorized' : pid.slice(0, 8)),
      cost:  projCost.get(pid)  ?? 0,
      pct:   totalCost > 0 ? +((projCost.get(pid) ?? 0) / totalCost * 100).toFixed(1) : 0,
      calls: projCalls.get(pid) ?? 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)

  /* ── By platform (api key → project cost) ── */
  const platformColors = ['#D97757','#4285F4','#8B5CF6','#20B2AA','#F59E0B','#6B7280']
  const platformMap    = new Map<string, { cost: number; color: string }>()
  for (const key of apiKeys ?? []) {
    const name = key.name ?? projNames.get(key.project_id) ?? key.id.slice(0, 8)
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
    .map(([name, v]) => ({
      name,
      cost:  v.cost,
      pct:   totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
      color: v.color,
    }))

  /* ── Input / Output token totals ── */
  let totalInputTokens  = 0
  let totalOutputTokens = 0
  for (const r of evts ?? []) {
    const total  = Number(r.total_tokens ?? 0)
    const inTok  = Number((r as Record<string,unknown>).input_tokens  ?? Math.round(total * 0.7))
    const outTok = Number((r as Record<string,unknown>).output_tokens ?? (total - Math.round(total * 0.7)))
    totalInputTokens  += inTok
    totalOutputTokens += outTok
  }

  /* ── By Source (real platform detection from tags) ── */
  const sourceMap = new Map<string, { calls: number; tokens: number; cost: number }>()
  for (const r of evts ?? []) {
    const tags     = (r as Record<string,unknown>).tags as Record<string,string> | null
    const platform = detectPlatform(tags)
    const entry    = sourceMap.get(platform) ?? { calls: 0, tokens: 0, cost: 0 }
    entry.calls  += 1
    entry.tokens += Number(r.total_tokens ?? 0)
    entry.cost   += Number(r.cost_usd     ?? 0)
    sourceMap.set(platform, entry)
  }
  const bySource: SourceSlice[] = Array.from(sourceMap.entries())
    .sort(([, a], [, b]) => b.calls - a.calls)
    .map(([platform, v]) => ({
      platform,
      calls:   v.calls,
      tokens:  v.tokens,
      cost:    v.cost,
      pct:     totalCost > 0 ? +(v.cost / totalCost * 100).toFixed(1) : 0,
      color:   PLATFORM_COLORS[platform] ?? '#6B7280',
    }))

  const totalPrev = Array.from(costMapPrev.values()).reduce((s, v) => s + v.cost, 0)

  // Org-level budget from limits table (real value, not hardcoded)
  const limitRow  = orgLimit as Record<string,unknown> | null
  const orgBudget = limitRow
    ? Number(limitRow.budget_usd ?? limitRow.value ?? 0) || null
    : null

  // Real 30d token total (same source as cost)
  const tokensUsed = Array.from(costMap.values()).reduce((s, v) => s + v.tokens, 0)

  const analyticsData: AnalyticsData = {
    daily, byModel, byProject, byPlatform, bySource,
    totalCost, totalPrev, orgBudget, tokensUsed,
    inputTokens:  totalInputTokens,
    outputTokens: totalOutputTokens,
  }

  return <AnalyticsClient initialData={analyticsData} />
}
