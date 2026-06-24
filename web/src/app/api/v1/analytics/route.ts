import { NextResponse }                    from 'next/server'
import type { NextRequest }                from 'next/server'
import { createAdminClient }               from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'

/* GET /api/v1/analytics?org_id=xxx&days=30&period=30d&project_id=xxx */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  // period=30d (MCP style) → days=30
  const periodParam = searchParams.get('period') ?? ''
  const periodDays  = periodParam ? parseInt(periodParam, 10) : undefined
  const days        = Math.min(periodDays ?? parseInt(searchParams.get('days') ?? '30', 10), 365)
  const projectId   = searchParams.get('project_id')

  const guard = await requireApiKeyOrOrgMember(req, searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const db    = createAdminClient()
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  let query = db.from('usage_events')
    .select('model, total_tokens, cost_usd, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since)

  if (projectId) query = query.eq('project_id', projectId)

  const { data: events, error } = await query
  if (error) return dbError(error, 'GET analytics')

  const byModel: Record<string, { tokens: number; cost: number; requests: number }> = {}
  const byDay:   Record<string, { cost: number; tokens: number }>                   = {}

  for (const e of events ?? []) {
    if (!byModel[e.model]) byModel[e.model] = { tokens: 0, cost: 0, requests: 0 }
    byModel[e.model].tokens   += e.total_tokens
    byModel[e.model].cost     += e.cost_usd
    byModel[e.model].requests += 1

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
    },
    byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    byDay: Object.entries(byDay).map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })
}
