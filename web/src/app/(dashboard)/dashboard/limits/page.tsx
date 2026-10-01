import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { ruleCoversLimit }    from '../alerts/_budget-link'
import { channelStatus, INTEG_COLS, type IntegRow } from '../alerts/_channels'
import { LimitsClient }       from './_client'
import { selectAll } from '@/lib/supabase/paginate'
import { dailyTotals, runRate, forecastLimit } from '@/lib/alerts/forecast'
import { computeLimitStates } from '@/lib/alerts/limits-runner'
import { normalizeLimit, type Metric, type Basis, type AutoAction } from '@/lib/alerts/model-limits'
import { daysAgoIn } from '@/lib/dates'
import { log } from '@/lib/log'
import type { RouteRow, BlockRow } from '../analytics/quality-cost/_routes'

export const metadata = { title: 'Budget Limits — TokenFin' }

/* ── Types ── */
export type LimitScope  = 'org' | 'project' | 'team' | 'member'
export type LimitPeriod = 'daily' | 'weekly' | 'monthly'

export interface LimitEventRow { level: 'notify' | 'action'; periodKey: string; firedAt: string; pct: number | null }

export interface LimitRow {
  id:            string
  scope:         LimitScope
  scopeName:     string
  scopeTargetId: string | null
  period:        LimitPeriod
  /** The limit amount in `metric` units (dollars for cost_usd). */
  budgetUsd:     number
  /** Period-to-date usage in `metric` units (org time zone, calendar period). */
  spentUsd:      number
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
  } | null                       // null = not a whole-scope dollar budget
  // Migration 024
  model:         string | null
  metric:        Metric
  basis:         Basis
  userId:        string | null
  notifyAt:      number | null
  notifyChannels: { inapp: boolean; email: boolean }
  autoAction:    AutoAction
  switchTo:      string | null
  autoActionAt:  number
  /** false = member limit without a member (created before migration 024) */
  measurable:    boolean
  resetsAt:      string | null
  periodKey:     string | null
  /** ok · notified (notify fired this period) · action (auto action fired this period) */
  state:         'ok' | 'notified' | 'action'
  events:        LimitEventRow[]
  /** Only legacy dollar budgets drive the ingest throttle / block. */
  legacyBudget:  boolean
}

export interface ScopeOption {
  id:   string
  name: string
}

