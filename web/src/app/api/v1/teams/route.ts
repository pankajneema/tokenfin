import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, requireResourcePermission, assertOrgOwnsIds, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/teams?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('teams')
    .select('id, name, project_id, created_at')
    .eq('org_id', orgId!)
    .order('created_at', { ascending: true })
  if (error) return dbError(error, 'GET teams')
  return NextResponse.json(data)
}

/* POST /api/v1/teams */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:     z.string().uuid(),
    name:       z.string().min(1).max(64),
    project_id: z.string().uuid().optional().nullable(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'teams:manage')
  if (guard instanceof NextResponse) return guard

  const bad = await assertOrgOwnsIds(parsed.data.org_id, { project_id: parsed.data.project_id })
  if (bad) return bad

  const { data, error } = await db().from('teams').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST teams')
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/teams */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    id:         z.string().uuid(),
    name:       z.string().min(1).max(64).optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourcePermission('teams', parsed.data.id, 'teams:manage')
  if (guard instanceof NextResponse) return guard

  const bad = await assertOrgOwnsIds(guard.orgId, { project_id: parsed.data.project_id })
  if (bad) return bad

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('teams').update(fields).eq('id', id).eq('org_id', guard.orgId).select().single()
  if (error) return dbError(error, 'PATCH teams')
  return NextResponse.json(data)
}

/* DELETE /api/v1/teams?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const guard = await requireResourcePermission('teams', id, 'teams:manage')
  if (guard instanceof NextResponse) return guard

  // Unassign members before deleting the team
  await db().from('members').update({ team_id: null }).eq('team_id', id!).eq('org_id', guard.orgId)

  const { error } = await db().from('teams').delete().eq('id', id!).eq('org_id', guard.orgId)
  if (error) return dbError(error, 'DELETE teams')
  return NextResponse.json({ ok: true })
}
