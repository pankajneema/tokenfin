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
    .refine(d => d.warn_at <= d.throttle_at && d.throttle_at <= d.block_at, {
      message: 'Thresholds must satisfy warn_at ≤ throttle_at ≤ block_at', path: ['throttle_at'],
    })
    .refine(d => d.scope !== 'project' || !!d.project_id, {
      message: 'project_id is required when scope is "project"', path: ['project_id'],
    })
    .refine(d => d.scope !== 'team' || !!d.team_id, {
      message: 'team_id is required when scope is "team"', path: ['team_id'],
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

  const { data: limRow } = await db()
    .from('limits')
    .select('org_id, warn_at, throttle_at, block_at')
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (!limRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(limRow.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  // Validate the merged thresholds (warn ≤ throttle ≤ block) using existing
  // values for any field not being changed in this request.
  const warn     = parsed.data.warn_at     ?? limRow.warn_at     ?? 70
  const throttle = parsed.data.throttle_at ?? limRow.throttle_at ?? 90
  const block    = parsed.data.block_at    ?? limRow.block_at    ?? 100
  if (!(warn <= throttle && throttle <= block)) {
    return NextResponse.json(
      { error: 'Thresholds must satisfy warn_at ≤ throttle_at ≤ block_at' },
      { status: 422 }
    )
  }

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