/* ── Server page ── */
export default async function LimitsPage() {
  const { orgId, role } = await requireOrgContext()
  const admin = createAdminClient()
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
    { data: limitEvents },
    { data: routes },
    { data: blocks },
    { data: fetches },
    { data: authUsers },
  ] = await Promise.all([
    admin.from('limits').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('teams').select('id, name').eq('org_id', orgId).order('name'),
    admin.from('members').select('user_id, team_id, role').eq('org_id', orgId),
    // Raw events for the run-rate forecast of whole-scope dollar budgets only.
    selectAll<{ user_id: string | null; project_id: string | null; cost_usd: number; created_at: string }>(() => admin.from('usage_events').select('user_id, project_id, cost_usd, created_at').eq('org_id', orgId).gte('created_at', sinceTs)),
    admin.from('alert_rules').select('id, name, trigger_type, project_id, is_active, created_at').eq('org_id', orgId).in('trigger_type', ['limit_breach', 'forecast']).order('created_at'),
    admin.from('org_integrations').select(INTEG_COLS).eq('org_id', orgId).eq('is_active', true),
    admin.from('limit_events').select('limit_id, level, period_key, fired_at, details').eq('org_id', orgId).order('fired_at', { ascending: false }).limit(500),
    admin.from('model_routes').select('*').eq('org_id', orgId).eq('is_active', true).order('from_model'),
    admin.from('model_blocks').select('*').eq('org_id', orgId).eq('is_active', true).order('model'),
    admin.from('policy_fetches').select('key_id, last_fetched_at, fetch_count').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const rows = (rawLimits ?? []) as Record<string, unknown>[]
  let tz = 'UTC'
  let states: Awaited<ReturnType<typeof computeLimitStates>>['states'] = new Map()
  try {
    ({ tz, states } = await computeLimitStates(admin, orgId, rows))
  } catch (e) {
    log.error('limits page: usage failed', { org_id: orgId, err: e })
  }

  const emailOf = new Map<string, string>()
  for (const u of authUsers?.users ?? []) if (u.email) emailOf.set(u.id, u.email)
  const memberRows = (members ?? []) as { user_id: string; team_id: string | null; role: string }[]
  const alertRows = (limitAlerts ?? []) as { id: string; name: string; trigger_type: 'limit_breach' | 'forecast'; project_id: string | null; is_active: boolean }[]
  const projName = new Map(((projects ?? []) as ScopeOption[]).map(p => [p.id, p.name]))
  const teamName = new Map(((teams ?? []) as ScopeOption[]).map(t => [t.id, t.name]))
  const now = new Date()

  const evs = (events ?? []) as { user_id: string | null; project_id: string | null; cost_usd: number; created_at: string }[]
  const teamUsers = new Map<string, Set<string>>()
  for (const m of memberRows) {
    if (!m.team_id) continue
    if (!teamUsers.has(m.team_id)) teamUsers.set(m.team_id, new Set())
    teamUsers.get(m.team_id)!.add(m.user_id)
  }
  function scopedEvents(scope: LimitScope, projectId: string | null, teamId: string | null, userId: string | null) {
    if (scope === 'org')     return evs
    if (scope === 'project') return evs.filter(e => e.project_id === projectId)
    if (scope === 'team')    { const u = teamUsers.get(teamId ?? '') ?? new Set<string>(); return evs.filter(e => e.user_id && u.has(e.user_id)) }
    return userId ? evs.filter(e => e.user_id === userId) : null
  }

  const eventsBy = new Map<string, LimitEventRow[]>()
  for (const e of (limitEvents ?? []) as { limit_id: string; level: 'notify' | 'action'; period_key: string; fired_at: string; details: { pct?: number } | null }[]) {
    const list = eventsBy.get(e.limit_id) ?? []
    if (list.length < 5) list.push({ level: e.level, periodKey: e.period_key, firedAt: e.fired_at, pct: e.details?.pct ?? null })
    eventsBy.set(e.limit_id, list)
  }

  const limits: LimitRow[] = rows.map(raw => {
    const l = normalizeLimit(raw)
    const st = states.get(l.id)
    const scopeName =
      l.scope === 'org'     ? 'Entire org' :
      l.scope === 'project' ? (projName.get(l.project_id ?? '') ?? 'Unknown project') :
      l.scope === 'team'    ? (teamName.get(l.team_id ?? '') ?? 'Unknown team') :
                              (l.user_id ? (emailOf.get(l.user_id) ?? 'Member') : 'Member (no member set)')
    const legacyBudget = !l.model && l.metric === 'cost_usd'
    const used = st?.used ?? 0
    let forecast: LimitRow['forecast'] = null
    const scoped = legacyBudget ? scopedEvents(l.scope, l.project_id, l.team_id, l.user_id) : null
    if (scoped && l.amount > 0) {
      const f = forecastLimit({ budget: l.amount, spent: used, rate: runRate(dailyTotals(scoped), now), period: l.period, now })
      forecast = { ratePerDay: f.rate, projectedUsd: f.projected, projectedPct: f.projectedPct, runwayDays: f.runwayDays, exceedDate: f.exceedDate, onTrack: f.onTrack }
    }
    const evList = eventsBy.get(l.id) ?? []
    const thisPeriod = evList.filter(e => st && e.periodKey === st.window.key)
    const watching = legacyBudget ? alertRows.filter(r => ruleCoversLimit(r, { scope: l.scope, project_id: l.project_id, budget_usd: l.amount, user_id: l.user_id })) : []
    return {
      id: l.id, scope: l.scope, scopeName,
      scopeTargetId: l.project_id ?? l.team_id ?? l.user_id ?? null,
      period: l.period, budgetUsd: l.amount, spentUsd: used,
      warnAt: Number(raw.warn_at ?? 70), throttleAt: Number(raw.throttle_at ?? 90), blockAt: Number(raw.block_at ?? 100),
      isActive: l.is_active,
      hasAlert: watching.some(r => r.is_active && r.trigger_type === 'limit_breach'),
      hasForecastAlert: watching.some(r => r.is_active && r.trigger_type === 'forecast'),
      alertRules: watching.map(r => ({ id: r.id, name: r.name, triggerType: r.trigger_type, isActive: r.is_active })),
      forecast,
      model: l.model, metric: l.metric, basis: l.basis, userId: l.user_id,
      notifyAt: l.notify_at, notifyChannels: l.notify_channels,
      autoAction: l.auto_action, switchTo: l.switch_to, autoActionAt: l.auto_action_at,
      measurable: st ? st.used != null : l.scope !== 'member' || !!l.user_id,
      resetsAt: st?.window.resetsAt ?? null, periodKey: st?.window.key ?? null,
      state: thisPeriod.some(e => e.level === 'action') ? 'action' : thisPeriod.some(e => e.level === 'notify') ? 'notified' : 'ok',
      events: evList, legacyBudget,
    }
  })

  // Models seen in the last 30 days, for the model picker.
  let models: string[] = []
  try {
    const { data } = await admin.rpc('dash_breakdown', { p_org: orgId, p_from: daysAgoIn(30, tz), p_to: daysAgoIn(0, tz), p_dim: 'model', p_filters: {}, p_limit: 200 })
    models = (((data as { rows?: { key: string }[] } | null)?.rows) ?? []).map(r => r.key).filter(Boolean)
  } catch { /* picker falls back to free text */ }

  const limitName = new Map(limits.map(l => [l.id, `${l.model ?? 'All models'} · ${l.scopeName} · ${l.period}`]))
  const fetchRows = (fetches ?? []) as { key_id: string; last_fetched_at: string; fetch_count: number }[]
  const routeRows: RouteRow[] = ((routes ?? []) as Record<string, unknown>[]).map(r => {
    const at = String(r.activated_at ?? r.created_at ?? '')
    return {
      id: String(r.id), from_model: String(r.from_model), to_model: String(r.to_model),
      match: r.match === 'prefix' ? 'prefix' : 'exact', origin: r.origin === 'auto' ? 'auto' : 'manual',
      reason: (r.reason as string | null) ?? null, activated_at: at,
      limit_label: r.limit_id ? (limitName.get(String(r.limit_id)) ?? 'a deleted limit') : null,
      sdk_keys: fetchRows.filter(f => at && f.last_fetched_at >= at).length,
    }
  })
  const blockRows: BlockRow[] = ((blocks ?? []) as Record<string, unknown>[]).map(b => ({
    id: String(b.id), model: String(b.model), reason: (b.reason as string | null) ?? null, created_at: String(b.created_at),
    limit_label: b.limit_id ? (limitName.get(String(b.limit_id)) ?? 'a deleted limit') : null,
    sdk_keys: fetchRows.filter(f => f.last_fetched_at >= String(b.created_at)).length,
  }))

  const memberOptions: ScopeOption[] = memberRows.map(m => ({ id: m.user_id, name: emailOf.get(m.user_id) ?? m.user_id }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <LimitsClient
      initialLimits={limits}
      projects={((projects ?? []) as ScopeOption[]).map(p => ({ id: p.id, name: p.name }))}
      teams={((teams ?? []) as ScopeOption[]).map(t => ({ id: t.id, name: t.name }))}
      members={memberOptions}
      models={models}
      timezone={tz}
      routes={routeRows}
      blocks={blockRows}
      sdkKeys={fetchRows.length}
      orgId={orgId}
      role={role}
      channels={channelStatus(integ as unknown as IntegRow[] | null)}
    />
  )
}
