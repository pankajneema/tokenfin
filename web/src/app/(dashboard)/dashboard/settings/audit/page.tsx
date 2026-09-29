import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AuditClient } from './_client'

export const metadata = { title: 'Audit log — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const role  = ctx.role
  return <AuditClient orgId={orgId} canView={role === 'owner' || role === 'admin'} />
}
