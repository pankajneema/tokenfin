import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PairwiseClient } from './_client'

export const metadata = { title: 'Pairwise — TokenFin' }

export default async function PairwisePage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  return <PairwiseClient orgId={ctx.orgId} />
}
