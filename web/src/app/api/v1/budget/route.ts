import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireApiKeyOrOrgMember, requireResourcePermission, assertOrgOwnsIds, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'
import { dashSummary }                                from '@/lib/rollups'
import { getOrgTimezone }                             from '@/lib/org-timezone'
import { resolveWindow }                              from '@/lib/rollup-scope'

function db() { return createAdminClient() }

/* GET /api/v1/budget — org budget vs spend over the last 30 days (org-local).
 * Org-level figures, readable by every role ('analytics:view'). spent_usd is
 * METERED spend (a bill); notional (subscription usage priced at API rates) is
 * reported separately and never counted against the budget. */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const win = resolveWindow({ days: '30' }, await getOrgTimezone(orgId))
  let summary
  try {
    summary = await dashSummary(db(), orgId, win.from, win.to)
  } catch (e) {
    return dbError(e, 'GET budget spend')
  }
  const spentUsd = summary.metered_cost_usd

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
    notional_usd: +summary.notional_cost_usd.toFixed(4),
    period:      'last_30d',
    from:        win.from,
    to:          win.to,
  })
}

/* POST /api/v1/budget — any member may REQUEST more budget.
   requested_by is always the session user; any client value is ignored. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:       z.string().uuid(),
    project_id:   z.string().uuid().optional(),
    requested_by: z.string().uuid().optional(),   // IGNORED — always the caller
    amount_usd:   z.number().positive().max(1_000_000),
    reason:       z.string().min(10).max(2000),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const bad = await assertOrgOwnsIds(parsed.data.org_id, { project_id: parsed.data.project_id })
  if (bad) return bad

  const { org_id, project_id, amount_usd, reason } = parsed.data
  const { data, error } = await db().from('budget_requests').insert({
    org_id, project_id: project_id ?? null, amount_usd, reason,
    requested_by: guard.userId,
  }).select().single()
  if (error) return dbError(error, 'POST budget')
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/budget — approve/deny a request. Requires limits:write
   (owner/admin). reviewed_by is always the session user. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    id:          z.string().uuid(),
    status:      z.enum(['approved', 'denied']),
    reviewed_by: z.string().uuid().optional(),    // IGNORED — always the caller
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourcePermission('budget_requests', parsed.data.id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  const { id, status } = parsed.data
  const { error } = await db().from('budget_requests').update({
    status, reviewed_by: guard.userId, reviewed_at: new Date().toISOString(),
  }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return dbError(error, 'PATCH budget')
  return NextResponse.json({ ok: true })
}
