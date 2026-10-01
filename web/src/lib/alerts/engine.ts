/**
 * Alert engine — evaluates alert_rules against real usage and delivers across
 * channels. Used by the cron sweep (all orgs) and the "Test fire" button
 * (single rule). Server-only. Fail-open delivery (see notify/send).
 */
import { sendSlack, sendWebhook } from '@/lib/notify/send'
import { sendAlertEmail } from './email'
import { zonedMidnightUtc, periodWindow } from './period'
import { selectAll } from '@/lib/supabase/paginate'
import { integrationUrl } from '@/lib/integrations/config'

import { detectAnomalies, parseAnomalyScope, type AnomalyScope } from './anomaly'
import { dailyTotals, runRate, forecastLimit, type Period } from './forecast'
import { resolvePrefs, categoryFor, wantsEmail, wantsInapp, type NotifPrefs } from './prefs'

type Admin = ReturnType<typeof import('@/lib/supabase/server')['createAdminClient']>
type Window = 'daily' | 'weekly' | 'monthly'

export type TriggerType = 'threshold' | 'anomaly' | 'limit_breach' | 'member' | 'forecast'

export interface AlertRule {
  id: string; org_id: string; project_id: string | null; name: string
  trigger_type: TriggerType
  condition: string | null; threshold: number | null
  channels: { email?: boolean; slack?: boolean; webhook?: boolean; inapp?: boolean } | null
  is_active: boolean; fired_count: number | null; last_fired_at: string | null; cooldown_hours: number | null
  // anomaly only: which breakdown to baseline (migration 009). Missing → 'org'.
  anomaly_scope?: AnomalyScope | string | null
}

export interface CtxEvent {
  id?: string; correlation_id?: string | null
  project_id: string | null; user_id?: string | null; user_email?: string | null
  model?: string | null; cost_basis?: string | null
  cost_usd: number; created_at: string
}

export interface CtxLimit {
  scope: string; project_id: string | null; team_id?: string | null
  /** member limits (migration 024) */
  user_id?: string | null
  period?: Period; budget_usd: number; warn_at: number; block_at?: number
}

export interface OrgCtx {
  orgId: string
  // Raw usage_events, not usage_agg — usage_agg deliberately excludes notional
  // (CLI-agent: Claude Code/Codex/Gemini) spend so analytics totals stay a
  // real bill. Alert rules need the full picture, or a "daily spend > $X"
  // rule on a project used only via `tokenfin setup` would never fire.
  events: CtxEvent[]
  userMonth: Map<string, number>          // user_id → month-to-date $
  limits: CtxLimit[]
  projectName: Map<string, string>
  emailByUser: Map<string, string>
  adminUserIds: string[]                   // owners/admins to notify
  slackUrl: string | null
  webhookUrl: string | null
  // Optional (older callers/tests may omit): members, per-user prefs, org zone.
  members?: { user_id: string; role: string; team_id: string | null }[]
  prefsByUser?: Map<string, NotifPrefs>
  timezone?: string
}

export interface Evaluation { message: string; critical: boolean }

const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString().slice(0, 10) }
const usd = (n: number) => `$${n.toFixed(2)}`

export function inferWindow(condition: string | null): Window {
  const c = (condition || '').toLowerCase()
  // The Alerts UI writes "Daily spend > $X" — "daily" does not contain "day".
  if (c.includes('day') || c.includes('daily')) return 'daily'
  if (c.includes('week')) return 'weekly'
  return 'monthly'
}

/**
 * First instant of the current calendar window in the org time zone (local
 * midnight): today, this ISO week (Monday), this month — the same periods the
 * Limits page and the limit sweep (./period) use.
 */
export function windowStartIso(w: Window, now: Date, tz: string): string {
  return zonedMidnightUtc(periodWindow(w, now, tz).fromDay, tz).toISOString()
}

/** created_at strings from PostgREST carry "+00:00"; compare as instants. */
const since = (fromIso: string) => { const t = Date.parse(fromIso); return (e: { created_at: string }) => Date.parse(e.created_at) >= t }

