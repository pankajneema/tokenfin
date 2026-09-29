import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DatasetsClient } from './_client'

export const metadata = { title: 'Datasets — TokenFin' }
export interface DatasetRow { id: string; name: string; description: string | null; examples: { count: number }[] }

export default async function DatasetsPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const { data } = await admin
    .from('datasets').select('id, name, description, examples(count)').eq('org_id', orgId).order('created_at', { ascending: false })
  return <DatasetsClient orgId={orgId} datasets={(data ?? []) as DatasetRow[]} />
}
