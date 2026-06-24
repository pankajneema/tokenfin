/**
 * /api/v1/members
 *
 * Manages org members: role changes, team assignment, removal.
 * Adding NEW users to the org is done via /api/v1/invites.
 */
import { NextResponse }    from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z }                 from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/members?org_id=xxx
   Returns members enriched with email + name from auth.users. */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data: members, error } = await db()
    .from('members')
    .select('id, user_id, team_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (error) return dbError(error, 'GET members')
  if (!members?.length) return NextResponse.json([])

  // Fetch auth user info for display (email + full_name from metadata)
  const { data: authData } = await db().auth.admin.listUsers({ perPage: 1000 })
  const userMap = new Map(
    (authData?.users ?? []).map(u => [
      u.id,
      {
        email: u.email ?? '',
        name:  (u.user_metadata?.full_name as string | undefined)
               ?? u.email?.split('@')[0]
               ?? 'Unknown',
      },
    ])
  )

  const enriched = members.map(m => ({
    ...m,
    email: userMap.get(m.user_id)?.email ?? '',
    name:  userMap.get(m.user_id)?.name  ?? 'Unknown',
  }))

  return NextResponse.json(enriched)
}

/* PATCH /api/v1/members  { id, role?, team_id? }
   Updates an existing member's role or team assignment. */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:      z.string().uuid(),
    role:    z.enum(['owner', 'admin', 'developer', 'viewer']).optional(),
    team_id: z.string().uuid().nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: memRow } = await db().from('members').select('org_id').eq('id', parsed.data.id).maybeSingle()
  if (!memRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(memRow.org_id, 'members:change_role')
  if (guard instanceof NextResponse) return guard

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('members').update(fields).eq('id', id).select().single()
  if (error) return dbError(error, 'PATCH members')
  return NextResponse.json(data)
}

/* DELETE /api/v1/members?id=xxx
   Removes a member from the org entirely. Cannot remove the last owner. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Fetch member's role + org — need both for the guard and the last-owner check
  const { data: member } = await db()
    .from('members')
    .select('role, org_id')
    .eq('id', id)
    .single()

  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const guard = await requirePermission(member.org_id, 'members:remove')
  if (guard instanceof NextResponse) return guard

  if (member.role === 'owner') {
    // Prevent removing the last owner
    const { count } = await db()
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', member.org_id)
      .eq('role', 'owner')

    if ((count ?? 0) <= 1)
      return NextResponse.json({ error: 'Cannot remove the last owner' }, { status: 409 })
  }

  const { error } = await db().from('members').delete().eq('id', id)
  if (error) return dbError(error, 'DELETE members')
  return NextResponse.json({ ok: true })
}
