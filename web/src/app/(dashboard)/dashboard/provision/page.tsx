import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ProvisionClient } from './_client'

export const metadata = { title: 'Provision team — TokenFin' }

export interface SimpleRow { id: string; name: string }

export default async function ProvisionPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId

  const [{ data: projects }, { data: teams }] = await Promise.all([
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name'),
  ])

  return (
    <ProvisionClient
      orgId={orgId}
      projects={(projects ?? []) as SimpleRow[]}
      teams={(teams ?? []) as SimpleRow[]}
    />
  )
}
