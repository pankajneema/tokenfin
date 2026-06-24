import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/models?org_id=xxx
 * Returns top models by cost (last 30 days) from usage_agg.
 * Accepts both API key auth (MCP) and session auth (dashboard). */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const { data, error } = await db()
    .from('usage_agg')
    .select('model, total_tokens, cost_usd, request_count')
    .eq('org_id', orgId)
    .gte('bucket', since30)
  if (error) return dbError(error, 'GET models')

  // Aggregate by model
  const byModel: Record<string, { tokens: number; cost: number; requests: number }> = {}
  for (const row of data ?? []) {
    if (!byModel[row.model]) byModel[row.model] = { tokens: 0, cost: 0, requests: 0 }
    byModel[row.model].tokens   += row.total_tokens
    byModel[row.model].cost     += row.cost_usd
    byModel[row.model].requests += row.request_count
  }

  return NextResponse.json(
    Object.entries(byModel)
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost)
  )
}

/* POST /api/v1/models */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id: z.string().uuid(),
    model:  z.string().min(1).max(128),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('org_models').insert(parsed.data).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Model already added' }, { status: 409 })
    return dbError(error, 'POST models')
  }
  return NextResponse.json(data, { status: 201 })
}

/* DELETE /api/v1/models?org_id=xxx&model=yyy */
export async function DELETE(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const model = req.nextUrl.searchParams.get('model')
  if (!model) return NextResponse.json({ error: 'model required' }, { status: 400 })

  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('org_models').delete().eq('org_id', orgId!).eq('model', model)
  if (error) return dbError(error, 'DELETE models')
  return NextResponse.json({ ok: true })
}
