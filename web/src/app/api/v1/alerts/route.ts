import { NextResponse }                                    from 'next/server'
import type { NextRequest }                                from 'next/server'
import { createAdminClient }                               from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, assertOrgOwnsIds, dbError } from '@/lib/api/auth'
import { audit } from '@/lib/audit'
import { z }                                               from 'zod'

const anomalyScope = z.enum(['org', 'project', 'member', 'model'])   // = lib/alerts/anomaly ANOMALY_SCOPES

function db() { return createAdminClient() }

/* GET /api/v1/alerts?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('alert_rules')
    .select('*')
    .eq('org_id', orgId!)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET alerts')
  return NextResponse.json(data)
}

/* POST /api/v1/alerts */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:         z.string().uuid(),
    project_id:     z.string().uuid().optional().nullable(),
    name:           z.string().min(1).max(128),
    trigger_type:   z.enum(['threshold', 'anomaly', 'limit_breach', 'member', 'forecast']),
    // anomaly only: baseline per org | project | member | model (default org).
    anomaly_scope:  anomalyScope.default('org'),
    condition:      z.string().default(''),
    scope:          z.string().default('All projects'),
    threshold:      z.number().optional().nullable(),
    cooldown_hours: z.number().int().min(1).default(4),
    channels: z.object({
      email:   z.boolean().default(true),
      slack:   z.boolean().default(false),
      webhook: z.boolean().default(false),
      inapp:   z.boolean().default(true),
    }).default({ email: true, slack: false, webhook: false, inapp: true }),
  })
    .refine(d => (d.trigger_type !== 'threshold' && d.trigger_type !== 'member') || typeof d.threshold === 'number', {
      message: 'threshold (a number) is required for threshold and member alerts', path: ['threshold'],
    })
    .refine(d => d.channels.email || d.channels.slack || d.channels.webhook || d.channels.inapp, {
      message: 'at least one channel must be enabled', path: ['channels'],
    })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const foreign = await assertOrgOwnsIds(parsed.data.org_id, { project_id: parsed.data.project_id })
  if (foreign) return foreign

  const { data, error } = await db().from('alert_rules').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST alerts')
  await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'alert.create', targetType: 'alert_rule', targetId: data?.id ?? null, details: { name: data?.name, trigger_type: data?.trigger_type } })
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/alerts */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:             z.string().uuid(),
    is_active:      z.boolean().optional(),
    name:           z.string().min(1).optional(),
    condition:      z.string().optional(),
    scope:          z.string().optional(),
    threshold:      z.number().nullable().optional(),
    cooldown_hours: z.number().int().min(1).optional(),
    anomaly_scope:  anomalyScope.optional(),
    project_id:     z.string().uuid().nullable().optional(),   // null = all projects
    channels: z.object({
      email: z.boolean(), slack: z.boolean(), webhook: z.boolean(), inapp: z.boolean(),
    }).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: ruleRow } = await db().from('alert_rules').select('org_id').eq('id', parsed.data.id).maybeSingle()
  if (!ruleRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(ruleRow.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const foreign = await assertOrgOwnsIds(ruleRow.org_id, { project_id: parsed.data.project_id })
  if (foreign) return foreign

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('alert_rules').update(fields).eq('id', id).eq('org_id', ruleRow.org_id).select().single()
  if (error) return dbError(error, 'PATCH alerts')
  await audit({ orgId: ruleRow.org_id, actorUserId: guard.userId, action: 'alert.update', targetType: 'alert_rule', targetId: id, details: { fields: Object.keys(fields), ...(fields.is_active !== undefined ? { is_active: fields.is_active } : {}) } })
  return NextResponse.json(data)
}

/* DELETE /api/v1/alerts?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: ruleRow } = await db().from('alert_rules').select('org_id').eq('id', id).maybeSingle()
  if (!ruleRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(ruleRow.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('alert_rules').delete().eq('id', id!).eq('org_id', ruleRow.org_id)
  if (error) return dbError(error, 'DELETE alerts')
  await audit({ orgId: ruleRow.org_id, actorUserId: guard.userId, action: 'alert.delete', targetType: 'alert_rule', targetId: id })
  return NextResponse.json({ ok: true })
}
