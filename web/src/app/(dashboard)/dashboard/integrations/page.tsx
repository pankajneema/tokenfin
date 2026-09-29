import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { can }                from '@/lib/rbac'
import { publicConfig }       from '@/lib/integrations/config'
import { IntegrationsClient } from './_client'
import type { OrgIntegration, ProviderConnection } from './_types'

export { type OrgIntegration } from './_types'

export const metadata = { title: 'Integrations — TokenFin' }

export default async function IntegrationsPage() {
  const { orgId, role } = await requireOrgContext()
  const admin = createAdminClient()

  const [{ data: rows }, { data: conns }] = await Promise.all([
    admin
      .from('org_integrations')
      .select('provider, is_active, connected_at, last_synced_at, sync_ok, detail, config')
      .eq('org_id', orgId)
      .eq('is_active', true),
    admin
      .from('provider_connections')
      .select('id, provider, key_hint, status, last_synced_at, last_error, created_at')
      .eq('org_id', orgId)
      .order('provider'),
  ])

  // Secrets never leave the server: only masked config values are passed down.
  const connected: OrgIntegration[] = (rows ?? []).map(r => {
    const cfg = publicConfig(r.config as Record<string, unknown> | null)
    return {
      integration:  r.provider,
      isActive:     r.is_active,
      connectedAt:  r.connected_at,
      lastSyncedAt: r.last_synced_at,
      syncOk:       r.last_synced_at ? r.sync_ok : null,
      detail:       r.detail,
      label:        typeof cfg.label === 'string' ? cfg.label : null,
      target:       (cfg.webhook_url ?? cfg.url ?? cfg.endpoint ?? null) as string | null,
    }
  })

  return (
    <IntegrationsClient
      initialConnected={connected}
      initialProviders={(conns ?? []) as ProviderConnection[]}
      orgId={orgId}
      canManage={can(role, 'integrations:manage')}
      canConnectBilling={can(role, 'org:edit')}
      emailReady={!!process.env.RESEND_API_KEY}
    />
  )
}
