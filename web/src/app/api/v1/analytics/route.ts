import { NextResponse }                    from 'next/server'
import type { NextRequest }                from 'next/server'
import { createAdminClient }               from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { getOrgTimezone }                  from '@/lib/org-timezone'
import { selectAll }                       from '@/lib/supabase/paginate'
import { toZonedDate }                     from '@/lib/dates'
import { NO_PROJECT_ID, type DashFilters } from '@/lib/rollups'
import {
  MAX_WINDOW_DAYS, resolveWindow, resolveUserScope, scopedSummary, scopedBreakdown,
  eventScopeOr, zonedDayStartIso,
} from '@/lib/rollup-scope'

/**
 * GET /api/v1/analytics?org_id=xxx&days=30&period=30d&project_id=&model=&source=&user_email=
 *
 * Session (+org_id) or a Bearer read key. Members / viewers — and keys they
 * own — only see their OWN usage (guard.scopeUserId); owners / admins see the
 * whole org. A project-bound key only sees its project. Days are org-local.
 *
 * Aggregates come from the rollups. The legacy actor_id / tool / provider
 * filters have no rollup dimension, so those requests fall back to a keyset
 * read of the raw events.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  // period=30d (MCP style) → days=30
  const periodParam = searchParams.get('period') ?? ''
  const periodDays  = periodParam ? parseInt(periodParam, 10) : undefined
  const requestedDays = periodDays ?? parseInt(searchParams.get('days') ?? '30', 10)
  const days        = Math.min(Math.max(Number.isFinite(requestedDays) ? requestedDays : 30, 1), MAX_WINDOW_DAYS)
  const modelFilter  = searchParams.get('model')
  const actorFilter  = searchParams.get('actor_id')
  const emailFilter  = searchParams.get('user_email')
  const sourceFilter = searchParams.get('source')
  const toolFilter   = searchParams.get('tool') ?? searchParams.get('tool_name')
  const providerFilter = searchParams.get('provider')

  const guard = await requireApiKeyOrOrgMember(req, searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard
  // A project-bound key is pinned to its project.
  const projectId = guard.projectId ?? searchParams.get('project_id')

  const db    = createAdminClient()
  const scope = await resolveUserScope(db, guard.scopeUserId)
  const tz    = await getOrgTimezone(orgId)
  const win   = resolveWindow({ days: String(days) }, tz)
  const meta  = { days: win.days, from: win.from, to: win.to, timezone: tz, scope: scope ? 'self' as const : 'org' as const }

  // A scoped caller asking for someone else's email gets nothing.
  const emailKey = emailFilter?.trim().toLowerCase() || null
  if (scope && emailKey && !scope.keys.includes(emailKey)) {
    return NextResponse.json({ summary: { totalCost: 0, totalTokens: 0, totalRequests: 0, ...meta }, byModel: [], byActor: [], byTool: [], byDay: [] })
  }

  if (actorFilter || toolFilter || providerFilter) {
    return rawAnalytics()
  }

  try {
    const filters: DashFilters = {
      project_id: projectId || null,
      model: modelFilter || null,
      source: sourceFilter || null,
    }
    // user_email → the rollup's user_key (for a scoped caller it was checked
    // above to be their own); otherwise a scoped caller is pinned to their key(s).
    if (emailKey) filters.user_key = emailKey
    const effScope = emailKey ? null : scope
    const [summary, byModel, byMember, bySource, byDay, byProject] = await Promise.all([
      scopedSummary(db, orgId, win.from, win.to, effScope, filters),
      scopedBreakdown(db, orgId, win.from, win.to, 'model', effScope, filters, 200),
      scopedBreakdown(db, orgId, win.from, win.to, 'member', effScope, filters, 200),
      scopedBreakdown(db, orgId, win.from, win.to, 'source', effScope, filters, 50),
      scopedBreakdown(db, orgId, win.from, win.to, 'day', effScope, filters),
      scopedBreakdown(db, orgId, win.from, win.to, 'project', effScope, filters, 1000),
    ])
    const reqOf = (rows: { key: string; requests: number }[], key: string) => rows.find(r => r.key === key)?.requests ?? 0

    return NextResponse.json({
      summary: {
        totalCost:     +summary.cost_usd.toFixed(6),
        meteredCost:   +summary.metered_cost_usd.toFixed(6),
        notionalCost:  +summary.notional_cost_usd.toFixed(6),
        totalTokens:   summary.total_tokens,
        totalRequests: summary.requests,
        prompts:       summary.prompts,
        sessions:      summary.sessions,
        avgLatencyMs:  summary.avg_latency_ms,
        ...meta,
        dataQuality: {
          source: 'rollups',
          missingModel: reqOf(byModel.rows, ''),
          missingProject: reqOf(byProject.rows, NO_PROJECT_ID),
          unattributedRequests: reqOf(byMember.rows, ''),
        },
      },
      byModel: byModel.rows.map(r => ({
        model: r.key, tokens: r.total_tokens, cost: r.cost_usd, requests: r.requests,
        metered_cost: r.metered_cost_usd, notional_cost: r.notional_cost_usd, avg_latency_ms: r.avg_latency_ms,
      })),
      byActor: byMember.rows.map(r => ({
        actor_id: r.key || 'unattributed', actor_name: null,
        user_email: r.key.includes('@') ? r.key : null,
        tokens: r.total_tokens, cost: r.cost_usd, requests: r.requests,
      })),
      byTool: bySource.rows.map(r => ({ tool: r.key || 'unknown', tokens: r.total_tokens, cost: r.cost_usd, requests: r.requests })),
      byDay: byDay.rows.map(r => ({ date: r.key, cost: r.cost_usd, tokens: r.total_tokens, requests: r.requests })),
    })
  } catch (error) {
    return dbError(error, 'GET analytics')
  }

  /* Legacy filters (actor / tool / provider): keyset read of raw events. */
  async function rawAnalytics() {
    type Ev = {
      id: string; created_at: string; model: string | null; total_tokens: number | null; cost_usd: number | null
      source: string | null; tool_name: string | null; actor_id: string | null; actor_name: string | null
      user_email: string | null; prompt_hash: string | null; project_id: string | null
    }
    let events: Ev[]
    try {
      ({ data: events } = await selectAll<Ev>(() => {
        let q = db.from('usage_events')
          .select('id, created_at, model, total_tokens, cost_usd, project_id, source, tool_name, actor_id, actor_name, user_email, prompt_hash')
          .eq('org_id', orgId)
          .gte('created_at', zonedDayStartIso(win.from, tz))
        if (projectId) q = q.eq('project_id', projectId)
        if (modelFilter) q = q.eq('model', modelFilter)
        if (actorFilter) q = q.eq('actor_id', actorFilter)
        if (emailFilter) q = q.ilike('user_email', emailFilter.replace(/[\\%_]/g, c => '\\' + c))
        if (sourceFilter) q = q.eq('source', sourceFilter)
        if (toolFilter) q = q.eq('tool_name', toolFilter)
        if (providerFilter) q = q.eq('provider', providerFilter)
        if (scope) q = q.or(eventScopeOr(scope))
        return q
      }))
    } catch (error) {
      return dbError(error, 'GET analytics (raw)')
    }

    const byModel: Record<string, { tokens: number; cost: number; requests: number }> = {}
    const byDay:   Record<string, { cost: number; tokens: number; requests: number }> = {}
    const byActor: Record<string, { actor_id: string; actor_name: string | null; user_email: string | null; tokens: number; cost: number; requests: number }> = {}
    const byTool:  Record<string, { tool: string; tokens: number; cost: number; requests: number }> = {}
    let totalCost = 0, totalTokens = 0
    for (const e of events) {
      const cost = Number(e.cost_usd ?? 0), tok = Number(e.total_tokens ?? 0)
      totalCost += cost; totalTokens += tok
      const m = e.model ?? 'unknown'
      const bm = (byModel[m] ??= { tokens: 0, cost: 0, requests: 0 })
      bm.tokens += tok; bm.cost += cost; bm.requests++
      const actorKey = e.actor_id ?? e.user_email ?? 'unattributed'
      const ba = (byActor[actorKey] ??= { actor_id: actorKey, actor_name: e.actor_name ?? null, user_email: e.user_email ?? null, tokens: 0, cost: 0, requests: 0 })
      ba.tokens += tok; ba.cost += cost; ba.requests++
      const tool = e.tool_name ?? e.source ?? 'unknown'
      const bt = (byTool[tool] ??= { tool, tokens: 0, cost: 0, requests: 0 })
      bt.tokens += tok; bt.cost += cost; bt.requests++
      const day = toZonedDate(e.created_at, tz)
      const bd = (byDay[day] ??= { cost: 0, tokens: 0, requests: 0 })
      bd.cost += cost; bd.tokens += tok; bd.requests++
    }
    return NextResponse.json({
      summary: {
        totalCost, totalTokens, totalRequests: events.length, ...meta,
        dataQuality: {
          source: 'events',
          rowsRead: events.length,
          missingModel: events.filter(e => !e.model).length,
          missingProject: events.filter(e => !e.project_id).length,
          unattributedRequests: events.filter(e => !e.actor_id && !e.user_email).length,
          promptFingerprintCoverage: events.length > 0
            ? +(events.filter(e => e.prompt_hash).length / events.length * 100).toFixed(1)
            : 0,
        },
      },
      byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cost - a.cost),
      byActor: Object.values(byActor).sort((a, b) => b.cost - a.cost),
      byTool:  Object.values(byTool).sort((a, b) => b.cost - a.cost),
      byDay:   Object.entries(byDay).map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    })
  }
}
