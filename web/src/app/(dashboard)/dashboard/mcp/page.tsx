import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { McpClient }          from './_client'
import type { PlatformRow, PlatformModel } from './_types'

export { type PlatformRow, type PlatformModel } from './_types'

export const metadata = { title: 'Connected Platforms — TokenFin' }

export default async function McpPage() {
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
    { data: keys },
    { data: projects },
    { data: usageRows },
  ] = await Promise.all([
    admin
      .from('api_keys')
      .select('id, name, key_prefix, env, scopes, is_active, last_used_at, created_at, project_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin
      .from('projects')
      .select('id, name')
      .eq('org_id', orgId),
    admin
      .from('usage_agg')
      .select('project_id, model, total_tokens, cost_usd, request_count')
      .eq('org_id', orgId)
      .gte('bucket', since),
  ])

  // Build project name lookup
  const projNames = new Map<string, string>((projects ?? []).map(p => [p.id, p.name]))

  // Aggregate usage per project+model
  type UsageAgg = Map<string, { tokens: number; cost: number; calls: number; models: Map<string, { tokens: number; cost: number; calls: number }> }>
  const projUsage: UsageAgg = new Map()

  for (const row of usageRows ?? []) {
    const pid = row.project_id
    if (!projUsage.has(pid)) projUsage.set(pid, { tokens: 0, cost: 0, calls: 0, models: new Map() })
    const pu = projUsage.get(pid)!
    pu.tokens += row.total_tokens ?? 0
    pu.cost   += Number(row.cost_usd ?? 0)
    pu.calls  += row.request_count ?? 0

    const prev = pu.models.get(row.model) ?? { tokens: 0, cost: 0, calls: 0 }
    pu.models.set(row.model, {
      tokens: prev.tokens + (row.total_tokens ?? 0),
      cost:   prev.cost   + Number(row.cost_usd ?? 0),
      calls:  prev.calls  + (row.request_count ?? 0),
    })
  }

  const platforms: PlatformRow[] = (keys ?? []).map(k => {
    const pu  = projUsage.get(k.project_id) ?? { tokens: 0, cost: 0, calls: 0, models: new Map() }
    const models: PlatformModel[] = Array.from(pu.models.entries())
      .map(([model, u]) => ({ model, tokens30d: u.tokens, cost30d: u.cost, calls30d: u.calls }))
      .sort((a, b) => b.cost30d - a.cost30d)

    return {
      id:          k.id,
      name:        k.name,
      keyPrefix:   k.key_prefix,
      env:         k.env,
      scopes:      k.scopes ?? [],
      isActive:    k.is_active,
      lastUsedAt:  k.last_used_at,
      createdAt:   k.created_at,
      projectId:   k.project_id,
      projectName: projNames.get(k.project_id) ?? 'Unknown project',
      tokens30d:   pu.tokens,
      cost30d:     pu.cost,
      calls30d:    pu.calls,
      models,
    }
  })

  return <McpClient initialPlatforms={platforms} orgId={orgId} />
}
