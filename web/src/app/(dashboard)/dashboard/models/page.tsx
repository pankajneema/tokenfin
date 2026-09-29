import { createAdminClient } from '@/lib/supabase/server'
import { daysAgoIn } from '@/lib/dates'
import { requireOrgContext } from '@/lib/org-context'
import { dashBreakdown } from '@/lib/rollups'
import { can }                from '@/lib/rbac'
import { ModelsClient }       from './_client'
import { PriceFindings }      from '@/components/dashboard/price-findings'

export const metadata = { title: 'Models — TokenFin' }

export interface EnabledModel {
  model:         string
  addedAt:       string
  tokensUsed30d: number
  costUsed30d:   number
  /** measured mean latency over the last 30 days; null when not reported */
  avgLatencyMs:  number | null
}

export interface CustomPrice {
  model_prefix:      string
  input_per_m:       number
  output_per_m:      number
  cache_read_per_m:  number | null
  cache_write_per_m: number | null
  updated_at:        string | null
}

export default async function ModelsPage() {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const { orgId, role } = ctx
  const to   = daysAgoIn(0, ctx.timezone)
  const from = daysAgoIn(29, ctx.timezone)   // last 30 org-local days, today included

  const [
    { data: orgModels },
    usage,
    { data: priceRows },
  ] = await Promise.all([
    admin
      .from('org_models')
      .select('model, added_at')
      .eq('org_id', orgId)
      .order('added_at', { ascending: true }),
    // Rollups carry metered + notional, so no usage_agg / raw-event fallback.
    dashBreakdown(admin, orgId, from, to, 'model', undefined, 1000)
      .catch(e => { console.error('[models] breakdown failed:', (e as Error)?.message ?? e); return null }),
    admin
      .from('org_model_prices')
      .select('model_prefix, input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, updated_at')
      .eq('org_id', orgId)
      .order('model_prefix', { ascending: true }),
  ])

  const customPrices: CustomPrice[] = (priceRows ?? []).map(r => ({
    model_prefix:      r.model_prefix,
    input_per_m:       Number(r.input_per_m),
    output_per_m:      Number(r.output_per_m),
    cache_read_per_m:  r.cache_read_per_m  == null ? null : Number(r.cache_read_per_m),
    cache_write_per_m: r.cache_write_per_m == null ? null : Number(r.cache_write_per_m),
    updated_at:        r.updated_at ?? null,
  }))

  const usageMap = new Map((usage?.rows ?? []).map(r => [r.key, r]))

  const enabledModels: EnabledModel[] = (orgModels ?? []).map(m => {
    const u = usageMap.get(m.model)
    return {
      model:         m.model,
      addedAt:       m.added_at,
      tokensUsed30d: u?.total_tokens ?? 0,
      costUsed30d:   u?.cost_usd ?? 0,
      avgLatencyMs:  u?.avg_latency_ms ?? null,
    }
  })

  return (
    <div className="space-y-5">
      <PriceFindings orgId={orgId} />
      <ModelsClient
        initialModels={enabledModels}
        orgId={orgId}
        initialPrices={customPrices}
        canManagePrices={can(role, 'models:manage')}
      />
    </div>
  )
}
