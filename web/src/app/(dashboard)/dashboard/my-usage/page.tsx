import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { MyUsageClient } from './_client'
import { selectAll, fetchAllRows } from '@/lib/supabase/paginate'
import { computeCacheStats } from '@/components/dashboard/cache-efficiency'
import { PRODUCTIVITY_COLUMNS, sumProductivity, type ProductivityRow } from '@/components/dashboard/productivity-card'
import { daysAgoIn, shiftDay } from '@/lib/dates'
import { dashSummary, dashBreakdown, dashPrompts, userKeyFor, type DashSummary, type DashBreakdownRow, type DashPrompt } from '@/lib/rollups'
import { projectMonthEnd, monthToDate } from '@/lib/forecast'
import type { ModelSlice, DayPoint, PromptRow, CostTotals } from './_types'

export const metadata = { title: 'My Usage — TokenFin' }

// Always render fresh — usage data changes on every ingested event.
export const dynamic = 'force-dynamic'
export const revalidate = 0

type SavingsRow = {
  cost_usd: number | null; baseline_cost_usd: number | null
  input_tokens_saved: number | null; output_tokens_saved: number | null; was_holdout: boolean | null
}

const TOTAL_KEYS = [
  'cost_usd', 'metered_cost_usd', 'notional_cost_usd', 'vendor_cost_usd', 'requests', 'input_tokens', 'output_tokens',
  'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'total_tokens', 'prompts', 'sessions',
] as const

/** Add summaries for disjoint user keys (email-keyed + id-keyed events of one person). */
function mergeSummaries(list: DashSummary[]): DashSummary {
  const [first, ...rest] = list
  const out: DashSummary = { ...first, series: first.series.map(p => ({ ...p })) }
  for (const s of rest) {
    for (const k of TOTAL_KEYS) out[k] += s[k]
    out.active_days = Math.max(out.active_days, s.active_days)
    s.series.forEach((p, i) => {
      const o = out.series[i]
      o.cost_usd += p.cost_usd; o.metered_cost_usd += p.metered_cost_usd; o.notional_cost_usd += p.notional_cost_usd
      o.requests += p.requests; o.total_tokens += p.total_tokens; o.input_tokens += p.input_tokens
      o.output_tokens += p.output_tokens; o.cache_read_tokens += p.cache_read_tokens
    })
  }
  return out
}

function mergeModelRows(list: DashBreakdownRow[][]): DashBreakdownRow[] {
  const m = new Map<string, DashBreakdownRow>()
  for (const r of list.flat()) {
    const e = m.get(r.key)
    if (!e) { m.set(r.key, { ...r }); continue }
    e.cost_usd += r.cost_usd; e.metered_cost_usd += r.metered_cost_usd; e.notional_cost_usd += r.notional_cost_usd
    e.requests += r.requests; e.total_tokens += r.total_tokens; e.input_tokens += r.input_tokens
    e.output_tokens += r.output_tokens; e.cache_read_tokens += r.cache_read_tokens; e.cache_write_tokens += r.cache_write_tokens
  }
  return Array.from(m.values()).sort((a, b) => b.cost_usd - a.cost_usd)
}

