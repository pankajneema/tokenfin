/**
 * GET /api/v1/invites/pending — the signed-in user's newest pending, unexpired
 * invitation ({ invite: { org_id, org_name, role } } or { invite: null }).
 * /welcome calls this before creating a workspace so an invited person joins
 * their team instead of starting an empty one.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { findPendingInvite } from '@/lib/invites'

export async function GET() {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const invite = await findPendingInvite(createAdminClient(), user.email)
  return NextResponse.json({
    invite: invite ? { org_id: invite.org_id, org_name: invite.org_name, role: invite.role } : null,
  })
}
