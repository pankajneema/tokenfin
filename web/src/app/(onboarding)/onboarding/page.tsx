import { requireOrgContext } from '@/lib/org-context'
import { redirect }          from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { findPendingInvite, ACCEPT_PATH } from '@/lib/invites'
import { OnboardingClient }   from './_client'

export default async function OnboardingPage() {
  // Verify the user is authenticated (anon client reads session cookie)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // No workspace → the pending invitation if there is one, else /welcome.
  const ctx = await requireOrgContext()
  const member = { org_id: ctx.orgId }

  // Invited to another team? Show that instead of setting up an empty workspace.
  const invite = await findPendingInvite(createAdminClient(), ctx.user.email)
  if (invite && invite.org_id !== ctx.orgId) redirect(ACCEPT_PATH)

  return <OnboardingClient orgId={member.org_id} />
}
