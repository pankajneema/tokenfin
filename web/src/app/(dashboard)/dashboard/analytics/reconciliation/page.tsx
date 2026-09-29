import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { selectAll } from '@/lib/supabase/paginate'
import { reconcile } from '@/lib/billing-sync/reconcile'
import { ReconciliationClient } from './_client'

export const metadata = { title: 'Bill Reconciliation — TokenFin Analytics' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Only providers with a cost API we sync (lib/billing-sync). */
const PROVIDERS = ['anthropic', 'openai']

/**
 * Provider-reported cost (provider_costs, pulled with the org's admin keys) vs
 * TokenFin metered cost (usage_events, notional excluded), per UTC day.
 */
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId

  const { days: daysParam } = await searchParams
  const days = Math.min(90, Math.max(7, parseInt(daysParam ?? '30') || 30))

  const now   = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86400_000)
    .toISOString().slice(0, 10)

  const [{ data: conns }, { data: costs }, { data: metered, error: meteredErr }] = await Promise.all([
    admin.from('provider_connections').select('provider, status, last_synced_at, last_error').eq('org_id', orgId).in('provider', PROVIDERS),
    selectAll<{ day: string; provider: string; cost_usd: number }>(() => admin.from('provider_costs')
      .select('id, day, provider, cost_usd').eq('org_id', orgId).gte('day', since).in('provider', PROVIDERS).neq('line_item', 'usage:tokens')),
    admin.rpc('reconciliation_metered_daily', { p_org: orgId, p_since: since }),
  ])
  if (meteredErr) console.error('[reconciliation] metered query failed:', meteredErr.message)

  // Connected providers, plus any with imported history (kept after disconnect).
  const providers = Array.from(new Set([...(conns ?? []).map(c => c.provider as string), ...costs.map(c => c.provider)])).sort()
  const rows = reconcile(costs, (metered ?? []) as { day: string; provider: string; cost_usd: number }[], providers)

  return (
    <ReconciliationClient
      rows={rows}
      days={days}
      since={since}
      providers={providers}
      connections={(conns ?? []) as { provider: string; status: string; last_synced_at: string | null; last_error: string | null }[]}
      meteredError={!!meteredErr}
    />
  )
}
