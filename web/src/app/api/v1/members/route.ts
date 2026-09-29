/**
 * /api/v1/members
 *
 * Manages org members: role changes, team assignment, removal.
 * Adding NEW users to the org is done via /api/v1/invites.
 */
import { NextResponse }    from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMemberWithRole, requirePermission, assertOrgOwnsIds, dbError } from '@/lib/api/auth'
import { can } from '@/lib/rbac'
import { z }                 from 'zod'
import { audit } from '@/lib/audit'

function db() { return createAdminClient() }
import { invalidateKeyCache } from '@/lib/otlp/auth'

/**
 * Revoke a (former) member's personal API keys in an org: deactivate them and
 * destroy any not-yet-revealed one-time key material. Org-level keys the user
 * merely created (user_id NULL, e.g. setup-hub) are untouched.
 */
async function revokeMemberKeys(orgId: string, userId: string): Promise<{ keys: number; reveals: number }> {
  const { data: keys } = await db().from('api_keys').update({ is_active: false })
    .eq('org_id', orgId).eq('user_id', userId).eq('is_active', true).select('id')
  const { data: allKeys } = await db().from('api_keys').select('id').eq('org_id', orgId).eq('user_id', userId)
  const ids = (allKeys ?? []).map(k => k.id as string)
  let reveals = 0
  if (ids.length) {
    const { data: burned } = await db().from('key_reveals')
      .update({ ciphertext: null, iv: null, auth_tag: null })
      .in('key_id', ids).is('revealed_at', null).not('ciphertext', 'is', null).select('token')
    reveals = (burned ?? []).length
  }
  invalidateKeyCache()
  return { keys: (keys ?? []).length, reveals }
}

/**
 * Demotion to viewer: personal keys become read-only. Ingest-only keys are
 * deactivated (a viewer may not push telemetry); every other key keeps working
 * with scopes = {read}.
 */
async function downgradeMemberKeys(orgId: string, userId: string): Promise<{ readOnly: number; deactivated: number }> {
  const { data: off } = await db().from('api_keys').update({ is_active: false })
    .eq('org_id', orgId).eq('user_id', userId).eq('is_active', true).eq('kind', 'ingest').select('id')
  const { data: ro } = await db().from('api_keys').update({ scopes: ['read'] })
    .eq('org_id', orgId).eq('user_id', userId).eq('is_active', true).neq('kind', 'ingest').select('id')
  invalidateKeyCache()
  return { readOnly: (ro ?? []).length, deactivated: (off ?? []).length }
}

/* GET /api/v1/members?org_id=xxx
   Returns members enriched with name (and email for owners/admins) from auth.users.
   Any member may list; only roles with members:view receive email addresses. */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard
  const showEmail = can(guard.role, 'members:view')

  const { data: members, error } = await db()
    .from('members')
    .select('id, user_id, team_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (error) return dbError(error, 'GET members')
  if (!members?.length) return NextResponse.json([])

  // Fetch auth user info for display (email + full_name from metadata)
  const { data: authData } = await db().auth.admin.listUsers({ perPage: 1000 })
  const authNameMap = new Map(
    (authData?.users ?? [])
      .filter(u => typeof u.user_metadata?.full_name === 'string' && u.user_metadata.full_name)
      .map(u => [u.id, u.user_metadata!.full_name as string]),
  )
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
    ...(showEmail ? { email: userMap.get(m.user_id)?.email ?? '' } : {}),
    // Non-admins must not learn emails, so don't derive the fallback name from one.
    name:  showEmail
      ? (userMap.get(m.user_id)?.name ?? 'Unknown')
      : (authNameMap.get(m.user_id) ?? 'Member'),
  }))

  return NextResponse.json(enriched)
}

/* PATCH /api/v1/members  { id, role?, team_id? }
   Updates an existing member's role or team assignment. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    id:      z.string().uuid(),
    role:    z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
    team_id: z.string().uuid().nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: memRow } = await db().from('members').select('org_id, role, user_id').eq('id', parsed.data.id).maybeSingle()
  if (!memRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(memRow.org_id, 'members:change_role')
  if (guard instanceof NextResponse) return guard

  const bad = await assertOrgOwnsIds(memRow.org_id, { team_id: parsed.data.team_id })
  if (bad) return bad

  // Last-owner guard: an org must always keep at least one owner.
  if (memRow.role === 'owner' && parsed.data.role && parsed.data.role !== 'owner') {
    const { count } = await db()
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', memRow.org_id)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1)
      return NextResponse.json({ error: 'Cannot demote the last owner' }, { status: 409 })
  }

  const { id, ...fields } = parsed.data
  const { data, error } = await db().from('members').update(fields).eq('id', id).eq('org_id', memRow.org_id).select().single()
  if (error) return dbError(error, 'PATCH members')
  let keys: { readOnly: number; deactivated: number } | undefined
  if (fields.role === 'viewer' && memRow.role !== 'viewer') {
    keys = await downgradeMemberKeys(memRow.org_id, memRow.user_id as string)
  }
  await audit({
    orgId: memRow.org_id, actorUserId: guard.userId, action: 'member.role_change', targetType: 'member', targetId: id,
    details: { ...fields, previous_role: memRow.role, ...(keys ? { keys_read_only: keys.readOnly, keys_deactivated: keys.deactivated } : {}) },
  })
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
    .select('role, org_id, user_id')
    .eq('id', id)
    .maybeSingle()

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
  // A removed member's keys must stop working immediately (keys resolve org by
  // hash alone, so membership removal by itself would not revoke them).
  const revoked = await revokeMemberKeys(member.org_id, member.user_id as string)
  await audit({
    orgId: member.org_id, actorUserId: guard.userId, action: 'member.remove', targetType: 'member', targetId: id,
    details: { role: member.role, user_id: member.user_id, keys_revoked: revoked.keys, reveals_destroyed: revoked.reveals },
  })
  return NextResponse.json({ ok: true, keys_revoked: revoked.keys })
}
