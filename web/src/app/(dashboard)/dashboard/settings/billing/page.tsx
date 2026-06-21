import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { BillingClient }      from './_client'

export const metadata = { title: 'Billing — TokenFin' }

export default async function BillingPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  let plan: string = 'free'
  let orgName = ''

  if (orgId) {
    const { data: org } = await admin
      .from('organizations')
      .select('plan, name')
      .eq('id', orgId)
      .maybeSingle()
    plan    = org?.plan    ?? 'free'
    orgName = (org as unknown as { name: string } | null)?.name ?? ''
  }

  return <BillingClient currentPlan={plan} orgName={orgName} />
}
