import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import { WorkspaceClient } from './_client'

export const metadata = { title: 'Workspace — TokenFin' }
export const dynamic = 'force-dynamic'

export default async function WorkspacePage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const [{ data: org }, role] = await Promise.all([
    admin.from('organizations').select('name, slug, timezone, capture_prompts, trace_capture').eq('id', orgId).maybeSingle(),
    Promise.resolve(ctx.role),
  ])
  return (
    <WorkspaceClient
      orgId={orgId}
      isOwner={role === 'owner'}
      name={org?.name ?? ''}
      slug={org?.slug ?? ''}
      timezone={org?.timezone ?? DEFAULT_TIMEZONE}
      capturePrompts={org?.capture_prompts !== false}
      traceCapture={(org as { trace_capture?: string } | null)?.trace_capture === 'all' ? 'all' : 'errors'}
    />
  )
}
