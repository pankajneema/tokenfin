import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getOrgRole }         from '@/lib/api/auth'
import { AlertsClient }       from './_client'
import type { AlertRuleRow, AlertHistoryRow, TriggerType } from './_types'

export { type TriggerType, type AlertRuleRow, type AlertHistoryRow } from './_types'

export const metadata = { title: 'Alerts — TokenFin' }

/* ── Server page ── */
export default async function AlertsPage() {
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
  const email = user.email ?? ''
  const role  = await getOrgRole(user.id, orgId)

  const [
    { data: rawRules },
    { data: rawNotifs },
  ] = await Promise.all([
    admin
      .from('alert_rules')
      .select('id, name, trigger_type, condition, scope, channels, is_active, fired_count, last_fired_at, cooldown_hours, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    admin
      .from('notifications')
      .select('id, title, body, type, is_read, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const rules: AlertRuleRow[] = (rawRules ?? []).map(r => ({
    id:            r.id,
    name:          r.name,
    triggerType:   r.trigger_type as TriggerType,
    condition:     r.condition,
    scope:         r.scope,
    channels:      (r.channels as { email: boolean; slack: boolean; webhook: boolean; inapp: boolean }) ?? { email: true, slack: false, webhook: false, inapp: true },
    isActive:      r.is_active,
    firedCount:    r.fired_count ?? 0,
    lastFiredAt:   r.last_fired_at ?? null,
    cooldownHours: r.cooldown_hours ?? 4,
    createdAt:     r.created_at,
  }))

  const history: AlertHistoryRow[] = (rawNotifs ?? []).map(n => ({
    id:        n.id,
    title:     n.title,
    body:      n.body ?? null,
    type:      n.type,
    isRead:    n.is_read,
    createdAt: n.created_at,
  }))

  return (
    <AlertsClient
      initialRules={rules}
      initialHistory={history}
      orgId={orgId}
      userEmail={email}
      role={role}
    />
  )
}
