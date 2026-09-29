/**
 * Rollup reads with access scoping + the shared "window" (Last N days) logic
 * used by the analytics / sessions / prompts pages and the analytics API.
 *
 * Scoping: rbac.promptScope() returns a user id for members/viewers. The rollups
 * key people by `user_key` = lower(email), else user_id (see rollups.userKeyFor),
 * so one person can appear under two keys (OTLP events carry the email, SDK
 * events may only carry the id). A scoped read runs once per key and merges.
 *
 * Server-only (uses the service-role client for the rollup RPCs).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { toZonedDate, shiftDay, isValidTimeZone } from '@/lib/dates'
import {
  dashSummary, dashBreakdown, dashSessions, dashPrompts,
  type DashFilters, type DashSummary, type DashBreakdown, type DashBreakdownRow,
  type DashDimension, type DashSession, type DashPrompt, type Page,
} from '@/lib/rollups'

/* ── Window ─────────────────────────────────────────────────────────────── */

export interface Window {
  from: string
  to: string
  /** inclusive day count */
  days: number
  prevFrom: string
  prevTo: string
  custom: boolean
  /** "Last 30 days" or "Sep 1 – Sep 20" */
  label: string
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** dash_* RPCs reject ranges longer than 1100 days. */
export const MAX_WINDOW_DAYS = 1095

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1

export function fmtDayLabel(day: string): string {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function windowLabel(days: number): string {
  return days === 1 ? 'Today' : `Last ${days} days`
}

/**
 * Resolve ?days= / ?from=&to= into org-local inclusive day labels. The window
 * always ends today (org zone) unless a custom range is given; the previous
 * window is the same length immediately before it.
 */
export function resolveWindow(
  sp: { days?: string | null; from?: string | null; to?: string | null } | undefined,
  tz: string,
  opts: { defaultDays?: number; allowed?: number[]; now?: number } = {},
): Window {
  const today = toZonedDate(opts.now ?? Date.now(), tz)
  const def = opts.defaultDays ?? 30
  let from: string, to: string, custom = false
  const f = sp?.from ?? '', t = sp?.to ?? ''
  if (DAY_RE.test(f) && DAY_RE.test(t) && f <= t && dayCount(f, t) <= MAX_WINDOW_DAYS) {
    from = f; to = t; custom = true
  } else {
    let days = parseInt(sp?.days ?? '', 10)
    if (!Number.isFinite(days) || days < 1) days = def
    if (opts.allowed && !opts.allowed.includes(days)) days = def
    days = Math.min(days, MAX_WINDOW_DAYS)
    to = today
    from = shiftDay(today, -(days - 1))
  }
  const days = dayCount(from, to)
  return {
    from, to, days, custom,
    prevTo: shiftDay(from, -1),
    prevFrom: shiftDay(from, -days),
    label: custom ? `${fmtDayLabel(from)} – ${fmtDayLabel(to)}` : windowLabel(days),
  }
}

/**
 * UTC ISO timestamp of 00:00 on `day` in `tz` — the lower bound to use when a
 * raw usage_events read must line up with the rollups' org-local day buckets.
 */
export function zonedDayStartIso(day: string, tz: string): string {
  const guess = Date.parse(day + 'T00:00:00Z')
  if (!isValidTimeZone(tz)) return new Date(guess).toISOString()
  // Two passes handle DST: offset = (wall clock in tz) − UTC at that instant.
  let ts = guess
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(ts)
    const g = (t: string) => Number(parts.find(p => p.type === t)?.value)
    const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
    ts = guess - (wall - ts)
  }
  return new Date(ts).toISOString()
}

/** Prev-period trend %: null when there is no previous data (UI shows no badge). */
export function trendPct(curr: number, prev: number): number | null {
  return prev > 0 ? +((curr - prev) / prev * 100).toFixed(1) : null
}

/* ── Scope ──────────────────────────────────────────────────────────────── */

/** null = org-wide; otherwise only this person's rows. */
export type UserScope = null | { userId: string; email: string | null; keys: string[] }

export function scopeKeys(userId: string, email: string | null | undefined): string[] {
  const e = (email ?? '').trim().toLowerCase()
  return Array.from(new Set([e, userId].filter(Boolean)))
}

/**
 * Build a scope from promptScope()'s result. Pass the email when you already
 * have it (pages have ctx.user); otherwise it is looked up once.
 */
export async function resolveUserScope(
  admin: SupabaseClient, scopeUserId: string | null, email?: string | null,
): Promise<UserScope> {
  if (!scopeUserId) return null
  let mail = email ?? null
  if (mail == null) {
    const { data } = await admin.auth.admin.getUserById(scopeUserId).catch(() => ({ data: null }))
    mail = data?.user?.email ?? null
  }
  return { userId: scopeUserId, email: mail, keys: scopeKeys(scopeUserId, mail) }
}

/** PostgREST `or=` value that matches a person's raw usage_events rows. */
export function eventScopeOr(scope: NonNullable<UserScope>): string {
  const parts = [`user_id.eq.${scope.userId}`]
  if (scope.email) {
    // ilike for case-insensitivity; escape LIKE wildcards, then quote for PostgREST.
    const like = scope.email.replace(/[\\%_]/g, c => '\\' + c)
    parts.push(`user_email.ilike."${like.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  }
  return parts.join(',')
}

/* ── Pure merges (exported for tests) ───────────────────────────────────── */

const SUM_KEYS = [
  'cost_usd', 'metered_cost_usd', 'notional_cost_usd', 'vendor_cost_usd', 'requests',
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'total_tokens',
] as const

function weightedLatency(parts: { avg_latency_ms: number | null; requests: number }[]): number | null {
  let w = 0, s = 0
  for (const p of parts) if (p.avg_latency_ms != null && p.requests > 0) { w += p.requests; s += p.avg_latency_ms * p.requests }
  return w > 0 ? +(s / w).toFixed(1) : null
}

export function mergeSummaries(parts: DashSummary[]): DashSummary {
  if (parts.length === 1) return parts[0]
  const base = parts[0]
  const out: DashSummary = { ...base, series: base.series.map(p => ({ ...p })) }
  for (const k of SUM_KEYS) out[k] = parts.reduce((s, p) => s + Number(p[k] ?? 0), 0)
  out.prompts = parts.reduce((s, p) => s + p.prompts, 0)
  out.sessions = parts.reduce((s, p) => s + p.sessions, 0)
  out.active_users = parts.filter(p => p.requests > 0).length > 0 ? 1 : 0
  out.avg_latency_ms = weightedLatency(parts)
  const byDay = new Map(out.series.map(p => [p.day, p]))
  for (const part of parts.slice(1)) {
    for (const p of part.series) {
      const t = byDay.get(p.day)
      if (!t) continue
      t.cost_usd += p.cost_usd; t.metered_cost_usd += p.metered_cost_usd; t.notional_cost_usd += p.notional_cost_usd
      t.requests += p.requests; t.total_tokens += p.total_tokens; t.input_tokens += p.input_tokens
      t.output_tokens += p.output_tokens; t.cache_read_tokens += p.cache_read_tokens
    }
  }
  out.active_days = out.series.filter(p => p.requests > 0 || p.cost_usd > 0).length
  return out
}

export function mergeBreakdowns(parts: DashBreakdown[], limit: number, chronological = false): DashBreakdown {
  if (parts.length === 1) return parts[0]
  const m = new Map<string, DashBreakdownRow & { _lat: { avg_latency_ms: number | null; requests: number }[] }>()
  for (const part of parts) for (const r of part.rows) {
    const e = m.get(r.key)
    if (!e) { m.set(r.key, { ...r, _lat: [{ avg_latency_ms: r.avg_latency_ms, requests: r.requests }] }); continue }
    for (const k of SUM_KEYS) e[k] = Number(e[k] ?? 0) + Number(r[k] ?? 0)
    e.active_days = Math.max(e.active_days, r.active_days)
    e.users = Math.max(e.users, r.users)
    e._lat.push({ avg_latency_ms: r.avg_latency_ms, requests: r.requests })
  }
  const all = Array.from(m.values()).map(({ _lat, ...r }) => ({ ...r, avg_latency_ms: weightedLatency(_lat) }))
  all.sort(chronological ? (a, b) => a.key.localeCompare(b.key)
    : (a, b) => b.cost_usd - a.cost_usd || b.total_tokens - a.total_tokens || a.key.localeCompare(b.key))
  const rows = chronological ? all : all.slice(0, limit)
  const rest = chronological ? [] : all.slice(limit)
  return {
    rows,
    total_keys: all.length,
    other: rest.length ? {
      keys: rest.length,
      requests: rest.reduce((s, r) => s + r.requests, 0),
      total_tokens: rest.reduce((s, r) => s + r.total_tokens, 0),
      cost_usd: rest.reduce((s, r) => s + r.cost_usd, 0),
      metered_cost_usd: rest.reduce((s, r) => s + r.metered_cost_usd, 0),
      notional_cost_usd: rest.reduce((s, r) => s + r.notional_cost_usd, 0),
    } : null,
  }
}

type Order = 'recent' | 'cost' | 'tokens' | 'requests'
function pageCmp(order: Order) {
  return (a: DashSession | DashPrompt, b: DashSession | DashPrompt) => {
    const d = order === 'cost' ? b.cost_usd - a.cost_usd
      : order === 'tokens' ? b.total_tokens - a.total_tokens
      : order === 'requests' ? b.requests - a.requests
      : 0
    return d || b.last_at.localeCompare(a.last_at)
  }
}

export function mergePages<T extends DashSession | DashPrompt>(parts: Page<T>[], order: Order, offset: number, limit: number): Page<T> {
  if (parts.length === 1) return parts[0]
  const all = parts.flatMap(p => p.rows).sort(pageCmp(order)) as T[]
  return { total: parts.reduce((s, p) => s + p.total, 0), rows: all.slice(offset, offset + limit) }
}

/* ── Scoped reads ───────────────────────────────────────────────────────── */

const withKey = (f: DashFilters | undefined, k: string): DashFilters => ({ ...(f ?? {}), user_key: k })

export async function scopedSummary(admin: SupabaseClient, orgId: string, from: string, to: string, scope: UserScope, filters?: DashFilters): Promise<DashSummary> {
  if (!scope) return dashSummary(admin, orgId, from, to, filters)
  const parts = await Promise.all(scope.keys.map(k => dashSummary(admin, orgId, from, to, withKey(filters, k))))
  return mergeSummaries(parts)
}

export async function scopedBreakdown(
  admin: SupabaseClient, orgId: string, from: string, to: string, dim: DashDimension,
  scope: UserScope, filters?: DashFilters, limit = 50,
): Promise<DashBreakdown> {
  if (!scope) return dashBreakdown(admin, orgId, from, to, dim, filters, limit)
  const parts = await Promise.all(scope.keys.map(k => dashBreakdown(admin, orgId, from, to, dim, withKey(filters, k), 1000)))
  return mergeBreakdowns(parts, limit, dim === 'day')
}

export async function scopedSessions(
  admin: SupabaseClient, orgId: string, from: string, to: string, scope: UserScope,
  filters: DashFilters | undefined, opts: { limit?: number; offset?: number; order?: 'recent' | 'cost' | 'tokens' } = {},
): Promise<Page<DashSession>> {
  if (!scope) return dashSessions(admin, orgId, from, to, filters, opts)
  const limit = opts.limit ?? 50, offset = opts.offset ?? 0
  const parts = await Promise.all(scope.keys.map(k =>
    dashSessions(admin, orgId, from, to, withKey(filters, k), { ...opts, offset: 0, limit: Math.min(1000, offset + limit) })))
  return mergePages(parts, opts.order ?? 'recent', offset, limit)
}

export async function scopedPrompts(
  admin: SupabaseClient, orgId: string, from: string, to: string, scope: UserScope,
  filters: DashFilters | undefined, opts: { limit?: number; offset?: number; order?: 'cost' | 'recent' | 'tokens' | 'requests' } = {},
): Promise<Page<DashPrompt>> {
  if (!scope) return dashPrompts(admin, orgId, from, to, filters, opts)
  const limit = opts.limit ?? 50, offset = opts.offset ?? 0
  const parts = await Promise.all(scope.keys.map(k =>
    dashPrompts(admin, orgId, from, to, withKey(filters, k), { ...opts, offset: 0, limit: Math.min(1000, offset + limit) })))
  return mergePages(parts, opts.order ?? 'cost', offset, limit)
}

/* ── Labels ─────────────────────────────────────────────────────────────── */

/** usage_events.source values → display name. */
export const SOURCE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex_cli:   'Codex',
  gemini_cli:  'Gemini CLI',
  opencode:    'OpenCode',
  sdk:         'SDK',
  mcp:         'MCP',
  proxy:       'Proxy',
}
export function sourceLabel(source: string): string {
  if (!source) return 'Direct API'
  return SOURCE_LABELS[source] ?? source
}

/**
 * Display labels for rollup user keys: a key that is a member's user id (SDK
 * events without an email) maps to that member's email. Email keys pass through.
 */
export async function memberEmailMap(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const [{ data: members }, { data: auth }] = await Promise.all([
    admin.from('members').select('user_id').eq('org_id', orgId),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])
  const ids = new Set((members ?? []).map(m => m.user_id as string))
  const out = new Map<string, string>()
  for (const u of auth?.users ?? []) if (ids.has(u.id) && u.email) out.set(u.id, u.email.toLowerCase())
  return out
}
