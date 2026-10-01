/**
 * Limit sweep (migration 024): evaluates every active limit of an org against
 * the org-local rollups, then — once per period per level (limit_events) —
 *   notify  (notify_at, default 90%): in-app for owners/admins (+ the member of
 *           a member limit), email per notify_channels + personal preferences
 *   action  (auto_action_at, default 100%, only when auto_action is set):
 *           switch_model → activate model route model → switch_to, queue the
 *                          model change for affected CLI-agent devices
 *           block_sdk    → add a model block (SDKs with enforcePolicy refuse it)
 *           and notify everyone.
 * Everything is audited. Runs from the alerts cron and (throttled) after ingest.
 * Server-only; never throws out of evaluateLimitsAfterIngest.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { audit } from '@/lib/audit'
import { getOrgTimezone } from '@/lib/org-timezone'
import { TtlCache } from '@/lib/cache'
import { log } from '@/lib/log'
import { invalidatePolicy } from '@/lib/policy'
import { sendAlertEmail } from './email'
import { resolvePrefs, wantsEmail, wantsInapp, type NotifPrefs } from './prefs'
import { requestAgentModelSwitch, type AgentSwitchResult } from './agent-switch'
import {
  normalizeLimit, evaluateLimit, earliestDay, rpcPrefixes, userKeysOf, formatAmount,
  METRIC_NOUN, scopePhrase, type LimitDef, type LimitState, type UsageRow, type ScopeResolver,
} from './model-limits'

type Admin = SupabaseClient

export interface LimitRunResult {
  limits: number
  notified: number
  actions: number
  fired: { limit_id: string; level: 'notify' | 'action'; pct: number }[]
}

const emailCache = new TtlCache<string, string | null>(5_000, 10 * 60_000)

async function emailOf(admin: Admin, userId: string): Promise<string | null> {
  return emailCache.getOrLoad(userId, async () => {
    try { const { data } = await admin.auth.admin.getUserById(userId); return data?.user?.email ?? null } catch { return null }
  })
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://tokenfin.curiousdevs.com').replace(/\/+$/, '')

function fmtReset(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) + ` (${tz})`
  } catch { return iso }
}

/** Subject + body for a limit message. Pure (exported for tests). */
export function limitMessage(s: LimitState, names: { project?: string | null; team?: string | null; member?: string | null }, tz: string,
  kind: 'notify' | 'switch_model' | 'block_sdk'): { subject: string; title: string; text: string; html: string } {
  const l = s.limit
  const pct = Math.floor(s.pct ?? 0)
  const what = l.model ? `${l.model} ${l.metric === 'cost_usd' ? 'spend' : 'usage'}` : (l.metric === 'cost_usd' ? 'Spend' : 'Usage')
  const periodNoun = l.period === 'daily' ? "today's" : l.period === 'weekly' ? "this week's" : "this month's"
  const who = scopePhrase(l, names)
  const basis = l.basis === 'all' ? '' : l.basis === 'metered' ? ' (metered API usage only)' : ' (subscription / notional usage only)'
  const usedTxt = `${formatAmount(l.metric, s.used ?? 0)} of ${formatAmount(l.metric, l.amount)}`
  const link = `${appUrl()}/dashboard/limits#limit-${l.id}`
  const reset = fmtReset(s.window.resetsAt, tz)
  let title: string, action = ''
  if (kind === 'notify') {
    title = `${what} at ${pct}% of ${periodNoun} limit`
  } else if (kind === 'switch_model') {
    title = `${l.model} auto-switched to ${l.switch_to} (${pct}% of ${periodNoun} limit)`
    action = `\n\nAutomatic action: requests for ${l.model} are now routed to ${l.switch_to} by apps using the TokenFin SDK wrappers, and CLI agents on affected machines get a pending model change. The route stays on until an admin turns it off on the Limits page.`
  } else {
    title = `${l.model} blocked for SDK apps (${pct}% of ${periodNoun} limit)`
    action = `\n\nAutomatic action: apps using the TokenFin SDK with enforcePolicy now refuse ${l.model} calls. An admin can lift the block on the Limits page.`
  }
  const text = `${what} for ${who} is at ${pct}% of ${periodNoun} limit${basis}: ${usedTxt} ${METRIC_NOUN[l.metric] === 'spend' ? 'spent' : 'used'}.\n` +
    `The limit resets ${reset}.${action}\n\nView it: ${link}`
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">` +
    `<p><strong>${esc(what)}</strong> for ${esc(who)} is at <strong>${pct}%</strong> of ${esc(periodNoun)} limit${esc(basis)}: ${esc(usedTxt)}.</p>` +
    `<div style="background:#eee;border-radius:4px;height:8px;width:320px"><div style="background:${pct >= 100 ? '#dc2626' : '#d97706'};height:8px;border-radius:4px;width:${Math.min(pct, 100) * 3.2}px"></div></div>` +
    `<p>The limit resets ${esc(reset)}.</p>${action ? `<p>${esc(action.trim())}</p>` : ''}` +
    `<p><a href="${link}">Open the limit in TokenFin</a></p></div>`
  return { subject: `TokenFin: ${title}`, title, text, html }
}

