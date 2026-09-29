import { allocateRows, type AllocationRule } from '@/lib/allocation/apply'
import type { FocusInput } from './map'
import { localMidnightUtc, monthBounds, nextDay } from './time'

/** A row from the finops_usage_dims RPC (migration 014). */
export interface DimsRow {
  day: string | null
  provider: string | null
  model: string
  project_id: string | null
  source: string | null
  cost_basis: string | null
  user_id: string | null
  user_email: string | null
  repo: string | null
  tag_values: Record<string, unknown> | null
  events: number | string
  input_tokens: number | string
  output_tokens: number | string
  cache_read_tokens: number | string
  cache_write_tokens: number | string
  reasoning_tokens: number | string
  total_tokens: number | string
  cost_usd: number | string
  vendor_cost_usd: number | string | null
}

export interface FocusContext {
  orgId: string
  orgName: string
  tz: string
  rules: AllocationRule[]
  projectName: Map<string, string>
  memberTeam: Map<string, string>     // user_id → team name
}

const num = (v: unknown) => Number(v ?? 0) || 0

/**
 * Allocate one day's dims rows and collapse them to the FOCUS grain:
 * day × provider × model × project × source × cost_basis × team × cost_center.
 */
export function focusInputsForDay(day: string, rows: DimsRow[], ctx: FocusContext): FocusInput[] {
  const allocated = allocateRows(
    rows,
    r => ({
      user_id: r.user_id, user_email: r.user_email, repo: r.repo, project_id: r.project_id,
      source: r.source, model: r.model, tags: r.tag_values ?? {},
      member_team: r.user_id ? ctx.memberTeam.get(r.user_id) ?? null : null,
    }),
    r => num(r.cost_usd),
    ctx.rules,
  )

  const periodStart = localMidnightUtc(day, ctx.tz)
  const periodEnd   = localMidnightUtc(nextDay(day), ctx.tz)
  const mb = monthBounds(day)
  const billStart = localMidnightUtc(mb.start, ctx.tz)
  const billEnd   = localMidnightUtc(mb.end, ctx.tz)

  const groups = new Map<string, FocusInput>()
  for (const a of allocated) {
    const r = a.row
    const w = a.weight
    const method: FocusInput['allocationMethod'] = a.split_rule ? 'shared_split'
      : a.rule_ids.length > 0 ? 'rule'
      : a.team ? 'member' : 'none'
    const key = [r.provider, r.model, r.project_id, r.source, r.cost_basis, a.team, a.cost_center, method].join('\u0001')
    let g = groups.get(key)
    if (!g) {
      g = {
        day, chargePeriodStart: periodStart, chargePeriodEnd: periodEnd,
        billingPeriodStart: billStart, billingPeriodEnd: billEnd,
        orgId: ctx.orgId, orgName: ctx.orgName,
        provider: r.provider, model: r.model, projectId: r.project_id,
        projectName: r.project_id ? ctx.projectName.get(r.project_id) ?? 'Deleted project' : null,
        source: r.source, costBasis: r.cost_basis, team: a.team, costCenter: a.cost_center,
        allocationMethod: method,
        events: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        reasoningTokens: 0, totalTokens: 0, cost: 0, vendorCost: null,
      }
      groups.set(key, g)
    }
    g.events           += num(r.events) * w
    g.inputTokens      += num(r.input_tokens) * w
    g.outputTokens     += num(r.output_tokens) * w
    g.cacheReadTokens  += num(r.cache_read_tokens) * w
    g.cacheWriteTokens += num(r.cache_write_tokens) * w
    g.reasoningTokens  += num(r.reasoning_tokens) * w
    g.totalTokens      += num(r.total_tokens) * w
    g.cost             += num(r.cost_usd) * w
    // Vendor cost: use it where reported, fall back to computed cost for the rest.
    if (r.vendor_cost_usd != null || g.vendorCost != null) {
      g.vendorCost = (g.vendorCost ?? (g.cost - num(r.cost_usd) * w)) + (r.vendor_cost_usd != null ? num(r.vendor_cost_usd) : num(r.cost_usd)) * w
    }
  }
  // Split pieces carry fractional counts; round the quantity-like fields.
  const out = Array.from(groups.values())
  for (const g of out) {
    g.events = Math.round(g.events)
    g.inputTokens = Math.round(g.inputTokens); g.outputTokens = Math.round(g.outputTokens)
    g.cacheReadTokens = Math.round(g.cacheReadTokens); g.cacheWriteTokens = Math.round(g.cacheWriteTokens)
    g.reasoningTokens = Math.round(g.reasoningTokens); g.totalTokens = Math.round(g.totalTokens)
  }
  return out.sort((a, b) => (b.cost - a.cost) || a.model.localeCompare(b.model))
}
