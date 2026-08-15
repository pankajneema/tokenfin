import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { daysAgoIST, tsNDaysAgo } from '@/lib/dates'
import { ModelsClient }       from './_client'

export const metadata = { title: 'Models — TokenFin' }

export interface EnabledModel {
  model:         string
  addedAt:       string
  tokensUsed30d: number
  costUsed30d:   number
}

export default async function ModelsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .limit(1)

  const orgId    = _mb?.[0]?.org_id ?? ''
  const sinceDate = daysAgoIST(30)   // IST date for usage_agg.bucket
  const sinceTs   = tsNDaysAgo(30)   // UTC ts for usage_events.created_at

  const [
    { data: orgModels },
    { data: aggRows },
    { data: evtRows },
  ] = await Promise.all([
    admin
      .from('org_models')
      .select('model, added_at')
      .eq('org_id', orgId)
      .order('added_at', { ascending: true }),
    admin
      .from('usage_agg')
      .select('model, total_tokens, cost_usd')
      .eq('org_id', orgId)
      .gte('bucket', sinceDate),
    admin
      .from('usage_events')
      .select('model, total_tokens, cost_usd, cost_basis')
      .eq('org_id', orgId)
      .gte('created_at', sinceTs),
  ])

  // usage_agg is written async and can lag or partially miss rows — fall back
  // to raw usage_events (source of truth) when agg looks incomplete, same
  // pattern used across the dashboard/analytics pages. usage_agg only ever
  // holds METERED rows, so the completeness check compares against the
  // metered subset of events too — otherwise orgs with subscription
  // (notional) usage would always look "incomplete" and never use the fast
  // path, even when usage_agg is perfectly complete for what it tracks.
  const aggCostTotal  = (aggRows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const evtsCostTotal = (evtRows ?? []).filter(r => (r as Record<string,unknown>).cost_basis !== 'notional').reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const aggIsComplete = aggCostTotal > 0 && aggCostTotal >= evtsCostTotal * 0.95
  // usage_agg NEVER contains notional rows (by design) — top it up with
  // notional rows read straight from raw events, or trusting agg silently
  // drops subscription spend/tokens from the per-model breakdown below.
  const notionalRows  = (evtRows ?? []).filter(r => (r as Record<string,unknown>).cost_basis === 'notional')
  const usageRows      = aggIsComplete ? [...(aggRows ?? []), ...notionalRows] : (evtRows ?? [])

  // Aggregate usage per model
  const usageMap = new Map<string, { tokens: number; cost: number }>()
  for (const row of usageRows) {
    const prev = usageMap.get(row.model) ?? { tokens: 0, cost: 0 }
    usageMap.set(row.model, {
      tokens: prev.tokens + (row.total_tokens ?? 0),
      cost:   prev.cost   + Number(row.cost_usd ?? 0),
    })
  }

  const enabledModels: EnabledModel[] = (orgModels ?? []).map(m => {
    const u = usageMap.get(m.model) ?? { tokens: 0, cost: 0 }
    return {
      model:         m.model,
      addedAt:       m.added_at,
      tokensUsed30d: u.tokens,
      costUsed30d:   u.cost,
    }
  })

  return <ModelsClient initialModels={enabledModels} orgId={orgId} />
}
