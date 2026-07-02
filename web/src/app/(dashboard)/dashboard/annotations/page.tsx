import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AnnotationsClient } from './_client'

export const metadata = { title: 'Annotations — TokenFin' }
export interface CaptureRow { id: string; model: string; prompt_text: string; response_text: string | null; created_at: string }

export default async function AnnotationsPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''
  const { data } = await admin
    .from('prompt_captures').select('id, model, prompt_text, response_text, created_at')
    .eq('org_id', orgId).not('response_text', 'is', null).order('created_at', { ascending: false }).limit(30)
  return <AnnotationsClient orgId={orgId} rows={(data ?? []) as CaptureRow[]} />
}
