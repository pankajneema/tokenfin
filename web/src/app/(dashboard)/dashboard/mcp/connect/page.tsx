import { createClient, createAdminClient } from '@/lib/supabase/server'
import { McpConnectClient } from './_client'

export const metadata = { title: 'MCP Setup — TokenFin' }

export interface SimpleRow { id: string; name: string }

export default async function McpConnectPage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''
  const { data: projects } = await admin.from('projects').select('id, name').eq('org_id', orgId).order('name')

  return <McpConnectClient orgId={orgId} userId={user!.id} projects={(projects ?? []) as SimpleRow[]} />
}
