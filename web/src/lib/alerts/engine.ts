/**
 * Alert engine — evaluates alert_rules against real usage and delivers across
 * channels. Used by the cron sweep (all orgs) and the "Test fire" button
 * (single rule). Server-only. Fail-open delivery (see notify/send).
 */
import { sendEmail, sendSlack, sendWebhook } from '@/lib/notify/send'

type Admin = ReturnType<typeof import('@/lib/supabase/server')['createAdminClient']>
type Window = 'daily' | 'weekly' | 'monthly'

export interface AlertRule {
  id: string; org_id: string; project_id: string | null; name: string
  trigger_type: 'threshold' | 'anomaly' | 'limit_breach' | 'member'
  condition: string | null; threshold: number | null
  channels: { email?: boolean; slack?: boolean; webhook?: boolean; inapp?: boolean } | null
  is_active: boolean; fired_count: number | null; last_fired_at: string | null; cooldown_hours: number | null
}

export interface OrgCtx {
  orgId: string
  agg: { project_id: string | null; bucket: string; cost_usd: number }[]
  userMonth: Map<string, number>          // user_id → month-to-date $
  limits: { scope: string; project_id: string | null; budget_usd: number; warn_at: number }[]
  projectName: Map<string, string>
  emailByUser: Map<string, string>
  adminUserIds: string[]                   // owners/admins to notify
  slackUrl: string | null
  webhookUrl: string | null
}

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString().slice(0, 10) }
const weekAgo = () => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)

export function inferWindow(condition: string | null): Window {
  const c = (condition || '').toLowerCase()
  if (c.includes('day')) return 'daily'
  if (c.includes('week')) return 'weekly'
  return 'monthly'
}

function windowSpend(ctx: OrgCtx, projectId: string | null, w: Window): number {
  const from = w === 'daily' ? today() : w === 'weekly' ? weekAgo() : monthStart()
  return +ctx.agg
    .filter(r => r.bucket >= from && (projectId ? r.project_id === projectId : true))
    .reduce((s, r) => s + Number(r.cost_usd), 0)
    .toFixed(4)
}

// Returns a human message if the rule should fire now, else null.
export function evaluateRule(rule: AlertRule, ctx: OrgCtx): string | null {
  const scopeLabel = rule.project_id ? (ctx.projectName.get(rule.project_id) ?? 'project') : 'Your org'

  if (rule.trigger_type === 'threshold') {
    if (rule.threshold == null) return null
    const w = inferWindow(rule.condition)
    const spent = windowSpend(ctx, rule.project_id, w)
    return spent >= rule.threshold
      ? `${scopeLabel} ${w} spend has reached $${spent.toFixed(2)}, crossing your $${rule.threshold} alert.`
      : null
  }

  if (rule.trigger_type === 'anomaly') {
    const todaySpend = windowSpend(ctx, rule.project_id, 'daily')
    // Average of the 7 days before today.
    const from = weekAgo(), to = today()
    const days = new Map<string, number>()
    for (const r of ctx.agg) {
      if (r.bucket >= from && r.bucket < to && (!rule.project_id || r.project_id === rule.project_id))
        days.set(r.bucket, (days.get(r.bucket) ?? 0) + Number(r.cost_usd))
    }
    const vals = Array.from(days.values())
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    return (todaySpend > 1 && avg > 0 && todaySpend > 3 * avg)
      ? `${scopeLabel} spend today ($${todaySpend.toFixed(2)}) is ${(todaySpend / avg).toFixed(1)}× the 7-day average — possible runaway cost.`
      : null
  }

  if (rule.trigger_type === 'limit_breach') {
    let worst: { label: string; pct: number; spent: number; budget: number } | null = null
    for (const l of ctx.limits) {
      if (l.scope !== 'org' && l.scope !== 'project') continue // team/member limits: skip here
      if (!l.budget_usd) continue
      const spent = windowSpend(ctx, l.scope === 'project' ? l.project_id : null, 'monthly')
      const pct = (spent / l.budget_usd) * 100
      if (pct >= (l.warn_at ?? 80) && (!worst || pct > worst.pct)) {
        worst = { label: l.scope === 'project' ? (ctx.projectName.get(l.project_id ?? '') ?? 'project') : 'org', pct, spent, budget: l.budget_usd }
      }
    }
    return worst
      ? `Budget alert: ${worst.label} is at ${worst.pct.toFixed(0)}% of its $${worst.budget} monthly limit ($${worst.spent.toFixed(2)} spent).`
      : null
  }

  if (rule.trigger_type === 'member') {
    if (rule.threshold == null) return null
    let top: { email: string; spent: number } | null = null
    for (const [uid, spent] of Array.from(ctx.userMonth.entries())) {
      if (spent >= rule.threshold && (!top || spent > top.spent)) top = { email: ctx.emailByUser.get(uid) ?? 'a member', spent }
    }
    return top
      ? `${top.email} has spent $${top.spent.toFixed(2)} this month, crossing your $${rule.threshold} per-member alert.`
      : null
  }

  return null
}