function windowSpend(ctx: OrgCtx, projectId: string | null, w: Window, now: Date = new Date()): number {
  const after = since(windowStartIso(w, now, ctx.timezone || 'UTC'))
  return +ctx.events
    .filter(r => after(r) && (projectId ? r.project_id === projectId : true))
    .reduce((s, r) => s + Number(r.cost_usd), 0)
    .toFixed(4)
}

/** Events belonging to a limit's scope (org / project / team). null = unsupported scope. */
function limitEvents(ctx: OrgCtx, l: CtxLimit): CtxEvent[] | null {
  if (l.scope === 'org') return ctx.events
  if (l.scope === 'project') return ctx.events.filter(e => e.project_id === l.project_id)
  if (l.scope === 'team' && ctx.members) {
    const users = new Set(ctx.members.filter(m => m.team_id && m.team_id === l.team_id).map(m => m.user_id))
    return ctx.events.filter(e => e.user_id && users.has(e.user_id))
  }
  if (l.scope === 'member' && l.user_id) return ctx.events.filter(e => e.user_id === l.user_id)
  return null // member limit created before migration 024 (no member id)
}

function limitLabel(ctx: OrgCtx, l: CtxLimit): string {
  if (l.scope === 'project') return ctx.projectName.get(l.project_id ?? '') ?? 'project'
  if (l.scope === 'team') return 'team'
  if (l.scope === 'member') return ctx.emailByUser.get(l.user_id ?? '') ?? 'member'
  return 'org'
}

function periodSpend(evs: CtxEvent[], period: Period, tz: string, now: Date = new Date()): number {
  const after = since(windowStartIso(period, now, tz))
  return evs.filter(after).reduce((s, e) => s + Number(e.cost_usd), 0)
}

export interface LimitSnapshot {
  label: string; scope: string; project_id: string | null; period: Period
  budget: number; spent: number; pct: number; warnAt: number; blockAt: number
  forecast: ReturnType<typeof forecastLimit>
}

/** Period-to-date spend + forecast for every evaluable limit (org/project/team). */
export function limitSnapshots(ctx: OrgCtx, now: Date = new Date(), projectId: string | null = null): LimitSnapshot[] {
  const out: LimitSnapshot[] = []
  for (const l of ctx.limits) {
    const budget = Number(l.budget_usd)
    if (!budget) continue
    if (projectId && l.project_id !== projectId) continue
    const evs = limitEvents(ctx, l)
    if (!evs) continue
    const period = l.period ?? 'monthly'
    const spent = periodSpend(evs, period, ctx.timezone || 'UTC', now)
    out.push({
      label: limitLabel(ctx, l), scope: l.scope, project_id: l.project_id, period, budget,
      spent: +spent.toFixed(4), pct: (spent / budget) * 100,
      warnAt: l.warn_at ?? 80, blockAt: l.block_at ?? 100,
      forecast: forecastLimit({ budget, spent, rate: runRate(dailyTotals(evs), now), period, now }),
    })
  }
  return out
}

// Returns a human message if the rule should fire now, else null.
export function evaluateRule(rule: AlertRule, ctx: OrgCtx): string | null {
  return evaluateRuleDetailed(rule, ctx)?.message ?? null
}

