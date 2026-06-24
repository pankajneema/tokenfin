import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/limits?org_id=xxx */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'))
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
  const body = await req.json()
  const schema = z.object({
    org_id:      z.string().uuid(),
    project_id:  z.string().uuid().optional().nullable(),
    team_id:     z.string().uuid().optional().nullable(),
    scope:       z.enum(['org', 'project', 'team', 'member']),
    period:      z.enum(['daily', 'weekly', 'monthly']),
    budget_usd:  z.number().positive(),
    warn_at:     z.number().int().min(1).max(100).default(70),
    throttle_at: z.number().int().min(1).max(100).default(90),
    block_at:    z.number().int().min(1).max(100).default(100),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('limits').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST limits')
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/limits */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:          z.string().uuid(),
    is_active:   z.boolean().optional(),
    budget_usd:  z.number().positive().optional(),
    period:      z.enum(['daily', 'weekly', 'monthly']).optional(),
    warn_at:     z.number().int().min(1).max(100).optional(),
    throttle_at: z.number().int().min(1).max(100).optional(),
    block_at:    z.number().int().min(1).max(100).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: limRow } = await db().from('limits').select('org_id').eq('id', parsed.data.id).maybeSingle()
  if (!limRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(limRow.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('limits').update(fields).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH limits')
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
  if (error) return dbError(error, 'DELETE limits')
  return NextResponse.json({ ok: true })
}
