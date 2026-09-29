/**
 * /accept-invitation
 *
 * Server component — fetches the user's session + pending invitation data,
 * then renders the AcceptInvitationClient form.
 *
 * Reaches here after Supabase magic-link verifies and /auth/callback redirects.
 * The user is already authenticated at this point; they just need to:
 *   1. Set their display name
 *   2. Set a password (only brand-new accounts created by the invite)
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
  if (!user) redirect('/login?next=/accept-invitation')

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
    redirect(members?.length ? '/dashboard' : '/welcome')
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

  // Brand-new accounts created by the invite have no password yet; people who
  // already had an account (sent a sign-in link instead) keep theirs.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const needsPassword = meta.tf_needs_password === true || (!!meta.invited_by && meta.tf_password_set !== true)
  const initialName = typeof meta.full_name === 'string' ? meta.full_name : ''

  return (
    <AcceptInvitationClient
      email={user.email!}
      orgName={orgName}
      orgId={invite.org_id}
      role={invite.role ?? 'member'}
      expired={expired}
      needsPassword={needsPassword}
      initialName={initialName}
    />
  )
}
