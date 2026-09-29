import type { Channel, DesiredBudget, ValidationIssue } from './schema'

/**
 * Diff a budgets file against the workspace's current limits and the
 * limit_breach alert rules the file manages — pure, so dry runs and applies
 * share exactly the same plan.
 *
 * Identity: a limit is (scope, project_id | team_id, period). A managed alert
 * rule is recognised by its name prefix (MANAGED_PREFIX) — rules created in
 * the UI are never touched.
 */

export const MANAGED_PREFIX = 'budgets.yaml: '

export interface CurrentLimit {
  id: string; scope: string; project_id: string | null; team_id: string | null; period: string
  budget_usd: number | string; warn_at: number; throttle_at: number; block_at: number; is_active: boolean
  created_at?: string
}
export interface CurrentAlert {
  id: string; name: string; project_id: string | null; scope: string; threshold: number | string | null
  channels: Record<string, boolean> | null; is_active: boolean
}
export interface Lookup {
  projects: { id: string; name: string; slug: string | null }[]
  teams: { id: string; name: string }[]
}

export interface LimitFields {
  scope: DesiredBudget['scope']; project_id: string | null; team_id: string | null; period: DesiredBudget['period']
  budget_usd: number; warn_at: number; throttle_at: number; block_at: number; is_active: boolean
}
export interface AlertFields {
  name: string; trigger_type: 'limit_breach'; project_id: string | null; scope: string; condition: string
  threshold: number; cooldown_hours: number; is_active: boolean
  channels: Record<Channel, boolean>
}

export type LimitChange =
  | { op: 'create'; key: string; label: string; after: LimitFields }
  | { op: 'update'; key: string; label: string; id: string; before: Partial<LimitFields>; after: Partial<LimitFields> }
  | { op: 'unchanged'; key: string; label: string; id: string }
  | { op: 'delete'; key: string; label: string; id: string; before: Partial<LimitFields> }

export type AlertChange =
  | { op: 'create'; name: string; after: AlertFields }
  | { op: 'update'; name: string; id: string; before: Partial<AlertFields>; after: Partial<AlertFields> }
  | { op: 'unchanged'; name: string; id: string }
  | { op: 'delete'; name: string; id: string }

export interface Plan {
  ok: boolean
  issues: ValidationIssue[]
  limits: LimitChange[]
  alerts: AlertChange[]
  summary: { create: number; update: number; delete: number; unchanged: number }
}

const keyOf = (scope: string, targetId: string | null, period: string) => `${scope}:${targetId ?? ''}:${period}`

export function scopeName(scope: string, name: string | null): string {
  return scope === 'org' ? 'Entire org' : scope === 'member' ? 'Member' : (name ?? 'Unknown')
}

