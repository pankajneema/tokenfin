import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, requirePermission, assertOrgOwnsIds, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'
import { audit } from '@/lib/audit'
import { normModel } from '@/lib/alerts/model-limits'

function db() { return createAdminClient() }

/*
 * Limits (migration 024 adds per-model limits):
 *   scope        org | project | team | member (+ project_id / team_id / user_id)
 *   model        optional id or prefix ("claude-opus"), null = every model
 *   metric       cost_usd | tokens | requests;  amount = the limit in metric units
 *   basis        all | metered | notional
 *   notify_at    % for the once-per-period notification (null = off), channels {inapp,email}
 *   auto_action  none | switch_model (→ switch_to) | block_sdk, at auto_action_at %
 * Storage: `value` = amount. `budget_usd` = amount only for model-less dollar
 * limits (the legacy ingest spend gate reads it); 0 for everything else.
 */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,119}$/
const modelStr = z.string().trim().regex(MODEL_RE, 'model id or prefix (letters, digits, . _ - : / @)')
const channels = z.object({ inapp: z.boolean().default(true), email: z.boolean().default(true) })
const pct = z.number().int().min(1).max(1000)

function storage(d: { model?: string | null; metric: string; amount: number }) {
  const legacy = !d.model && d.metric === 'cost_usd'
  return { value: d.amount, budget_usd: legacy ? d.amount : 0 }
}

/** switch_model / block_sdk need a model; switch_to must differ from it. */
function actionError(d: { auto_action?: string; model?: string | null; switch_to?: string | null }): string | null {
  if (!d.auto_action || d.auto_action === 'none') return null
  if (!d.model) return 'Automatic actions need a model (the model to switch away from or block)'
  if (d.auto_action === 'switch_model') {
    if (!d.switch_to) return 'switch_to (the replacement model) is required for switch_model'
    if (normModel(d.switch_to) === normModel(d.model)) return 'switch_to must differ from the limited model'
    if (normModel(d.switch_to).startsWith(normModel(d.model))) return 'switch_to must not match the limited model prefix (it would be switched again)'
  }
  return null
}

/* GET /api/v1/limits?org_id=xxx — org limits are readable by every role. */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const { data, error } = await db()
    .from('limits')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET limits')
  return NextResponse.json(data)
}