export function inCooldown(rule: AlertRule): boolean {
  if (!rule.last_fired_at) return false
  const hours = rule.cooldown_hours ?? 4
  return Date.now() - new Date(rule.last_fired_at).getTime() < hours * 3600_000
}

// Deliver a fired alert across the rule's channels + bump counters. Fail-open.
export async function deliverAlert(admin: Admin, rule: AlertRule, ctx: OrgCtx, message: string, opts: { test?: boolean } = {}) {
  const ch = rule.channels ?? {}
  const title = (opts.test ? '[Test] ' : '') + rule.name
  const results: Record<string, unknown> = {}

  if (ch.inapp !== false) {
    const rows = ctx.adminUserIds.map(uid => ({ org_id: ctx.orgId, user_id: uid, type: 'alert', title, body: message, is_read: false }))
    if (rows.length) { const { error } = await admin.from('notifications').insert(rows); results.inapp = error ? error.message : rows.length }
  }
  if (ch.email) {
    const emails = ctx.adminUserIds.map(uid => ctx.emailByUser.get(uid)).filter(Boolean) as string[]
    results.email = await sendEmail(emails, `TokenFin alert: ${rule.name}`, message)
  }
  if (ch.slack) results.slack = await sendSlack(ctx.slackUrl, `:rotating_light: *${title}*\n${message}`)
  if (ch.webhook) results.webhook = await sendWebhook(ctx.webhookUrl, { rule: rule.name, org_id: ctx.orgId, message, test: !!opts.test, at: new Date().toISOString() })

  if (!opts.test) {
    await admin.from('alert_rules').update({ fired_count: (rule.fired_count ?? 0) + 1, last_fired_at: new Date().toISOString() }).eq('id', rule.id)
  }
  return results
}

// Fetch everything needed to evaluate/deliver for one org.
export async function buildOrgCtx(admin: Admin, orgId: string, emailByUser: Map<string, string>): Promise<OrgCtx> {
  const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10)
  const sinceTs = since + 'T00:00:00Z'
  const [{ data: agg }, { data: events }, { data: members }, { data: limits }, { data: projects }, { data: integ }] = await Promise.all([
    admin.from('usage_agg').select('project_id, bucket, cost_usd').eq('org_id', orgId).gte('bucket', since),
    admin.from('usage_events').select('user_id, cost_usd, created_at').eq('org_id', orgId).gte('created_at', sinceTs),
    admin.from('members').select('user_id, role').eq('org_id', orgId),
    admin.from('limits').select('scope, project_id, budget_usd, warn_at').eq('org_id', orgId).eq('is_active', true),
    admin.from('projects').select('id, name').eq('org_id', orgId),
    admin.from('org_integrations').select('provider, config, detail, status').eq('org_id', orgId),
  ])

  const mStart = monthStart() + 'T00:00:00Z'
  const userMonth = new Map<string, number>()
  for (const e of (events ?? []) as { user_id: string | null; cost_usd: number; created_at: string }[]) {
    if (!e.user_id || e.created_at < mStart) continue
    userMonth.set(e.user_id, (userMonth.get(e.user_id) ?? 0) + Number(e.cost_usd))
  }

  const adminUserIds = ((members ?? []) as { user_id: string; role: string }[])
    .filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.user_id)
  // Fall back to all members if no owners/admins resolved.
  const allIds = ((members ?? []) as { user_id: string }[]).map(m => m.user_id)

  const projectName = new Map<string, string>()
  for (const p of (projects ?? []) as { id: string; name: string }[]) projectName.set(p.id, p.name)

  const findUrl = (provider: string) => {
    const row = ((integ ?? []) as { provider: string; config: Record<string, unknown> | null; detail: string | null }[])
      .find(i => i.provider === provider)
    if (!row) return null
    const c = row.config ?? {}
    return (c.webhook_url as string) || (c.url as string) || (c.endpoint as string) || row.detail || null
  }

  return {
    orgId,
    agg: (agg ?? []) as OrgCtx['agg'],
    userMonth,
    limits: (limits ?? []) as OrgCtx['limits'],
    projectName,
    emailByUser,
    adminUserIds: adminUserIds.length ? adminUserIds : allIds,
    slackUrl: findUrl('slack'),
    webhookUrl: findUrl('webhook'),
  }
}
