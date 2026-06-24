import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireApiKeyOrOrgMember, requireResourceOwner, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  // Get current month spend from usage_agg
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const { data: agg, error: aggErr } = await db()
    .from('usage_agg')
    .select('cost_usd')
    .eq('org_id', orgId)
    .gte('bucket', since)
  if (aggErr) return dbError(aggErr, 'GET budget spend')

  const spentUsd = (agg ?? []).reduce((s, r) => s + r.cost_usd, 0)

  // Get the active org-level monthly limit (budget)
  const { data: limits } = await db()
    .from('limits')
    .select('budget_usd')
    .eq('org_id', orgId)
    .eq('scope', 'org')
    .eq('period', 'monthly')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  const budgetUsd = limits?.[0]?.budget_usd ?? null

  return NextResponse.json({
    budget_usd:  budgetUsd,
    spent_usd:   +spentUsd.toFixed(4),
    remaining:   budgetUsd != null ? +(budgetUsd - spentUsd).toFixed(4) : null,
    pct_used:    budgetUsd ? +(spentUsd / budgetUsd * 100).toFixed(1) : null,
    period:      'last_30d',
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:       z.string().uuid(),
    project_id:   z.string().uuid().optional(),
    requested_by: z.string().uuid(),
    amount_usd:   z.number().positive(),
    reason:       z.string().min(10),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('budget_requests').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST budget')
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:          z.string().uuid(),
    status:      z.enum(['approved', 'denied']),
    reviewed_by: z.string().uuid(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourceOwner('budget_requests', parsed.data.id)
  if (guard instanceof NextResponse) return guard

  const { id, status, reviewed_by } = parsed.data
  const { error } = await db().from('budget_requests').update({
    status, reviewed_by, reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return dbError(error, 'PATCH budget')
  return NextResponse.json({ ok: true })
}
