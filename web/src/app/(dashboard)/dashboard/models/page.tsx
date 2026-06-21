import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
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

  const { data: membership } = await supabase
    .from('members')
    .select('org_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const orgId = membership?.org_id ?? ''
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    { data: orgModels },
    { data: usageRows },
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
      .gte('bucket', since),
  ])

  // Aggregate usage per model
  const usageMap = new Map<string, { tokens: number; cost: number }>()
  for (const row of usageRows ?? []) {
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
