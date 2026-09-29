import { requireOrgContext } from '@/lib/org-context'
import { redirect }          from 'next/navigation'
import { createClient }       from '@/lib/supabase/server'
import { OnboardingClient }   from './_client'

export default async function OnboardingPage() {
  // Verify the user is authenticated (anon client reads session cookie)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // No workspace → the pending invitation if there is one, else /welcome.
  const ctx = await requireOrgContext()
  const member = { org_id: ctx.orgId }

  return <OnboardingClient orgId={member.org_id} />
}