export default async function MyUsagePage() {
  const { user, orgId, timezone: tz } = await requireOrgContext()
  const admin = createAdminClient()
  const displayName = (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? 'you'

  // The rollups key a person by lower(email), else user id (userKeyFor). Events
  // sent without an email land under the id, so read both keys and add them.
  const keys = Array.from(new Set([userKeyFor({ user_email: user.email, user_id: user.id }), user.id].filter(Boolean)))

  const today    = daysAgoIn(0, tz)
  const from30   = shiftDay(today, -29)
  const prevFrom = shiftDay(today, -59)
  const prevTo   = shiftDay(today, -30)
  const since    = new Date(Date.now() - 30 * 864e5).toISOString()

  let data
  try {
    data = await Promise.all([
      Promise.all(keys.map(k => dashSummary(admin, orgId, from30, today, { user_key: k }))),
      Promise.all(keys.map(k => dashSummary(admin, orgId, prevFrom, prevTo, { user_key: k }))),
      Promise.all(keys.map(k => dashBreakdown(admin, orgId, from30, today, 'model', { user_key: k }, 50))),
      Promise.all(keys.map(k => dashPrompts(admin, orgId, from30, today, { user_key: k }, { limit: 8, order: 'cost' }))),
    ])
  } catch (e) {
    return <MyUsageClient error={e instanceof Error ? e.message : String(e)} name={displayName} />
  }
  const [curList, prevList, modelList, promptList] = data
  const cur  = mergeSummaries(curList)
  const prev = mergeSummaries(prevList)

  // Personal productivity (Claude Code telemetry): rows keyed to this user by
  // user_id or by user_key = their email. Two keyset-paged reads, de-duped.
  const email = (user.email ?? '').toLowerCase()
  const prodQuery = (col: 'user_id' | 'user_key', val: string) =>
    fetchAllRows<ProductivityRow>((from, to) => admin.from('productivity_daily')
      .select(PRODUCTIVITY_COLUMNS).eq('org_id', orgId).eq(col, val).gte('day', from30)
      .order('day').order('user_key').order('repo').range(from, to)).catch(() => [] as ProductivityRow[])

  // Savings columns are only set on requests that went through a savings lever
  // (MCP compress / holdouts), so this reads just those rows, not all usage.
  const [prodSets, savingsRes] = await Promise.all([
    Promise.all([prodQuery('user_id', user.id), email ? prodQuery('user_key', email) : Promise.resolve([])]),
    selectAll<SavingsRow>(() => admin.from('usage_events')
      .select('cost_usd, baseline_cost_usd, input_tokens_saved, output_tokens_saved, was_holdout')
      .eq('org_id', orgId).eq('user_id', user.id).gte('created_at', since)
      .or('baseline_cost_usd.not.is.null,was_holdout.eq.true')),
  ])
  const prodByKey = new Map<string, ProductivityRow>()
  for (const r of prodSets.flat()) prodByKey.set(`${r.user_key}|${r.repo ?? ''}|${r.day}`, r)
  const productivity = prodByKey.size > 0 ? sumProductivity(Array.from(prodByKey.values())) : null

  /* ── MTD + projection (org-local days) ── */
  const allDays = [...prev.series, ...cur.series]
  const pick = (k: 'cost_usd' | 'metered_cost_usd' | 'notional_cost_usd') => allDays.map(p => ({ day: p.day, value: p[k] }))
  const mtd: CostTotals = {
    cost: monthToDate(pick('cost_usd'), today),
    metered: monthToDate(pick('metered_cost_usd'), today),
    notional: monthToDate(pick('notional_cost_usd'), today),
  }
  const forecast = projectMonthEnd(pick('cost_usd'), today)

  const modelRows = mergeModelRows(modelList.map(b => b.rows))
  const models: ModelSlice[] = modelRows.map(r => ({ model: r.key || 'unknown', cost: r.cost_usd, tokens: r.total_tokens, requests: r.requests }))
  const days: DayPoint[] = cur.series.map(p => ({ day: p.day, cost: p.cost_usd }))
  const promptByKey = new Map<string, DashPrompt>()
  for (const p of promptList.flatMap(l => l.rows)) {
    const e = promptByKey.get(p.prompt_key)
    promptByKey.set(p.prompt_key, e ? { ...e, cost_usd: e.cost_usd + p.cost_usd, requests: e.requests + p.requests } : p)
  }
  const prompts: PromptRow[] = Array.from(promptByKey.values())
    .sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 8)
    .map(p => ({ hash: p.prompt_key, cost: p.cost_usd, requests: p.requests, model: p.model || 'unknown', lastAt: p.last_at }))

  // Savings (per-request measurable input savings).
  let costSaved = 0, tokensSaved = 0, holdoutCount = 0
  for (const e of savingsRes.data ?? []) {
    if (e.was_holdout) { holdoutCount++; continue }
    costSaved += Math.max(0, Number(e.baseline_cost_usd ?? 0) - Number(e.cost_usd ?? 0))
    tokensSaved += Number(e.input_tokens_saved ?? 0) + Number(e.output_tokens_saved ?? 0)
  }
  const savingsRate = cur.cost_usd + costSaved > 0 ? +((costSaved / (cur.cost_usd + costSaved)) * 100).toFixed(1) : 0

  const trendPct = (c: number, p: number) => (p > 0 ? +((c - p) / p * 100).toFixed(1) : null)

  return (
    <MyUsageClient
      name={displayName}
      timezone={tz}
      last30={{ cost: cur.cost_usd, metered: cur.metered_cost_usd, notional: cur.notional_cost_usd }}
      mtd={mtd}
      projected={forecast?.projected ?? null}
      costTrend={trendPct(cur.cost_usd, prev.cost_usd)}
      totalTokens={cur.total_tokens}
      requests={cur.requests}
      promptCount={cur.prompts}
      models={models}
      days={days}
      prompts={prompts}
      costSaved={costSaved}
      tokensSaved={tokensSaved}
      savingsRate={savingsRate}
      savingsMeasured={holdoutCount >= 20}
      cache={computeCacheStats(modelRows.map(r => ({
        model: r.key, input_tokens: r.input_tokens, cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens,
      })))}
      productivity={productivity}
    />
  )
}
