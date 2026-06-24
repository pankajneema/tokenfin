/**
 * /accept-invitation
 *
 * Server component — fetches the user's session + pending invitation data,
 * then renders the AcceptInvitationClient form.
 *
 * Reaches here after Supabase magic-link verifies and /auth/callback redirects.
 * The user is already authenticated at this point; they just need to:
 *   1. Set their display name
 *   2. Set a password
 *   3. Accept (or cancel) the invitation
 */
import { redirect }           from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AcceptInvitationClient } from './_client'

export const metadata = { title: 'Accept Invitation — TokenFin' }

export default async function AcceptInvitationPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  // ── Must be authenticated (magic link already set the session) ────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Find pending invitation for this email ────────────────────────────────
  const { data: invite } = await admin
    .from('invitations')
    .select('id, org_id, role, expires_at')
    .eq('email', user.email!.toLowerCase())
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // No invite → they came here by mistake; send to plans (new user) or dashboard
  if (!invite) {
    const { data: members } = await admin
      .from('members').select('id').eq('user_id', user.id).limit(1)
    redirect(members?.length ? '/dashboard' : '/plans')
  }

  // Expired invite
  const expired = invite.expires_at
    ? new Date(invite.expires_at) < new Date()
    : false

  // ── Fetch org name ────────────────────────────────────────────────────────
  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', invite.org_id)
    .maybeSingle()

  const orgName = org?.name ?? 'your team'

  return (
    <AcceptInvitationClient
      email={user.email!}
      orgName={orgName}
      orgId={invite.org_id}
      role={invite.role ?? 'member'}
      expired={expired}
    />
  )
}
