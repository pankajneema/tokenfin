import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgRole }         from '@/lib/api/auth'
import { LimitsClient }       from './_client'

export const metadata = { title: 'Budget Limits — TokenFin' }

/* ── Types ── */
export type LimitScope  = 'org' | 'project' | 'team' | 'member'
export type LimitPeriod = 'daily' | 'weekly' | 'monthly'

export interface LimitRow {
  id:            string
  scope:         LimitScope
  scopeName:     string
  scopeTargetId: string | null
  period:        LimitPeriod
  budgetUsd:     number
  spentUsd:      number       // period-to-date spend, from usage_agg / usage_events
  warnAt:        number
  throttleAt:    number
  blockAt:       number
  isActive:      boolean
}

export interface ScopeOption {
  id:   string
  name: string
}

/* ── Server page ── */
export default async function LimitsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members')
    .select('org_id')
    .eq('user_id', user!.id)
    .limit(1)

  const orgId = _mb?.[0]?.org_id ?? ''
  const role  = await getOrgRole(user.id, orgId)

  // Look back far enough to cover any period (monthly is the widest window).
  const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10)
  const sinceTs = since + 'T00:00:00Z'

  const [
    { data: rawLimits },
    { data: projects  },
    { data: teams     },
    { data: aggRows   },
    { data: members   },
    { data: events    },
  ] = await Promise.all([
    admin
      .from('limits')
      .select('id, scope, project_id, team_id, period, budget_usd, warn_at, throttle_at, block_at, is_active, projects(name), teams(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    // Pre-aggregated cost by project/day — powers org + project spend (scales).
    admin.from('usage_agg').select('project_id, bucket, cost_usd').eq('org_id', orgId).gte('bucket', since),
    // Team → members mapping (usage_agg has no user_id, so team spend uses events).
    admin.from('members').select('user_id, team_id').eq('org_id', orgId),
    // Per-user cost for team-scoped spend.
    admin.from('usage_events').select('user_id, cost_usd, created_at').eq('org_id', orgId).gte('created_at', sinceTs),
  ])

  // Period window start (UTC date string) for a given limit period.
  const fromDate = (period: LimitPeriod): string => {
    const now = new Date()
    if (period === 'daily')  return now.toISOString().slice(0, 10)
    if (period === 'weekly') return new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10)
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  }

  const agg = (aggRows ?? []) as { project_id: string | null; bucket: string; cost_usd: number }[]
  const evs = (events ?? []) as { user_id: string | null; cost_usd: number; created_at: string }[]
  const teamUsers = new Map<string, Set<string>>()
  for (const m of (members ?? []) as { user_id: string | null; team_id: string | null }[]) {
    if (!m.team_id || !m.user_id) continue
    if (!teamUsers.has(m.team_id)) teamUsers.set(m.team_id, new Set())
    teamUsers.get(m.team_id)!.add(m.user_id)
  }

  // Actual period-to-date spend for a limit, scoped correctly.
  function spendFor(scope: LimitScope, projectId: string | null, teamId: string | null, period: LimitPeriod): number {
    const from = fromDate(period)
    if (scope === 'org')
      return +agg.filter(r => r.bucket >= from).reduce((s, r) => s + Number(r.cost_usd), 0).toFixed(4)
    if (scope === 'project')
      return +agg.filter(r => r.project_id === projectId && r.bucket >= from).reduce((s, r) => s + Number(r.cost_usd), 0).toFixed(4)
    if (scope === 'team') {
      const users = teamUsers.get(teamId ?? '') ?? new Set<string>()
      const fromTs = from + 'T00:00:00Z'
      return +evs.filter(e => e.user_id && users.has(e.user_id) && e.created_at >= fromTs).reduce((s, e) => s + Number(e.cost_usd), 0).toFixed(4)
    }
    return 0 // member scope: limits table has no member id yet (needs a migration)
  }

  const limits: LimitRow[] = (rawLimits ?? []).map(l => {
    const projName = (l.projects as unknown as { name: string } | null)?.name
    const teamName = (l.teams   as unknown as { name: string } | null)?.name
    const scopeName =
      l.scope === 'org'     ? 'Entire org'  :
      l.scope === 'project' ? (projName ?? 'Unknown project') :
      l.scope === 'team'    ? (teamName ?? 'Unknown team') :
                               'Member'

    return {
      id:            l.id,
      scope:         l.scope as LimitScope,
      scopeName,
      scopeTargetId: l.project_id ?? l.team_id ?? null,
      period:        l.period as LimitPeriod,
      budgetUsd:     l.budget_usd,
      spentUsd:      spendFor(l.scope as LimitScope, l.project_id, l.team_id, l.period as LimitPeriod),
      warnAt:        l.warn_at,
      throttleAt:    l.throttle_at,
      blockAt:       l.block_at,
      isActive:      l.is_active,
    }
  })

  const projectOptions: ScopeOption[] = (projects ?? []).map(p => ({ id: p.id, name: p.name }))
  const teamOptions:    ScopeOption[] = (teams    ?? []).map(t => ({ id: t.id, name: t.name }))

  return (
    <LimitsClient
      initialLimits={limits}
      projects={projectOptions}
      teams={teamOptions}
      orgId={orgId}
      role={role}
    />
  )
}
