/**
 * Per-model limits (migration 024) — pure evaluation. No I/O.
 *
 * A limit = scope (org / project / team / member) + optional model filter
 * (id or prefix, case-insensitive; provider prefixes such as "anthropic/" or
 * Bedrock's "us.anthropic." are ignored on both sides) + metric (cost_usd /
 * tokens / requests) + basis (all / metered / notional) + calendar period in
 * the org time zone (./period). Usage comes from usage_daily rows
 * (limit_usage_rows RPC), whose `day` is already org-local.
 */
import { periodWindow, type Period, type PeriodWindow } from './period'

export type Metric = 'cost_usd' | 'tokens' | 'requests'
export type Basis = 'all' | 'metered' | 'notional'
export type AutoAction = 'none' | 'switch_model' | 'block_sdk'
export type LimitScope = 'org' | 'project' | 'team' | 'member'

export const METRICS: readonly Metric[] = ['cost_usd', 'tokens', 'requests']
export const BASES: readonly Basis[] = ['all', 'metered', 'notional']
export const AUTO_ACTIONS: readonly AutoAction[] = ['none', 'switch_model', 'block_sdk']

export interface LimitDef {
  id:              string
  org_id:          string
  scope:           LimitScope
  project_id:      string | null
  team_id:         string | null
  user_id:         string | null
  model:           string | null
  metric:          Metric
  basis:           Basis
  period:          Period
  amount:          number
  notify_at:       number | null
  notify_channels: { inapp: boolean; email: boolean }
  auto_action:     AutoAction
  switch_to:       string | null
  auto_action_at:  number
  is_active:       boolean
}

export interface UsageRow {
  day: string; model: string; project_id: string; user_key: string; cost_basis: string
  requests: number; total_tokens: number; cost_usd: number
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
const numOr = (v: unknown, d: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v))

/**
 * The limit amount in metric units. New-style rows keep it in `value`;
 * legacy dollar limits only have `budget_usd`.
 */
export function limitAmount(row: { metric?: unknown; value?: unknown; budget_usd?: unknown }): number {
  const v = numOr(row.value, NaN)
  if (Number.isFinite(v) && v > 0) return v
  return (row.metric ?? 'cost_usd') === 'cost_usd' ? numOr(row.budget_usd, 0) : 0
}

/** A DB row (select '*') → LimitDef with defaults for rows older than 024. */
export function normalizeLimit(row: Record<string, unknown>): LimitDef {
  const ch = (row.notify_channels ?? {}) as Record<string, unknown>
  const na = row.notify_at === undefined ? 90 : row.notify_at
  return {
    id:              String(row.id),
    org_id:          String(row.org_id),
    scope:           pick(row.scope, ['org', 'project', 'team', 'member'] as const, 'org'),
    project_id:      (row.project_id as string | null) ?? null,
    team_id:         (row.team_id as string | null) ?? null,
    user_id:         (row.user_id as string | null) ?? null,
    model:           typeof row.model === 'string' && row.model.trim() ? row.model.trim() : null,
    metric:          pick(row.metric, METRICS, 'cost_usd'),
    basis:           pick(row.basis, BASES, 'all'),
    period:          pick(row.period, ['daily', 'weekly', 'monthly'] as const, 'monthly'),
    amount:          limitAmount(row),
    notify_at:       na == null ? null : numOr(na, 90),
    notify_channels: { inapp: ch.inapp !== false, email: ch.email !== false },
    auto_action:     pick(row.auto_action, AUTO_ACTIONS, 'none'),
    switch_to:       typeof row.switch_to === 'string' && row.switch_to.trim() ? row.switch_to.trim() : null,
    auto_action_at:  numOr(row.auto_action_at, 100),
    is_active:       row.is_active !== false,
  }
}

