import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgRole } from '@/lib/api/auth'
import { AuditClient } from './_client'

export const metadata = { title: 'Audit log — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''
  const role  = await getOrgRole(user.id, orgId)
  return <AuditClient orgId={orgId} canView={role === 'owner' || role === 'admin'} />
}
