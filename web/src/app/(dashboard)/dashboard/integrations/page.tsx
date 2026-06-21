import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { IntegrationsClient } from './_client'
import type { OrgIntegration } from './_types'

export { type OrgIntegration } from './_types'

export const metadata = { title: 'Integrations — TokenFin' }

export default async function IntegrationsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''

  const { data: rows } = await admin
    .from('org_integrations')
    .select('integration, is_active, connected_at, last_synced_at, sync_ok, detail')
    .eq('org_id', orgId)
    .eq('is_active', true)

  const connected: OrgIntegration[] = (rows ?? []).map(r => ({
    integration:  r.integration,
    isActive:     r.is_active,
    connectedAt:  r.connected_at,
    lastSyncedAt: r.last_synced_at,
    syncOk:       r.sync_ok,
    detail:       r.detail,
  }))

  return <IntegrationsClient initialConnected={connected} orgId={orgId} />
}