function resolveTarget(b: DesiredBudget, lk: Lookup): { id: string | null; name: string | null } | string {
  if (b.scope === 'org' || b.scope === 'member') return { id: null, name: null }
  const t = (b.target ?? '').trim()
  if (b.scope === 'project') {
    const hit = lk.projects.find(p => p.id === t)
      ?? lk.projects.find(p => p.slug != null && p.slug === t)
      ?? lk.projects.filter(p => p.name.toLowerCase() === t.toLowerCase()).at(0)
    if (!hit) return `unknown project "${t}" (use its slug, name or id)`
    if (!lk.projects.some(p => p.id === t || p.slug === t) && lk.projects.filter(p => p.name.toLowerCase() === t.toLowerCase()).length > 1) {
      return `project name "${t}" is ambiguous — use the slug or id`
    }
    return { id: hit.id, name: hit.name }
  }
  const byId = lk.teams.find(x => x.id === t)
  if (byId) return { id: byId.id, name: byId.name }
  const byName = lk.teams.filter(x => x.name.toLowerCase() === t.toLowerCase())
  if (byName.length === 0) return `unknown team "${t}"`
  if (byName.length > 1) return `team name "${t}" is ambiguous — use its id`
  return { id: byName[0].id, name: byName[0].name }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildPlan(desired: DesiredBudget[], current: { limits: CurrentLimit[]; alerts: CurrentAlert[] }, lk: Lookup, prune: boolean): Plan {
  const issues: ValidationIssue[] = []
  const limits: LimitChange[] = []
  const alerts: AlertChange[] = []
  const seen = new Set<string>()
  const matchedLimitIds = new Set<string>()
  const wantedAlertNames = new Set<string>()
  const alertByName = new Map(current.alerts.filter(a => a.name.startsWith(MANAGED_PREFIX)).map(a => [a.name, a]))

  for (const b of desired) {
    const t = resolveTarget(b, lk)
    if (typeof t === 'string') { issues.push({ path: `budgets.${b.index}.target`, message: t }); continue }
    const key = keyOf(b.scope, t.id, b.period)
    if (seen.has(key)) { issues.push({ path: `budgets.${b.index}`, message: `duplicate budget for ${b.scope} ${b.target ?? ''} ${b.period}`.replace(/\s+/g, ' ') }); continue }
    seen.add(key)
    const sName = scopeName(b.scope, t.name)
    const label = `${b.name ? b.name + ' — ' : ''}${sName} (${b.period})`

    const want: LimitFields = {
      scope: b.scope,
      project_id: b.scope === 'project' ? t.id : null,
      team_id: b.scope === 'team' ? t.id : null,
      period: b.period, budget_usd: round2(b.amount_usd),
      warn_at: b.warn, throttle_at: b.throttle, block_at: b.block, is_active: b.active,
    }
    const cur = current.limits.find(l => !matchedLimitIds.has(l.id)
      && keyOf(l.scope, l.scope === 'project' ? l.project_id : l.scope === 'team' ? l.team_id : null, l.period) === key)
    if (!cur) {
      limits.push({ op: 'create', key, label, after: want })
    } else {
      matchedLimitIds.add(cur.id)
      const before: Partial<LimitFields> = {}
      const after: Partial<LimitFields> = {}
      const curVals: Partial<LimitFields> = {
        budget_usd: round2(Number(cur.budget_usd)), warn_at: cur.warn_at, throttle_at: cur.throttle_at,
        block_at: cur.block_at, is_active: cur.is_active,
      }
      for (const f of ['budget_usd', 'warn_at', 'throttle_at', 'block_at', 'is_active'] as const) {
        if (curVals[f] !== want[f]) { (before as Record<string, unknown>)[f] = curVals[f]; (after as Record<string, unknown>)[f] = want[f] }
      }
      limits.push(Object.keys(after).length ? { op: 'update', key, label, id: cur.id, before, after } : { op: 'unchanged', key, label, id: cur.id })
    }

    // Linked limit_breach alert rule (none when notify is empty).
    const name = `${MANAGED_PREFIX}${sName} ${b.period} budget`
    if (b.notify.length === 0) continue
    wantedAlertNames.add(name)
    const a: AlertFields = {
      name, trigger_type: 'limit_breach', project_id: want.project_id, scope: sName,
      condition: `spend >= ${b.warn}%`, threshold: b.warn, cooldown_hours: 4, is_active: b.active,
      channels: { email: b.notify.includes('email'), slack: b.notify.includes('slack'), webhook: b.notify.includes('webhook'), inapp: b.notify.includes('inapp') },
    }
    const ca = alertByName.get(name)
    if (!ca) { alerts.push({ op: 'create', name, after: a }); continue }
    const before: Partial<AlertFields> = {}
    const after: Partial<AlertFields> = {}
    if (Number(ca.threshold) !== a.threshold) { before.threshold = Number(ca.threshold); after.threshold = a.threshold; after.condition = a.condition }
    if ((ca.project_id ?? null) !== a.project_id) { before.project_id = ca.project_id; after.project_id = a.project_id }
    if (ca.is_active !== a.is_active) { before.is_active = ca.is_active; after.is_active = a.is_active }
    if (ca.scope !== a.scope) { before.scope = ca.scope; after.scope = a.scope }
    const cc = ca.channels ?? {}
    if ((['email', 'slack', 'webhook', 'inapp'] as const).some(c => !!cc[c] !== a.channels[c])) {
      before.channels = { email: !!cc.email, slack: !!cc.slack, webhook: !!cc.webhook, inapp: !!cc.inapp }
      after.channels = a.channels
    }
    alerts.push(Object.keys(after).length ? { op: 'update', name, id: ca.id, before, after } : { op: 'unchanged', name, id: ca.id })
  }

  // Managed alert rules the file no longer wants are always removed (they're ours).
  for (const [name, a] of Array.from(alertByName.entries())) {
    if (!wantedAlertNames.has(name)) alerts.push({ op: 'delete', name, id: a.id })
  }
  if (prune) {
    for (const l of current.limits) {
      if (matchedLimitIds.has(l.id)) continue
      const tname = l.scope === 'project' ? lk.projects.find(p => p.id === l.project_id)?.name ?? null
        : l.scope === 'team' ? lk.teams.find(x => x.id === l.team_id)?.name ?? null : null
      limits.push({
        op: 'delete', key: keyOf(l.scope, l.project_id ?? l.team_id, l.period),
        label: `${scopeName(l.scope, tname)} (${l.period})`, id: l.id,
        before: { budget_usd: Number(l.budget_usd), warn_at: l.warn_at, throttle_at: l.throttle_at, block_at: l.block_at },
      })
    }
  }

  const all = [...limits, ...alerts]
  const count = (op: string) => all.filter(c => c.op === op).length
  return {
    ok: issues.length === 0, issues, limits, alerts,
    summary: { create: count('create'), update: count('update'), delete: count('delete'), unchanged: count('unchanged') },
  }
}

/** Human-readable diff (used by the CLI and the dry-run text output). */
export function formatPlan(p: Plan): string {
  const lines: string[] = []
  const fmt = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
  for (const c of p.limits) {
    if (c.op === 'create') lines.push(`+ limit ${c.label}: $${c.after.budget_usd} warn ${c.after.warn_at}% throttle ${c.after.throttle_at}% block ${c.after.block_at}%`)
    if (c.op === 'update') lines.push(`~ limit ${c.label}: ${fmt(c.before)} → ${fmt(c.after)}`)
    if (c.op === 'delete') lines.push(`- limit ${c.label}`)
    if (c.op === 'unchanged') lines.push(`  limit ${c.label} (unchanged)`)
  }
  for (const c of p.alerts) {
    if (c.op === 'create') lines.push(`+ alert "${c.name}" at ${c.after.threshold}% via ${Object.entries(c.after.channels).filter(([, v]) => v).map(([k]) => k).join(', ')}`)
    if (c.op === 'update') lines.push(`~ alert "${c.name}": ${fmt(c.before)} → ${fmt(c.after)}`)
    if (c.op === 'delete') lines.push(`- alert "${c.name}"`)
    if (c.op === 'unchanged') lines.push(`  alert "${c.name}" (unchanged)`)
  }
  for (const i of p.issues) lines.push(`! ${i.path}: ${i.message}`)
  lines.push(`${p.summary.create} to create, ${p.summary.update} to update, ${p.summary.delete} to delete, ${p.summary.unchanged} unchanged`)
  return lines.join('\n')
}