/** Like evaluateRule, plus whether the firing is critical (a limit at its block level). */
export function evaluateRuleDetailed(rule: AlertRule, ctx: OrgCtx, now: Date = new Date()): Evaluation | null {
  const scopeLabel = rule.project_id ? (ctx.projectName.get(rule.project_id) ?? 'project') : 'Your org'
  const ok = (message: string, critical = false): Evaluation => ({ message, critical })

  if (rule.trigger_type === 'threshold') {
    if (rule.threshold == null) return null
    const w = inferWindow(rule.condition)
    const spent = windowSpend(ctx, rule.project_id, w, now)
    return spent >= rule.threshold
      ? ok(`${scopeLabel} ${w} spend has reached $${spent.toFixed(2)}, crossing your $${rule.threshold} alert.`)
      : null
  }

  if (rule.trigger_type === 'anomaly') {
    // Robust baseline (median + MAD over the previous 28 days) per scope key.
    const scope = parseAnomalyScope(rule.anomaly_scope)
    const filter = rule.project_id ? (e: { project_id?: string | null }) => e.project_id === rule.project_id : undefined
    const hits = detectAnomalies(ctx.events, scope, now.toISOString().slice(0, 10), filter).filter(r => r.flagged)
    if (hits.length === 0) return null
    const label = (key: string) =>
      scope === 'org'     ? scopeLabel :
      scope === 'project' ? `Project ${ctx.projectName.get(key) ?? key}` :
      scope === 'member'  ? `Member ${ctx.emailByUser.get(key) ?? key}` :
                            `Model ${key}`
    const top = hits[0]
    const more = hits.length > 1 ? ` (+${hits.length - 1} more ${scope === 'member' ? 'members' : scope + 's'} unusual today)` : ''
    return ok(`${label(top.key)} spend today (${usd(top.today)}) is far above its usual ${usd(top.median)}/day ` +
      `(robust z ${top.z.toFixed(1)} over ${top.dataDays} active days) — possible runaway cost.${more}`)
  }

  if (rule.trigger_type === 'limit_breach') {
    let worst: { label: string; pct: number; spent: number; budget: number; period: Period; critical: boolean } | null = null
    for (const l of ctx.limits) {
      if (!l.budget_usd) continue
      if (rule.project_id && l.project_id !== rule.project_id) continue
      const evs = limitEvents(ctx, l)
      if (!evs) continue
      const period = l.period ?? 'monthly'
      const spent = periodSpend(evs, period, ctx.timezone || 'UTC', now)
      const pct = (spent / l.budget_usd) * 100
      // A percent threshold on the rule (Limits → Add alert) overrides warn_at.
      const trigger = rule.threshold != null && rule.threshold > 0 && rule.threshold <= 1000 ? rule.threshold : (l.warn_at ?? 80)
      if (pct >= trigger && (!worst || pct > worst.pct)) {
        worst = { label: limitLabel(ctx, l), pct, spent, budget: l.budget_usd, period, critical: pct >= (l.block_at ?? 100) }
      }
    }
    return worst
      ? ok(`${worst.critical ? 'Budget BLOCK' : 'Budget alert'}: ${worst.label} is at ${worst.pct.toFixed(0)}% of its $${worst.budget} ${worst.period} limit ($${worst.spent.toFixed(2)} spent).`, worst.critical)
      : null
  }

  if (rule.trigger_type === 'forecast') {
    // Warn when the current run-rate projects past a limit's budget this period.
    const worst = limitSnapshots(ctx, now, rule.project_id)
      .filter(x => !x.forecast.onTrack)
      .sort((a, b) => b.forecast.projectedPct - a.forecast.projectedPct)[0]
    if (!worst) return null
    const f = worst.forecast
    const unit = worst.period === 'daily' ? 'day' : worst.period === 'weekly' ? 'week' : 'month'
    return ok(`Forecast: ${worst.label} is projected to spend ${usd(f.projected)} this ${unit} ` +
      `(${f.projectedPct.toFixed(0)}% of its $${worst.budget} budget)` +
      (f.runwayDays === 0 ? ' — it is already over budget.' : `${f.exceedDate ? ` and to run out on ${f.exceedDate}` : ''} at the current run-rate.`))
  }

  if (rule.trigger_type === 'member') {
    if (rule.threshold == null) return null
    let top: { email: string; spent: number } | null = null
    for (const [uid, spent] of Array.from(ctx.userMonth.entries())) {
      if (spent >= rule.threshold && (!top || spent > top.spent)) top = { email: ctx.emailByUser.get(uid) ?? 'a member', spent }
    }
    return top
      ? ok(`${top.email} has spent $${top.spent.toFixed(2)} this month, crossing your $${rule.threshold} per-member alert.`)
      : null
  }

  return null
}

