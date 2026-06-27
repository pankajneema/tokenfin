import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ProvisionClient } from './_client'

export const metadata = { title: 'Provision team — TokenFin' }

export interface SimpleRow { id: string; name: string }

export default async function ProvisionPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

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
