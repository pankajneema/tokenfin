import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PairwiseClient } from './_client'

export const metadata = { title: 'Pairwise — TokenFin' }

export default async function PairwisePage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  return <PairwiseClient orgId={membership?.[0]?.org_id ?? ''} />
}
