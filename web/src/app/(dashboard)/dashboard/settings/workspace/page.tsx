import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getOrgRole } from '@/lib/api/auth'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { WorkspaceClient } from './_client'

export const metadata = { title: 'Workspace — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function WorkspacePage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''
  const [{ data: org }, role] = await Promise.all([
    admin.from('organizations').select('name, slug, timezone, capture_prompts').eq('id', orgId).maybeSingle(),
    getOrgRole(user.id, orgId),
  ])
  return (
    <WorkspaceClient
      orgId={orgId}
      isOwner={role === 'owner'}
      name={org?.name ?? ''}
      slug={org?.slug ?? ''}
      timezone={org?.timezone ?? DEFAULT_TIMEZONE}
      capturePrompts={org?.capture_prompts !== false}
    />
  )
}
