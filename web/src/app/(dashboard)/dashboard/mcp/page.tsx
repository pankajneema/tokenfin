import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { can, kindForScopes } from '@/lib/rbac'
import { McpClient }          from './_client'
import { inferConnection }    from '../setup/_catalog'
import type { PlatformRow, PlatformModel, ReadKeyRow } from './_types'
import { selectAll } from '@/lib/supabase/paginate'
import { promptKey } from '@/lib/prompts'

export { type PlatformRow, type PlatformModel } from './_types'

export const metadata = { title: 'Connected Platforms — TokenFin' }

export default async function McpPage() {
  const { user, orgId, role } = await requireOrgContext()
  const admin    = createAdminClient()
  // Owners/admins manage every key; members/viewers only see keys they own.
  const seeAll   = can(role, 'keys:view')

  const since = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    { data: keys },
    { data: projects },
    { data: usageRows },
  ] = await Promise.all([
    admin
      .from('api_keys')
      .select('id, name, key_prefix, env, scopes, is_active, last_used_at, created_at, project_id, user_id, created_by')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('projects')
      .select('id, name')
      .eq('org_id', orgId),
    selectAll<{ id: string; correlation_id: string | null; api_key_id: string | null; model: string; total_tokens: number; cost_usd: number; source: string | null }>(() => admin
      .from('usage_events')
      .select('id, correlation_id, api_key_id, model, total_tokens, cost_usd, source')
      .eq('org_id', orgId)
      .gte('created_at', since)),
  ])

  const visibleKeys = (keys ?? []).filter(k => seeAll || k.user_id === user.id || (!k.user_id && k.created_by === user.id))

  // Read keys = what `npx tokenfin setup` registers as the MCP server's Bearer.
  const readKeys: ReadKeyRow[] = visibleKeys
    .filter(k => k.is_active && (k.scopes ?? []).includes('read'))
    .map(k => ({
      id: k.id, name: k.name, keyPrefix: k.key_prefix, lastUsedAt: k.last_used_at,
      createdAt: k.created_at, mine: k.user_id === user.id || (!k.user_id && k.created_by === user.id),
      readOnly: kindForScopes(k.scopes ?? []) === 'read',
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.readOnly) - Number(a.readOnly) || b.createdAt.localeCompare(a.createdAt))

  // Build project name lookup
  const projNames = new Map<string, string>((projects ?? []).map(p => [p.id, p.name]))

  // Aggregate usage per KEY + model (attributed by api_key_id, not project).
  type UsageAgg = Map<string, { tokens: number; cost: number; calls: number; prompts: Set<string>; sources: Set<string>; models: Map<string, { tokens: number; cost: number; calls: number }> }>
  const keyUsage: UsageAgg = new Map()

  for (const row of usageRows ?? []) {
    const kid = (row as { api_key_id: string | null; source: string | null }).api_key_id
    if (!kid) continue // unattributed events count toward no key
    if (!keyUsage.has(kid)) keyUsage.set(kid, { tokens: 0, cost: 0, calls: 0, prompts: new Set(), sources: new Set(), models: new Map() })
    const pu = keyUsage.get(kid)!
    pu.tokens += row.total_tokens ?? 0
    pu.cost   += Number(row.cost_usd ?? 0)
    pu.calls  += 1 // one usage_event = one call
    pu.prompts.add(promptKey(row))
    if (row.source) pu.sources.add(row.source)

    const prev = pu.models.get(row.model) ?? { tokens: 0, cost: 0, calls: 0 }
    pu.models.set(row.model, {
      tokens: prev.tokens + (row.total_tokens ?? 0),
      cost:   prev.cost   + Number(row.cost_usd ?? 0),
      calls:  prev.calls  + 1,
    })
  }

  const platforms: PlatformRow[] = visibleKeys.map(k => {
    const pu  = keyUsage.get(k.id) ?? { tokens: 0, cost: 0, calls: 0, prompts: new Set<string>(), sources: new Set<string>(), models: new Map() }
    const models: PlatformModel[] = Array.from(pu.models.entries())
      .map(([model, u]) => ({ model, tokens30d: u.tokens, cost30d: u.cost, calls30d: u.calls }))
      .sort((a, b) => b.cost30d - a.cost30d)

    const { tier, accuracy } = inferConnection(k.name, models.map(m => m.model), Array.from(pu.sources))

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
      prompts30d:  pu.prompts.size,
      models,
      tier,
      accuracy,
    }
  })

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com').replace(/\/+$/, '')
  return (
    <McpClient
      initialPlatforms={platforms}
      orgId={orgId}
      readKeys={readKeys}
      appUrl={appUrl}
      orgWide={can(role, 'prompts:view_all')}
    />
  )
}
