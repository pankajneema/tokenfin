import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireResourceOwner, dbError } from '@/lib/api/auth'
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
  const body = await req.json()
  const schema = z.object({
    org_id:     z.string().uuid(),
    name:       z.string().min(1).max(64),
    project_id: z.string().uuid().optional().nullable(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('teams').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST teams')
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/teams */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:         z.string().uuid(),
    name:       z.string().min(1).max(64).optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourceOwner('teams', parsed.data.id)
  if (guard instanceof NextResponse) return guard

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('teams').update(fields).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH teams')
  return NextResponse.json(data)
}

/* DELETE /api/v1/teams?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const guard = await requireResourceOwner('teams', id)
  if (guard instanceof NextResponse) return guard

  // Unassign members before deleting the team
  await db().from('members').update({ team_id: null }).eq('team_id', id!)

  const { error } = await db().from('teams').delete().eq('id', id!)
  if (error) return dbError(error, 'DELETE teams')
  return NextResponse.json({ ok: true })
}
