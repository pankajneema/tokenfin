import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DataClient } from './_client'

export const metadata = { title: 'Data — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function DataSettingsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const role  = ctx.role

  return <DataClient orgId={orgId} isOwner={role === 'owner'} />
}
