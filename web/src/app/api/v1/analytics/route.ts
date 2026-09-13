import { NextResponse }                    from 'next/server'
import type { NextRequest }                from 'next/server'
import { createAdminClient }               from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { fetchAllPages } from '@/lib/supabase/paginate'

/* GET /api/v1/analytics?org_id=xxx&days=30&period=30d&project_id=xxx */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  // period=30d (MCP style) → days=30
  const periodParam = searchParams.get('period') ?? ''
  const periodDays  = periodParam ? parseInt(periodParam, 10) : undefined
  const requestedDays = periodDays ?? parseInt(searchParams.get('days') ?? '30', 10)
  const days        = Math.min(Math.max(requestedDays, 1), 3650)
  const projectId   = searchParams.get('project_id')
  const modelFilter  = searchParams.get('model')
  const actorFilter  = searchParams.get('actor_id')
  const emailFilter  = searchParams.get('user_email')
  const sourceFilter = searchParams.get('source')
  const toolFilter   = searchParams.get('tool') ?? searchParams.get('tool_name')
  const providerFilter = searchParams.get('provider')

  const guard = await requireApiKeyOrOrgMember(req, searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const db    = createAdminClient()
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  let query = db.from('usage_events')
    .select('model, total_tokens, cost_usd, input_tokens, output_tokens, created_at, project_id, source, tool_name, provider, actor_id, actor_name, user_email, session_id, prompt_hash')
    .eq('org_id', orgId)
    .gte('created_at', since)

  if (projectId) query = query.eq('project_id', projectId)
  if (modelFilter) query = query.eq('model', modelFilter)
  if (actorFilter) query = query.eq('actor_id', actorFilter)
  if (emailFilter) query = query.eq('user_email', emailFilter)
  if (sourceFilter) query = query.eq('source', sourceFilter)
  if (toolFilter) query = query.eq('tool_name', toolFilter)
  if (providerFilter) query = query.eq('provider', providerFilter)

  const { data: events, error } = await fetchAllPages<any>((from, to) => query.range(from, to))
  if (error) return dbError(error, 'GET analytics')

  const byModel: Record<string, { tokens: number; cost: number; requests: number }> = {}
  const byDay:   Record<string, { cost: number; tokens: number }>                   = {}
  const byActor: Record<string, { actor_id: string; actor_name: string | null; user_email: string | null; tokens: number; cost: number; requests: number }> = {}
  const byTool: Record<string, { tool: string; tokens: number; cost: number; requests: number }> = {}

  for (const e of events ?? []) {
    if (!byModel[e.model]) byModel[e.model] = { tokens: 0, cost: 0, requests: 0 }
    byModel[e.model].tokens   += e.total_tokens
    byModel[e.model].cost     += e.cost_usd
    byModel[e.model].requests += 1

    const actorKey = e.actor_id ?? e.user_email ?? 'unattributed'
    if (!byActor[actorKey]) byActor[actorKey] = { actor_id: actorKey, actor_name: e.actor_name ?? null, user_email: e.user_email ?? null, tokens: 0, cost: 0, requests: 0 }
    byActor[actorKey].tokens += Number(e.total_tokens ?? 0)
    byActor[actorKey].cost += Number(e.cost_usd ?? 0)
    byActor[actorKey].requests += 1

    const tool = e.tool_name ?? e.source ?? 'unknown'
    if (!byTool[tool]) byTool[tool] = { tool, tokens: 0, cost: 0, requests: 0 }
    byTool[tool].tokens += Number(e.total_tokens ?? 0)
    byTool[tool].cost += Number(e.cost_usd ?? 0)
    byTool[tool].requests += 1

    const day = (e.created_at as string).slice(0, 10)
    if (!byDay[day]) byDay[day] = { cost: 0, tokens: 0 }
    byDay[day].cost   += e.cost_usd
    byDay[day].tokens += e.total_tokens
  }

  return NextResponse.json({
    summary: {
      totalCost:     events?.reduce((s, e) => s + e.cost_usd, 0)    ?? 0,
      totalTokens:   events?.reduce((s, e) => s + e.total_tokens, 0) ?? 0,
      totalRequests: events?.length ?? 0,
      days,
      dataQuality: {
        rowsRead: events?.length ?? 0,
        missingModel: (events ?? []).filter(e => !e.model).length,
        missingProject: (events ?? []).filter(e => !e.project_id).length,
        unattributedRequests: (events ?? []).filter(e => !e.actor_id && !e.user_email).length,
        promptFingerprintCoverage: (events?.length ?? 0) > 0
          ? +((events ?? []).filter(e => e.prompt_hash).length / (events?.length ?? 1) * 100).toFixed(1)
          : 0,
      },
    },
    byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    byActor: Object.values(byActor).sort((a, b) => b.cost - a.cost),
    byTool: Object.values(byTool).sort((a, b) => b.cost - a.cost),
    byDay: Object.entries(byDay).map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })
}
