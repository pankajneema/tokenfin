import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/analytics?org_id=xxx&days=30&project_id=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const orgId     = searchParams.get('org_id')
  const days      = parseInt(searchParams.get('days') ?? '30', 10)
  const projectId = searchParams.get('project_id')

  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

  const since = new Date(Date.now() - days * 86400_000).toISOString()
  let query = supabase.from('usage_events')
    .select('model, total_tokens, cost_usd, created_at, tags')
    .eq('org_id', orgId)
    .gte('created_at', since)

  if (projectId) query = query.eq('project_id', projectId)

  const { data: events, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by model
  const byModel: Record<string, { tokens: number; cost: number; requests: number }> = {}
  // Aggregate by day
  const byDay: Record<string, { cost: number; tokens: number }> = {}

  for (const e of events ?? []) {
    // model
    if (!byModel[e.model]) byModel[e.model] = { tokens: 0, cost: 0, requests: 0 }
    byModel[e.model].tokens   += e.total_tokens
    byModel[e.model].cost     += e.cost_usd
    byModel[e.model].requests += 1

    // day
    const day = e.created_at.slice(0, 10)
    if (!byDay[day]) byDay[day] = { cost: 0, tokens: 0 }
    byDay[day].cost   += e.cost_usd
    byDay[day].tokens += e.total_tokens
  }

  const totalCost    = events?.reduce((s, e) => s + e.cost_usd, 0) ?? 0
  const totalTokens  = events?.reduce((s, e) => s + e.total_tokens, 0) ?? 0
  const totalReqs    = events?.length ?? 0

  return NextResponse.json({
    summary: { totalCost, totalTokens, totalRequests: totalReqs, days },
    byModel: Object.entries(byModel).map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    byDay: Object.entries(byDay).map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })
}