export function inCooldown(rule: AlertRule): boolean {
  if (!rule.last_fired_at) return false
  const hours = rule.cooldown_hours ?? 4
  return Date.now() - new Date(rule.last_fired_at).getTime() < hours * 3600_000
}

/**
 * Atomically claim a firing slot for `rule`: bumps last_fired_at/fired_count ONLY
 * if the rule is not in cooldown *in the database right now*. Postgres re-checks
 * the WHERE clause under the row lock, so of two concurrent sweeps exactly one
 * gets a row back. Returns true if this caller won the claim and should deliver.
 * (fired_count is derived from the snapshot the caller read; the cooldown guard
 * is what prevents double delivery.)
 */
export async function claimFire(admin: Admin, rule: AlertRule): Promise<boolean> {
  const hours  = rule.cooldown_hours ?? 4
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data, error } = await admin
    .from('alert_rules')
    .update({ last_fired_at: new Date().toISOString(), fired_count: (rule.fired_count ?? 0) + 1 })
    .eq('id', rule.id)
    .or(`last_fired_at.is.null,last_fired_at.lt."${cutoff}"`)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

// Deliver a fired alert across the rule's channels. Fail-open.
// Non-test deliveries must hold a claim (claimFire); if the caller hasn't
// claimed already, we claim here and skip delivery when the claim is lost.
//
// Per-user preferences (Settings → Notifications) filter the personal channels:
// email honours the budget/anomaly opt-out and quiet hours; in-app honours the
// anomaly in-app toggle. Critical firings (a limit at its block level) bypass
// both. Slack/webhook are org channels chosen on the rule itself. Test fires
// ignore preferences so admins can always verify a channel.
export async function deliverAlert(admin: Admin, rule: AlertRule, ctx: OrgCtx, message: string, opts: { test?: boolean; claimed?: boolean; critical?: boolean; now?: Date } = {}) {
  if (!opts.test && !opts.claimed) {
    const won = await claimFire(admin, rule)
    if (!won) return { skipped: 'cooldown' } as Record<string, unknown>
  }
  const ch = rule.channels ?? {}
  const title = (opts.test ? '[Test] ' : '') + rule.name
  const results: Record<string, unknown> = {}

  const cat = categoryFor(rule.trigger_type)
  const critical = !!opts.critical
  const now = opts.now ?? new Date()
  const prefsOf = (uid: string) => ctx.prefsByUser?.get(uid) ?? resolvePrefs(null)
  const tz = ctx.timezone || 'UTC'

  if (ch.inapp !== false) {
    const uids = opts.test ? ctx.adminUserIds : ctx.adminUserIds.filter(uid => wantsInapp(prefsOf(uid), cat, critical))
    const type = critical ? 'alert_critical' : 'alert'
    const rows = uids.map(uid => ({ org_id: ctx.orgId, user_id: uid, type, title, body: message, is_read: false }))
    if (rows.length) { const { error } = await admin.from('notifications').insert(rows); results.inapp = error ? error.message : rows.length }
    else results.inapp = { skipped: 'preferences' }
  }
  if (ch.email) {
    const uids = opts.test ? ctx.adminUserIds : ctx.adminUserIds.filter(uid => wantsEmail(prefsOf(uid), cat, critical, now, tz))
    const emails = uids.map(uid => ctx.emailByUser.get(uid)).filter(Boolean) as string[]
    results.email = emails.length
      ? await sendAlertEmail(emails, `TokenFin ${critical ? 'CRITICAL ' : ''}alert: ${rule.name}`, message)
      : { sent: false, reason: 'all recipients opted out or in quiet hours' }
  }
  if (ch.slack) results.slack = await sendSlack(ctx.slackUrl, `:rotating_light: *${title}*\n${message}`)
  if (ch.webhook) results.webhook = await sendWebhook(ctx.webhookUrl, { rule: rule.name, org_id: ctx.orgId, message, test: !!opts.test, at: new Date().toISOString() })

  return results
}

