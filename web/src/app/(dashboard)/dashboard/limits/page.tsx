import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { ruleCoversLimit }    from '../alerts/_budget-link'
import { channelStatus, INTEG_COLS, type IntegRow } from '../alerts/_channels'
import { LimitsClient }       from './_client'
import { selectAll } from '@/lib/supabase/paginate'
import { dailyTotals, runRate, forecastLimit, periodStartDay } from '@/lib/alerts/forecast'

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
  hasAlert:      boolean
  hasForecastAlert: boolean
  /** Alert rules that watch this budget (same logic as the alert engine). */
  alertRules:    { id: string; name: string; triggerType: 'limit_breach' | 'forecast'; isActive: boolean }[]
  // Forecast (lib/alerts/forecast): 14-day run-rate weighted to the recent 7.
  forecast: {
    ratePerDay:   number
    projectedUsd: number         // projected spend at period end
    projectedPct: number
    runwayDays:   number | null  // null = never runs out at current rate
    exceedDate:   string | null  // YYYY-MM-DD, within this period
    onTrack:      boolean
  } | null                       // null = scope not measurable (member limits)
}

export interface ScopeOption {
  id:   string
  name: string
}

/* ── Server page ── */
export default async function LimitsPage() {
  const { orgId, role } = await requireOrgContext()
  const admin = createAdminClient()

  // Look back far enough to cover any period (monthly is the widest window).
  const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10)
  const sinceTs = since + 'T00:00:00Z'

  const [
    { data: rawLimits },
    { data: projects  },
    { data: teams     },
    { data: members   },
    { data: events    },
    { data: limitAlerts },
    { data: integ },
  ] = await Promise.all([
    admin
      .from('limits')
      .select('id, scope, project_id, team_id, period, budget_usd, warn_at, throttle_at, block_at, is_active, projects(name), teams(name)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    // Team → members mapping (usage_events has no team_id, so team spend is
    // resolved via member user_ids).
    admin.from('members').select('user_id, team_id').eq('org_id', orgId),
    // Raw events, not usage_agg — usage_agg deliberately excludes notional
    // (CLI-agent: Claude Code/Codex/Gemini) spend so analytics totals stay a
    // real bill. Limits need the full picture (metered + notional) or a
    // limit on a project used only via `tokenfin setup` would sit at 0%
    // forever. Spend and budget are never MIXED across cost_basis into a
    // single "bill" elsewhere in the app — this is limits-only, for warning
    // purposes; the "How limits work" copy below reflects the difference.
    selectAll<{ user_id: string | null; project_id: string | null; cost_usd: number; created_at: string }>(() => admin.from('usage_events').select('user_id, project_id, cost_usd, created_at').eq('org_id', orgId).gte('created_at', sinceTs)),
    // Budget alert rules. There's no limit_id FK: a rule watches a limit exactly
    // when the alert engine would evaluate it (alerts/_budget-link.ts).
    admin.from('alert_rules').select('id, name, trigger_type, project_id, is_active, created_at').eq('org_id', orgId).in('trigger_type', ['limit_breach', 'forecast']).order('created_at'),
    admin.from('org_integrations').select(INTEG_COLS).eq('org_id', orgId).eq('is_active', true),
  ])

  const alertRows = (limitAlerts ?? []) as { id: string; name: string; trigger_type: 'limit_breach' | 'forecast'; project_id: string | null; is_active: boolean }[]
  const now = new Date()

  const evs = (events ?? []) as { user_id: string | null; project_id: string | null; cost_usd: number; created_at: string }[]
  const teamUsers = new Map<string, Set<string>>()
  for (const m of (members ?? []) as { user_id: string | null; team_id: string | null }[]) {
    if (!m.team_id || !m.user_id) continue
    if (!teamUsers.has(m.team_id)) teamUsers.set(m.team_id, new Set())
    teamUsers.get(m.team_id)!.add(m.user_id)
  }

  // Events in a limit's scope (last 31 days); null for member scope — the
  // limits table has no member id yet (needs a migration).
  function eventsFor(scope: LimitScope, projectId: string | null, teamId: string | null) {
    if (scope === 'org')     return evs
    if (scope === 'project') return evs.filter(e => e.project_id === projectId)
    if (scope === 'team') {
      const users = teamUsers.get(teamId ?? '') ?? new Set<string>()
      return evs.filter(e => e.user_id && users.has(e.user_id))
    }
    return null
  }

  // Actual period-to-date spend (UTC) + run-rate forecast for a limit.
  function measure(scope: LimitScope, projectId: string | null, teamId: string | null, period: LimitPeriod, budget: number) {
    const scoped = eventsFor(scope, projectId, teamId)
    if (!scoped) return { spent: 0, forecast: null }
    const fromTs = periodStartDay(period, now) + 'T00:00:00Z'
    const spent = +scoped.filter(e => e.created_at >= fromTs).reduce((s, e) => s + Number(e.cost_usd), 0).toFixed(4)
    const f = forecastLimit({ budget, spent, rate: runRate(dailyTotals(scoped), now), period, now })
    return {
      spent,
      forecast: { ratePerDay: f.rate, projectedUsd: f.projected, projectedPct: f.projectedPct, runwayDays: f.runwayDays, exceedDate: f.exceedDate, onTrack: f.onTrack },
    }
  }

  const limits: LimitRow[] = (rawLimits ?? []).map(l => {
    const projName = (l.projects as unknown as { name: string } | null)?.name
    const teamName = (l.teams   as unknown as { name: string } | null)?.name
    const scopeName =
      l.scope === 'org'     ? 'Entire org'  :
      l.scope === 'project' ? (projName ?? 'Unknown project') :
      l.scope === 'team'    ? (teamName ?? 'Unknown team') :
                               'Member'

    const m = measure(l.scope as LimitScope, l.project_id, l.team_id, l.period as LimitPeriod, Number(l.budget_usd))
    const watching = alertRows.filter(r => ruleCoversLimit(r, l))
    return {
      id:            l.id,
      scope:         l.scope as LimitScope,
      scopeName,
      scopeTargetId: l.project_id ?? l.team_id ?? null,
      period:        l.period as LimitPeriod,
      budgetUsd:     l.budget_usd,
      spentUsd:      m.spent,
      warnAt:        l.warn_at,
      throttleAt:    l.throttle_at,
      blockAt:       l.block_at,
      isActive:      l.is_active,
      hasAlert:      watching.some(r => r.is_active && r.trigger_type === 'limit_breach'),
      hasForecastAlert: watching.some(r => r.is_active && r.trigger_type === 'forecast'),
      alertRules:    watching.map(r => ({ id: r.id, name: r.name, triggerType: r.trigger_type, isActive: r.is_active })),
      forecast:      m.forecast,
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
      channels={channelStatus(integ as unknown as IntegRow[] | null)}
    />
  )
}