/** Lower-case model id without a provider prefix ("anthropic/…", "us.anthropic.…"). */
export function normModel(m: string): string {
  return m.trim().toLowerCase()
    .replace(/^[a-z0-9_-]+\//, '')
    .replace(/^(?:(?:us|eu|apac|global)\.)?anthropic\./, '')
}

/** True when `model` is `prefix` or starts with it. null prefix = every model. */
export function modelMatches(prefix: string | null | undefined, model: string): boolean {
  if (!prefix) return true
  const p = normModel(prefix)
  return !!p && normModel(model).startsWith(p)
}

/** usage_daily.user_key values for a member: lower(email) and user_id. */
export function userKeysOf(userId: string, email?: string | null): string[] {
  return email ? [userId, email.toLowerCase()] : [userId]
}

export interface ScopeResolver {
  /** user_keys of the team's members */
  teamKeys(teamId: string): ReadonlySet<string>
  /** user_keys of one member */
  memberKeys(userId: string): ReadonlySet<string>
}

/**
 * Rows counted by a limit, or null when the scope can't be measured (a member
 * limit without user_id — rows created before migration 024).
 */
export function rowFilter(l: LimitDef, scope: ScopeResolver): ((r: UsageRow) => boolean) | null {
  let keys: ReadonlySet<string> | null = null
  if (l.scope === 'team') { if (!l.team_id) return null; keys = scope.teamKeys(l.team_id) }
  if (l.scope === 'member') { if (!l.user_id) return null; keys = scope.memberKeys(l.user_id) }
  if (l.scope === 'project' && !l.project_id) return null
  return (r: UsageRow) => {
    if (l.scope === 'project' && r.project_id !== l.project_id) return false
    if (keys && !keys.has(r.user_key)) return false
    if (l.basis === 'metered' && r.cost_basis === 'notional') return false
    if (l.basis === 'notional' && r.cost_basis !== 'notional') return false
    return modelMatches(l.model, r.model)
  }
}

const metricOf = (r: UsageRow, m: Metric) =>
  Number(m === 'cost_usd' ? r.cost_usd : m === 'tokens' ? r.total_tokens : r.requests) || 0

/** Period-to-date usage of a limit in metric units (null = not measurable). */
export function limitUsage(l: LimitDef, rows: readonly UsageRow[], win: PeriodWindow, scope: ScopeResolver): number | null {
  const f = rowFilter(l, scope)
  if (!f) return null
  let sum = 0
  for (const r of rows) if (r.day >= win.fromDay && r.day < win.nextDay && f(r)) sum += metricOf(r, l.metric)
  return l.metric === 'cost_usd' ? +sum.toFixed(6) : sum
}

export interface LimitState {
  limit:   LimitDef
  window:  PeriodWindow
  used:    number | null
  pct:     number | null
  /** notify_at reached (and notifications on) */
  notify:  boolean
  /** auto_action_at reached with an auto action set */
  action:  boolean
}

export function evaluateLimit(l: LimitDef, rows: readonly UsageRow[], scope: ScopeResolver, now: Date, tz: string): LimitState {
  const window = periodWindow(l.period, now, tz)
  const used = limitUsage(l, rows, window, scope)
  const pct = used == null || l.amount <= 0 ? null : (used / l.amount) * 100
  return {
    limit: l, window, used, pct,
    notify: pct != null && l.is_active && l.notify_at != null && pct >= l.notify_at,
    action: pct != null && l.is_active && l.auto_action !== 'none' && pct >= l.auto_action_at,
  }
}

/** Earliest usage day any of these limits needs (their current windows). */
export function earliestDay(limits: readonly LimitDef[], now: Date, tz: string): string | null {
  let min: string | null = null
  for (const l of limits) { const d = periodWindow(l.period, now, tz).fromDay; if (!min || d < min) min = d }
  return min
}

/** Model prefixes for the RPC's coarse filter, or null when any limit spans every model. */
export function rpcPrefixes(limits: readonly LimitDef[]): string[] | null {
  if (!limits.length || limits.some(l => !l.model)) return null
  return Array.from(new Set(limits.map(l => normModel(l.model!)).filter(Boolean)))
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatAmount(metric: Metric, n: number): string {
  if (metric === 'cost_usd') return `$${n >= 100 ? n.toFixed(0) : n.toFixed(2)}`
  const unit = metric === 'tokens' ? 'tokens' : 'requests'
  const v = n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n))
  return `${v} ${unit}`
}

export const PERIOD_NOUN: Record<Period, string> = { daily: "today's", weekly: "this week's", monthly: "this month's" }
export const METRIC_NOUN: Record<Metric, string> = { cost_usd: 'spend', tokens: 'token usage', requests: 'request count' }

/** "claude-opus usage" / "Org usage" — the subject of a limit. */
export function limitSubject(l: LimitDef): string {
  return l.model ? `${l.model} usage` : 'Usage'
}

/** "the whole org" / "project Web" / "team Platform" / "a@b.com". */
export function scopePhrase(l: LimitDef, names: { project?: string | null; team?: string | null; member?: string | null }): string {
  if (l.scope === 'project') return `project ${names.project ?? 'unknown'}`
  if (l.scope === 'team') return `team ${names.team ?? 'unknown'}`
  if (l.scope === 'member') return names.member ?? 'a member'
  return 'the whole org'
}