// Fetch everything needed to evaluate/deliver for one org.
export async function buildOrgCtx(admin: Admin, orgId: string, emailByUser: Map<string, string>): Promise<OrgCtx> {
  const since = new Date(Date.now() - 31 * 86400_000).toISOString().slice(0, 10)
  const sinceTs = since + 'T00:00:00Z'
  const [{ data: events }, { data: members }, { data: limits }, { data: projects }, { data: integ }] = await Promise.all([
    selectAll(() => admin.from('usage_events').select('id, correlation_id, user_id, user_email, project_id, model, cost_basis, cost_usd, created_at').eq('org_id', orgId).gte('created_at', sinceTs)),
    admin.from('members').select('user_id, role, team_id').eq('org_id', orgId),
    // select('*'): user_id arrives with migration 024. Only legacy dollar
    // budgets (budget_usd > 0: no model filter, cost metric) are evaluated
    // here; per-model / token / request limits run in ./limits-runner.
    admin.from('limits').select('*').eq('org_id', orgId).eq('is_active', true).gt('budget_usd', 0),
    admin.from('projects').select('id, name').eq('org_id', orgId),
    admin.from('org_integrations').select('provider, config, detail, status').eq('org_id', orgId).eq('is_active', true),
  ])

  const evs = (events ?? []) as CtxEvent[]
  const memberRows = (members ?? []) as { user_id: string; role: string; team_id: string | null }[]

  // Per-user notification preferences + the workspace time zone (quiet-hours
  // fallback when a user never saved a zone). select('*') on organizations so
  // a DB without the timezone column (migration 010) still works.
  const [{ data: prefRows }, { data: org }] = await Promise.all([
    memberRows.length
      ? admin.from('user_preferences').select('user_id, settings').in('user_id', memberRows.map(m => m.user_id))
      : Promise.resolve({ data: [] as { user_id: string; settings: unknown }[] }),
    admin.from('organizations').select('*').eq('id', orgId).maybeSingle(),
  ])
  const prefsByUser = new Map<string, NotifPrefs>()
  for (const m of memberRows) prefsByUser.set(m.user_id, resolvePrefs(null))
  for (const r of (prefRows ?? []) as { user_id: string; settings: unknown }[]) prefsByUser.set(r.user_id, resolvePrefs(r.settings))
  const orgTz = (org as { timezone?: string } | null)?.timezone || 'UTC'

  const mStart = monthStart() + 'T00:00:00Z'
  const userMonth = new Map<string, number>()
  for (const e of evs) {
    if (!e.user_id || e.created_at < mStart) continue
    userMonth.set(e.user_id, (userMonth.get(e.user_id) ?? 0) + Number(e.cost_usd))
  }

  const adminUserIds = ((members ?? []) as { user_id: string; role: string }[])
    .filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.user_id)
  // Fall back to all members if no owners/admins resolved.
  const allIds = ((members ?? []) as { user_id: string }[]).map(m => m.user_id)

  const projectName = new Map<string, string>()
  for (const p of (projects ?? []) as { id: string; name: string }[]) projectName.set(p.id, p.name)

  // Decrypts sealed config (legacy plaintext rows still read). Only the config
  // URL is used, never `detail`; it is re-validated against SSRF rules at send time.
  const findUrl = (provider: string) =>
    integrationUrl(integ as { provider: string; config: Record<string, unknown> | null }[] | null, provider)

  return {
    orgId,
    events: evs,
    userMonth,
    limits: (limits ?? []) as OrgCtx['limits'],
    projectName,
    emailByUser,
    adminUserIds: adminUserIds.length ? adminUserIds : allIds,
    slackUrl: findUrl('slack'),
    webhookUrl: findUrl('webhook'),
    members: memberRows,
    prefsByUser,
    timezone: orgTz,
  }
}
