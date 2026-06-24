import { NextResponse }                                    from 'next/server'
import type { NextRequest }                                from 'next/server'
import { createAdminClient }                               from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z }                                               from 'zod'

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
    trigger_type:   z.enum(['threshold', 'anomaly', 'limit_breach', 'member']),
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
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('alert_rules').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST alerts')
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

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('alert_rules').update(fields).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH alerts')
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

  const { error } = await db().from('alert_rules').delete().eq('id', id!)
  if (error) return dbError(error, 'DELETE alerts')
  return NextResponse.json({ ok: true })
}
