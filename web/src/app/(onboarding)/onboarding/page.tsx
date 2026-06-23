import { redirect }          from 'next/navigation'
import { createClient,
         createAdminClient }  from '@/lib/supabase/server'
import { OnboardingClient }   from './_client'

export default async function OnboardingPage() {
  // Verify the user is authenticated (anon client reads session cookie)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client to query members — bypasses RLS so we always get real data
  // regardless of any session/cookie timing issues in the server component.
  const admin = createAdminClient()
  const { data: members, error } = await admin
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)

  if (error) {
    console.error('[OnboardingPage] members query failed:', error)
  }

  const member = members?.[0] ?? null

  if (!member) {
    console.log('[OnboardingPage] no member found for user', user.id, '— redirecting to /plans')
    redirect('/plans')
  }

  return <OnboardingClient orgId={member.org_id} />
}