/* POST /api/v1/limits */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:          z.string().uuid(),
    project_id:      z.string().uuid().optional().nullable(),
    team_id:         z.string().uuid().optional().nullable(),
    user_id:         z.string().uuid().optional().nullable(),
    scope:           z.enum(['org', 'project', 'team', 'member']),
    period:          z.enum(['daily', 'weekly', 'monthly']),
    model:           modelStr.optional().nullable(),
    metric:          z.enum(['cost_usd', 'tokens', 'requests']).default('cost_usd'),
    basis:           z.enum(['all', 'metered', 'notional']).default('all'),
    amount:          z.number().positive().optional(),
    budget_usd:      z.number().positive().optional(),   // legacy name for a dollar amount
    warn_at:         z.number().int().min(1).max(100).default(70),
    throttle_at:     z.number().int().min(1).max(100).default(90),
    block_at:        z.number().int().min(1).max(100).default(100),
    notify_at:       pct.nullable().default(90),
    notify_channels: channels.default({ inapp: true, email: true }),
    auto_action:     z.enum(['none', 'switch_model', 'block_sdk']).default('none'),
    switch_to:       modelStr.optional().nullable(),
    auto_action_at:  pct.default(100),
  })
    .refine(d => d.warn_at <= d.throttle_at && d.throttle_at <= d.block_at, {
      message: 'Thresholds must satisfy warn_at ≤ throttle_at ≤ block_at', path: ['throttle_at'],
    })
    .refine(d => d.scope !== 'project' || !!d.project_id, { message: 'project_id is required when scope is "project"', path: ['project_id'] })
    .refine(d => d.scope !== 'team' || !!d.team_id, { message: 'team_id is required when scope is "team"', path: ['team_id'] })
    .refine(d => d.scope !== 'member' || !!d.user_id, { message: 'user_id is required when scope is "member"', path: ['user_id'] })
    .refine(d => (d.amount ?? (d.metric === 'cost_usd' ? d.budget_usd : undefined)) != null, { message: 'amount is required', path: ['amount'] })
    .refine(d => !actionError(d), d => ({ message: actionError(d) ?? '', path: ['auto_action'] }))
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const d = parsed.data

  const guard = await requirePermission(d.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard
  // Only the id the scope uses is kept, and it must belong to this org.
  const ids = {
    project_id: d.scope === 'project' ? d.project_id ?? null : null,
    team_id:    d.scope === 'team'    ? d.team_id ?? null    : null,
    user_id:    d.scope === 'member'  ? d.user_id ?? null    : null,
  }
  const foreign = await assertOrgOwnsIds(d.org_id, ids)
  if (foreign) return foreign

  const amount = d.amount ?? d.budget_usd!
  const model = d.model || null
  const row = {
    org_id: d.org_id, scope: d.scope, period: d.period, ...ids, model, metric: d.metric, basis: d.basis,
    ...storage({ model, metric: d.metric, amount }),
    warn_at: d.warn_at, throttle_at: d.throttle_at, block_at: d.block_at,
    notify_at: d.notify_at, notify_channels: d.notify_channels,
    auto_action: d.auto_action, switch_to: d.auto_action === 'switch_model' ? d.switch_to ?? null : null,
    auto_action_at: d.auto_action_at, created_by: guard.userId,
  }
  const { data, error } = await db().from('limits').insert(row).select().single()
  if (error) return dbError(error, 'POST limits')
  await audit({ orgId: d.org_id, actorUserId: guard.userId, action: 'limit.create', targetType: 'limit', targetId: data.id,
    details: { scope: data.scope, period: data.period, model, metric: d.metric, amount, basis: d.basis, auto_action: d.auto_action, switch_to: row.switch_to } })
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/limits */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    id:              z.string().uuid(),
    is_active:       z.boolean().optional(),
    amount:          z.number().positive().optional(),
    budget_usd:      z.number().positive().optional(),
    period:          z.enum(['daily', 'weekly', 'monthly']).optional(),
    model:           modelStr.nullable().optional(),
    metric:          z.enum(['cost_usd', 'tokens', 'requests']).optional(),
    basis:           z.enum(['all', 'metered', 'notional']).optional(),
    warn_at:         z.number().int().min(1).max(100).optional(),
    throttle_at:     z.number().int().min(1).max(100).optional(),
    block_at:        z.number().int().min(1).max(100).optional(),
    notify_at:       pct.nullable().optional(),
    notify_channels: channels.optional(),
    auto_action:     z.enum(['none', 'switch_model', 'block_sdk']).optional(),
    switch_to:       modelStr.nullable().optional(),
    auto_action_at:  pct.optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: cur } = await db().from('limits').select('*').eq('id', parsed.data.id).maybeSingle()
  if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(cur.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  const p = parsed.data
  // Validate the merged thresholds (warn ≤ throttle ≤ block) using existing
  // values for any field not being changed in this request.
  const warn     = p.warn_at     ?? cur.warn_at     ?? 70
  const throttle = p.throttle_at ?? cur.throttle_at ?? 90
  const block    = p.block_at    ?? cur.block_at    ?? 100
  if (!(warn <= throttle && throttle <= block)) {
    return NextResponse.json({ error: 'Thresholds must satisfy warn_at ≤ throttle_at ≤ block_at' }, { status: 422 })
  }
  const merged = {
    model:       p.model !== undefined ? (p.model || null) : (cur.model ?? null),
    metric:      p.metric ?? cur.metric ?? 'cost_usd',
    auto_action: p.auto_action ?? cur.auto_action ?? 'none',
    switch_to:   p.switch_to !== undefined ? p.switch_to : (cur.switch_to ?? null),
  }
  const err = actionError(merged)
  if (err) return NextResponse.json({ error: err }, { status: 422 })

  const { id, amount: a, budget_usd: b, ...fields } = p
  const update: Record<string, unknown> = { ...fields }
  if (merged.auto_action !== 'switch_model') update.switch_to = null
  const amountChanged = a != null || b != null || p.model !== undefined || p.metric !== undefined
  if (amountChanged) {
    const amount = a ?? b ?? Number(cur.value ?? cur.budget_usd)
    Object.assign(update, storage({ model: merged.model, metric: merged.metric, amount }))
  }
  const { data, error } = await db().from('limits').update(update).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH limits')
  await audit({ orgId: cur.org_id, actorUserId: guard.userId, action: 'limit.update', targetType: 'limit', targetId: id, details: update })
  return NextResponse.json(data)
}

/* DELETE /api/v1/limits?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: limRow } = await db().from('limits').select('org_id').eq('id', id).maybeSingle()
  if (!limRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(limRow.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('limits').delete().eq('id', id!)
  if (!error) await audit({ orgId: limRow.org_id, actorUserId: guard.userId, action: 'limit.delete', targetType: 'limit', targetId: id })
  if (error) return dbError(error, 'DELETE limits')
  return NextResponse.json({ ok: true })
}