async function claim(admin: Admin, s: LimitState, level: 'notify' | 'action', details: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin.from('limit_events')
    .upsert({ org_id: s.limit.org_id, limit_id: s.limit.id, period_key: s.window.key, level, details },
      { onConflict: 'limit_id,period_key,level', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(`limit_events: ${error.message}`)
  return (data ?? []).length > 0
}

interface OrgInfo {
  tz: string
  members: { user_id: string; role: string; team_id: string | null }[]
  admins: string[]
  prefs: Map<string, NotifPrefs>
  projectName: Map<string, string>
  teamName: Map<string, string>
  emails: Map<string, string | null>
}

async function loadOrg(admin: Admin, orgId: string, limits: LimitDef[]): Promise<OrgInfo> {
  const [tz, { data: members }, { data: projects }, { data: teams }] = await Promise.all([
    getOrgTimezone(orgId),
    admin.from('members').select('user_id, role, team_id').eq('org_id', orgId),
    admin.from('projects').select('id, name').eq('org_id', orgId),
    admin.from('teams').select('id, name').eq('org_id', orgId),
  ])
  const ms = (members ?? []) as OrgInfo['members']
  const admins = ms.filter(m => m.role === 'owner' || m.role === 'admin').map(m => m.user_id)
  // Emails for recipients and for team / member usage keys only.
  const need = new Set<string>(admins)
  for (const l of limits) {
    if (l.user_id) need.add(l.user_id)
    if (l.scope === 'team' && l.team_id) for (const m of ms) if (m.team_id === l.team_id) need.add(m.user_id)
  }
  const emails = new Map<string, string | null>()
  await Promise.all(Array.from(need).map(async u => emails.set(u, await emailOf(admin, u))))
  const { data: prefRows } = need.size
    ? await admin.from('user_preferences').select('user_id, settings').in('user_id', Array.from(need))
    : { data: [] as { user_id: string; settings: unknown }[] }
  const prefs = new Map<string, NotifPrefs>()
  for (const r of (prefRows ?? []) as { user_id: string; settings: unknown }[]) prefs.set(r.user_id, resolvePrefs(r.settings))
  return {
    tz, members: ms, admins, prefs, emails,
    projectName: new Map(((projects ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name])),
    teamName: new Map(((teams ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name])),
  }
}

function resolver(o: OrgInfo): ScopeResolver {
  const keys = (uid: string) => userKeysOf(uid, o.emails.get(uid))
  return {
    teamKeys: (teamId) => new Set(o.members.filter(m => m.team_id === teamId).flatMap(m => keys(m.user_id))),
    memberKeys: (uid) => new Set(keys(uid)),
  }
}

async function deliver(admin: Admin, o: OrgInfo, s: LimitState, kind: 'notify' | 'switch_model' | 'block_sdk', now: Date) {
  const l = s.limit
  const names = { project: o.projectName.get(l.project_id ?? ''), team: o.teamName.get(l.team_id ?? ''), member: l.user_id ? o.emails.get(l.user_id) : null }
  const msg = limitMessage(s, names, o.tz, kind)
  const critical = kind !== 'notify'
  // Notify: owners/admins + the member it concerns. Actions: everyone in-app.
  const base = new Set<string>(o.admins)
  if (l.user_id) base.add(l.user_id)
  const inappTo = critical ? new Set([...Array.from(base), ...o.members.map(m => m.user_id)]) : base
  const prefsOf = (u: string) => o.prefs.get(u) ?? resolvePrefs(null)
  const result: Record<string, unknown> = {}
  if (l.notify_channels.inapp || critical) {
    const rows = Array.from(inappTo).filter(u => wantsInapp(prefsOf(u), 'budget', critical))
      .map(u => ({ org_id: l.org_id, user_id: u, type: critical ? 'alert' : 'warning', title: msg.title, body: msg.text.split('\n\nView it:')[0], is_read: false }))
    if (rows.length) { const { error } = await admin.from('notifications').insert(rows); result.inapp = error ? error.message : rows.length }
  }
  if (l.notify_channels.email) {
    const to = Array.from(base).filter(u => wantsEmail(prefsOf(u), 'budget', critical, now, o.tz))
      .map(u => o.emails.get(u)).filter(Boolean) as string[]
    result.email = to.length ? await sendAlertEmail(to, msg.subject, msg.text, msg.html) : { sent: false, reason: 'all recipients opted out or in quiet hours' }
  }
  return { ...result, title: msg.title }
}

async function applyAction(admin: Admin, o: OrgInfo, s: LimitState, now: Date): Promise<Record<string, unknown>> {
  const l = s.limit
  const reason = `Limit ${l.model} ${l.period} ${formatAmount(l.metric, l.amount)} reached ${Math.floor(s.pct ?? 0)}% (${s.window.key})`
  if (l.auto_action === 'switch_model' && l.model && l.switch_to) {
    const { data: cur } = await admin.from('model_routes').select('id, to_model, limit_id')
      .eq('org_id', l.org_id).eq('from_model', l.model).eq('is_active', true).maybeSingle()
    let routeId = (cur as { id: string } | null)?.id ?? null
    if (!cur || (cur as { to_model: string }).to_model !== l.switch_to) {
      if (cur) await admin.from('model_routes').update({ is_active: false, deactivated_at: now.toISOString() }).eq('id', (cur as { id: string }).id)
      const { data: ins, error } = await admin.from('model_routes').insert({
        org_id: l.org_id, from_model: l.model, to_model: l.switch_to, match: 'prefix', origin: 'auto',
        limit_id: l.id, reason, is_active: true, activated_at: now.toISOString(),
      }).select('id').single()
      if (error) throw new Error(`model_routes: ${error.message}`)
      routeId = (ins as { id: string }).id
    }
    invalidatePolicy(l.org_id)
    const users = l.scope === 'member' ? (l.user_id ? [l.user_id] : [])
      : l.scope === 'team' ? o.members.filter(m => m.team_id === l.team_id).map(m => m.user_id) : null
    let agents: AgentSwitchResult | { error: string }
    try { agents = await requestAgentModelSwitch(admin, { orgId: l.org_id, fromModel: l.model, toModel: l.switch_to, userIds: users, reason }) }
    catch (e) { agents = { error: (e as Error).message } }
    await audit({ orgId: l.org_id, action: 'limit.auto_switch', targetType: 'limit', targetId: l.id,
      details: { from: l.model, to: l.switch_to, route_id: routeId, pct: Math.floor(s.pct ?? 0), period: s.window.key, agents } })
    return { route_id: routeId, agents }
  }
  if (l.auto_action === 'block_sdk' && l.model) {
    const { data: cur } = await admin.from('model_blocks').select('id').eq('org_id', l.org_id).eq('is_active', true).eq('model', l.model).maybeSingle()
    let blockId = (cur as { id: string } | null)?.id ?? null
    if (!blockId) {
      const { data: ins, error } = await admin.from('model_blocks').insert({ org_id: l.org_id, model: l.model, limit_id: l.id, reason }).select('id').single()
      if (error) throw new Error(`model_blocks: ${error.message}`)
      blockId = (ins as { id: string }).id
    }
    invalidatePolicy(l.org_id)
    await audit({ orgId: l.org_id, action: 'limit.auto_block', targetType: 'limit', targetId: l.id,
      details: { model: l.model, block_id: blockId, pct: Math.floor(s.pct ?? 0), period: s.window.key } })
    return { block_id: blockId }
  }
  return {}
}

/** Evaluate + fire every active limit of one org. */
export async function runOrgLimits(admin: Admin, orgId: string, opts: { now?: Date; source?: 'cron' | 'ingest' } = {}): Promise<LimitRunResult> {
  const now = opts.now ?? new Date()
  const out: LimitRunResult = { limits: 0, notified: 0, actions: 0, fired: [] }
  const { data: raw, error } = await admin.from('limits').select('*').eq('org_id', orgId).eq('is_active', true)
  if (error) throw new Error(`limits: ${error.message}`)
  const limits = ((raw ?? []) as Record<string, unknown>[]).map(normalizeLimit)
    .filter(l => l.amount > 0 && (l.notify_at != null || l.auto_action !== 'none'))
  out.limits = limits.length
  if (!limits.length) return out

  const o = await loadOrg(admin, orgId, limits)
  const from = earliestDay(limits, now, o.tz)!
  const { data: rows, error: e2 } = await admin.rpc('limit_usage_rows', { p_org: orgId, p_from: from, p_prefixes: rpcPrefixes(limits) })
  if (e2) throw new Error(`limit_usage_rows: ${e2.message}`)
  const usage = ((rows ?? []) as UsageRow[])
  const scope = resolver(o)

  for (const l of limits) {
    const s = evaluateLimit(l, usage, scope, now, o.tz)
    const pct = Math.round((s.pct ?? 0) * 10) / 10
    try {
      if (s.notify && await claim(admin, s, 'notify', { used: s.used, amount: l.amount, pct, metric: l.metric, source: opts.source ?? 'cron' })) {
        const r = await deliver(admin, o, s, 'notify', now)
        await admin.from('limit_events').update({ details: { used: s.used, amount: l.amount, pct, metric: l.metric, source: opts.source ?? 'cron', delivery: r } })
          .eq('limit_id', l.id).eq('period_key', s.window.key).eq('level', 'notify')
        await audit({ orgId, action: 'limit.notify', targetType: 'limit', targetId: l.id, details: { model: l.model, pct, period: s.window.key, metric: l.metric } })
        out.notified++; out.fired.push({ limit_id: l.id, level: 'notify', pct })
      }
      if (s.action && await claim(admin, s, 'action', { used: s.used, amount: l.amount, pct, action: l.auto_action, source: opts.source ?? 'cron' })) {
        const done = await applyAction(admin, o, s, now)
        const r = await deliver(admin, o, s, l.auto_action === 'block_sdk' ? 'block_sdk' : 'switch_model', now)
        await admin.from('limit_events').update({ details: { used: s.used, amount: l.amount, pct, action: l.auto_action, switch_to: l.switch_to, ...done, delivery: r } })
          .eq('limit_id', l.id).eq('period_key', s.window.key).eq('level', 'action')
        out.actions++; out.fired.push({ limit_id: l.id, level: 'action', pct })
      }
    } catch (e) {
      log.error('limit evaluation failed', { org_id: orgId, limit_id: l.id, err: e })
    }
  }
  return out
}

// ── Post-ingest hook ─────────────────────────────────────────────────────────

const hasLimits = new TtlCache<string, boolean>(10_000, 30_000)
const lastRun = new Map<string, number>()
const MIN_GAP_MS = 20_000

/**
 * Cheap enough for the ingest hot path: at most one sweep per org per 20 s per
 * instance, skipped entirely (one cached query per 30 s) for orgs without
 * notify/auto-action limits. Never throws. Call it after the response
 * (the ingest routes' `defer`).
 */
export async function evaluateLimitsAfterIngest(admin: Admin, orgId: string): Promise<void> {
  try {
    const t = Date.now()
    if (t - (lastRun.get(orgId) ?? 0) < MIN_GAP_MS) return
    const any = await hasLimits.getOrLoad(orgId, async () => {
      const { count } = await admin.from('limits').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true)
      return (count ?? 0) > 0
    })
    if (!any) return
    lastRun.set(orgId, t)
    if (lastRun.size > 5_000) lastRun.clear()
    await runOrgLimits(admin, orgId, { source: 'ingest' })
  } catch (e) {
    log.warn('post-ingest limit check failed', { org_id: orgId, err: (e as Error).message })
  }
}

/**
 * Current-period usage of the given limit rows (any state) for display —
 * the same numbers the sweep acts on. Returns the org zone too.
 */
export async function computeLimitStates(admin: Admin, orgId: string, rows: Record<string, unknown>[], now: Date = new Date()):
  Promise<{ tz: string; states: Map<string, LimitState>; emails: Map<string, string | null> }> {
  const limits = rows.map(normalizeLimit)
  const o = await loadOrg(admin, orgId, limits)
  const states = new Map<string, LimitState>()
  if (!limits.length) return { tz: o.tz, states, emails: o.emails }
  const { data, error } = await admin.rpc('limit_usage_rows', { p_org: orgId, p_from: earliestDay(limits, now, o.tz)!, p_prefixes: rpcPrefixes(limits) })
  if (error) throw new Error(`limit_usage_rows: ${error.message}`)
  const scope = resolver(o)
  for (const l of limits) states.set(l.id, evaluateLimit(l, (data ?? []) as UsageRow[], scope, now, o.tz))
  return { tz: o.tz, states, emails: o.emails }
}
