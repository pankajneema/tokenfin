import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { channelStatus, INTEG_COLS, type IntegRow } from './_channels'
import { AlertsClient }       from './_client'
import { ruleCoversLimit }    from './_budget-link'
import type { AlertRuleRow, AlertHistoryRow, TriggerType, AnomalyScope, ProjectOption } from './_types'

export { type TriggerType, type AlertRuleRow, type AlertHistoryRow } from './_types'

export const metadata = { title: 'Alerts — TokenFin' }

/* ── Server page ── */
export default async function AlertsPage() {
  const { user, orgId, role } = await requireOrgContext()
  const admin = createAdminClient()

  const RULE_COLS = 'id, name, trigger_type, condition, scope, threshold, channels, is_active, fired_count, last_fired_at, cooldown_hours, created_at, project_id'
  const loadRules = (cols: string) => admin.from('alert_rules').select(cols).eq('org_id', orgId).order('created_at', { ascending: false })
  const [
    rulesRes,
    { data: rawNotifs },
    { data: integ },
    { data: rawLimits },
    { data: projects },
  ] = await Promise.all([
    // anomaly_scope needs migration 009 — fall back so the page still renders.
    loadRules(RULE_COLS + ', anomaly_scope').then(r => r.error ? loadRules(RULE_COLS) : r),
    admin
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),
    // Same rows the alert engine reads to deliver (lib/alerts/engine buildOrgCtx).
    admin.from('org_integrations').select(INTEG_COLS).eq('org_id', orgId).eq('is_active', true),
    admin.from('limits').select('id, scope, project_id, team_id, period, budget_usd, projects(name), teams(name)').eq('org_id', orgId),
    admin.from('projects').select('id, name').eq('org_id', orgId).order('name').limit(1000),
  ])

  type RawLimit = { id: string; scope: string; project_id: string | null; team_id: string | null; period: string; budget_usd: number | null; projects: unknown; teams: unknown }
  const limits = ((rawLimits ?? []) as RawLimit[]).map(l => {
    const projName = (l.projects as { name?: string } | null)?.name
    const teamName = (l.teams as { name?: string } | null)?.name
    const who = l.scope === 'org' ? 'Entire org' : l.scope === 'project' ? (projName ?? 'Project') : l.scope === 'team' ? (teamName ?? 'Team') : 'Member'
    return { ...l, label: `${who} · $${Number(l.budget_usd ?? 0).toLocaleString('en-US')}/${l.period === 'daily' ? 'day' : l.period === 'weekly' ? 'week' : 'month'}` }
  })

  type RawRule = {
    id: string; name: string; trigger_type: string; condition: string; scope: string; threshold: number | null
    channels: unknown; is_active: boolean; fired_count: number | null; last_fired_at: string | null
    cooldown_hours: number | null; created_at: string; anomaly_scope?: string | null; project_id: string | null
  }
  const rawRules = (rulesRes.data ?? []) as unknown as RawRule[]
  const rules: AlertRuleRow[] = rawRules.map(r => ({
    id:            r.id,
    name:          r.name,
    triggerType:   r.trigger_type as TriggerType,
    condition:     r.condition,
    scope:         r.scope,
    threshold:     r.threshold == null ? null : Number(r.threshold),
    anomalyScope:  (r.anomaly_scope ?? 'org') as AnomalyScope,
    channels:      (r.channels as { email: boolean; slack: boolean; webhook: boolean; inapp: boolean }) ?? { email: true, slack: false, webhook: false, inapp: true },
    isActive:      r.is_active,
    firedCount:    r.fired_count ?? 0,
    lastFiredAt:   r.last_fired_at ?? null,
    cooldownHours: r.cooldown_hours ?? 4,
    createdAt:     r.created_at,
    projectId:     r.project_id ?? null,
    budgets:       limits.filter(l => ruleCoversLimit(r, l)).map(l => ({ id: l.id, label: l.label })),
  }))

  const channels = channelStatus(integ as unknown as IntegRow[] | null)

  // Exclude internal system records (billing invoices, sales inquiries) — same
  // filter as the dashboard topbar bell (see (dashboard)/layout.tsx).
  const history: AlertHistoryRow[] = (rawNotifs ?? [])
    .filter(n => n.type !== 'invoice' && n.type !== 'sales_inquiry')
    .map(n => ({ id: n.id, title: n.title, body: n.body ?? null, type: n.type, isRead: n.is_read, createdAt: n.created_at }))

  return (
    <AlertsClient
      initialRules={rules}
      initialHistory={history}
      orgId={orgId}
      userEmail={user.email ?? ''}
      role={role}
      channels={channels}
      projects={(projects ?? []) as ProjectOption[]}
    />
  )
}
