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
  spentUsd:      number       // 0 until usage_agg is wired
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

  const [
    { data: rawLimits },
    { data: projects  },
    { data: teams     },
  ] = await Promise.all([
    admin
      .from('limits')
      .select('id, scope, project_id, team_id, period, budget_usd, warn_at, throttle_at, block_at, is_active, projects(name), teams(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name'),
  ])

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
      spentUsd:      0,
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
