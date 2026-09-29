/**
 * POST /api/v1/invites/accept
 *
 * Called after the invited user has authenticated (clicked magic link → /auth/callback).
 * Body: { name?: string }   — optional display name update
 *
 * What it does:
 *  1. Gets the current user from session
 *  2. Finds their pending invitation by email
 *  3. Creates a members row with the role stored on the invitation
 *  4. Marks the invitation as 'accepted'
 *  5. Updates full_name in auth.users metadata if provided
 */
import { NextResponse }        from 'next/server'
import type { NextRequest }    from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { dbError }             from '@/lib/api/auth'
import type { Role }           from '@/lib/rbac'
import { ORG_COOKIE }         from '@/lib/org-context'
import { audit }              from '@/lib/audit'
import { removeEmptyOwnWorkspaces } from '@/lib/invites'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin    = createAdminClient()

  // 1. Verify session
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : null
  const passwordSet = body.password_set === true

  // 2. Find pending invitation for this email
  const { data: invite, error: invErr } = await admin
    .from('invitations')
    .select('id, org_id, role, expires_at')
    .eq('email', user.email!.toLowerCase())
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (invErr)  return dbError(invErr, 'accept invite — fetch invitation')
  if (!invite) return NextResponse.json({ error: 'No pending invitation found for this email.' }, { status: 404 })

  // 3. Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invitation has expired. Ask the team owner to resend.' }, { status: 410 })
  }

  // 4. Check if already a member
  const { data: existing } = await admin
    .from('members')
    .select('id')
    .eq('org_id', invite.org_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!existing) {
    // 5. Create the membership with the correct role
    const { error: memberErr } = await admin
      .from('members')
      .insert({
        org_id:     invite.org_id,
        user_id:    user.id,
        role:       (invite.role as Role) ?? 'member',
        invited_by: null,
        joined_at:  new Date().toISOString(),
      })
    if (memberErr) return dbError(memberErr, 'accept invite — insert member')
  }

  // 6. Mark invitation as accepted
  await admin
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invite.id)

  // 7. Display name + clear the "set a password" flag once one is set.
  const meta: Record<string, unknown> = {}
  if (name) meta.full_name = name
  if (passwordSet) { meta.tf_needs_password = false; meta.tf_password_set = true }
  if (Object.keys(meta).length) {
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata ?? {}), ...meta },
    })
  }

  // Drop the empty workspace auto-created at signup (if any) so every device
  // opens the team they just joined.
  const removedEmpty = await removeEmptyOwnWorkspaces(admin, user.id, invite.org_id).catch(() => [] as string[])

  if (!existing) {
    await audit({ orgId: invite.org_id, actorUserId: user.id, action: 'member.join', targetType: 'member', targetId: user.id, details: { via: 'invitation', role: invite.role ?? 'member', removed_empty_workspaces: removedEmpty.length } })
  }

  // Open the joined workspace next (people who already had their own
  // workspace would otherwise land back in it).
  const res = NextResponse.json({ ok: true, org_id: invite.org_id, role: invite.role })
  res.cookies.set(ORG_COOKIE, invite.org_id, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 365 })
  return res
}

/**
 * POST /api/v1/invites/accept/decline
 * Marks invitation as declined — called by Cancel button.
 */
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await admin
    .from('invitations')
    .update({ status: 'declined' })
    .eq('email', user.email!.toLowerCase())
    .eq('status', 'pending')

  if (error) return dbError(error, 'decline invite')

  // Sign the user out since they declined — they have no org to go to
  await supabase.auth.signOut()

  return NextResponse.json({ ok: true })
}
