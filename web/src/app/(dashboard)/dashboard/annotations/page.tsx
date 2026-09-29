import { requireOrgContext } from '@/lib/org-context'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AnnotationsClient } from './_client'

export const metadata = { title: 'Annotations — TokenFin' }
export interface CaptureRow { id: string; model: string; prompt_text: string; response_text: string | null; created_at: string }

export default async function AnnotationsPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ctx = await requireOrgContext()   // honours the selected workspace (tf_org)
  const orgId = ctx.orgId
  const { data } = await admin
    .from('prompt_captures').select('id, model, prompt_text, response_text, created_at')
    .eq('org_id', orgId).not('response_text', 'is', null).order('created_at', { ascending: false }).limit(30)
  return <AnnotationsClient orgId={orgId} rows={(data ?? []) as CaptureRow[]} />
}
