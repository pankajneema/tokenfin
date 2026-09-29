import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgContext } from '@/lib/org-context'
import { dashSummary } from '@/lib/rollups'
import { resolveWindow, zonedDayStartIso } from '@/lib/rollup-scope'
import { SavingsClient } from './_client'
import { outputPrice as outPrice } from '@/lib/mcp/pricing'
import { selectAll } from '@/lib/supabase/paginate'
import { toZonedDate } from '@/lib/dates'

export const metadata = { title: 'Savings — TokenFin' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

type SavingsRow = {
  id: string; model: string; cost_usd: number | null; baseline_cost_usd: number | null; input_tokens_saved: number | null
  output_tokens: number | null; was_holdout: boolean | null; created_at: string
}

export interface DayPoint { day: string; saved: number }


export default async function SavingsPage() {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const tz    = ctx.timezone
  const win   = resolveWindow(undefined, tz, { defaultDays: 30 })
  const since = zonedDayStartIso(win.from, tz)

  // Only rows that carry savings columns (a small subset) are read raw, by keyset;
  // total spend comes from the rollups.
  const [{ data: events }, summary] = await Promise.all([
    selectAll<SavingsRow>(() => admin
      .from('usage_events')
      .select('id, model, cost_usd, baseline_cost_usd, input_tokens_saved, output_tokens, was_holdout, created_at')
      .eq('org_id', orgId)
      .gte('created_at', since)
      .or('was_holdout.eq.true,baseline_cost_usd.gt.0,input_tokens_saved.gt.0')),
    dashSummary(admin, orgId, win.from, win.to),
  ])

  const rows = events ?? []
  const optimized = rows.filter(r => !r.was_holdout)
  const holdout   = rows.filter(r => r.was_holdout)

  // Input savings are recorded per-request (baseline - actual cost).
  let inputCostSaved = 0, inputTokensSaved = 0
  const byDay = new Map<string, number>()
  for (const r of optimized) {
    const s = Math.max(0, Number(r.baseline_cost_usd ?? 0) - Number(r.cost_usd ?? 0))
    inputCostSaved += s
    inputTokensSaved += Number(r.input_tokens_saved ?? 0)
    const d = toZonedDate(r.created_at, tz); byDay.set(d, (byDay.get(d) ?? 0) + s)
  }

  // Output savings are MEASURED by comparing optimized vs holdout output length.
  const avg = (a: typeof rows) => a.length ? a.reduce((s, r) => s + Number(r.output_tokens ?? 0), 0) / a.length : 0
  const avgOptimized = avg(optimized)
  const avgHoldout   = avg(holdout)
  const measured = holdout.length >= 20 && avgHoldout > 0
  const outputSavingsPct = measured ? Math.max(0, (avgHoldout - avgOptimized) / avgHoldout) : null

  let outputTokensSaved = 0, outputCostSaved = 0
  if (measured && outputSavingsPct) {
    const perReqTokens = avgHoldout - avgOptimized
    outputTokensSaved = Math.round(perReqTokens * optimized.length)
    for (const r of optimized) outputCostSaved += perReqTokens * outPrice(r.model) / 1e6
  }

  const days: DayPoint[] = summary.series.map(p => ({ day: p.day, saved: +(byDay.get(p.day) ?? 0).toFixed(4) }))

  // Rate is measured against everything the org actually spent in the window,
  // not just the savings rows (compress rows carry $0 cost, which made it 100%).
  const actualCost = summary.cost_usd
  const totalCostSaved = inputCostSaved + outputCostSaved
  const savingsRate = actualCost + totalCostSaved > 0 ? totalCostSaved / (actualCost + totalCostSaved) : 0

  return (
    <SavingsClient
      hasData={rows.length > 0}
      costSaved={+totalCostSaved.toFixed(4)}
      inputCostSaved={+inputCostSaved.toFixed(4)}
      outputCostSaved={+outputCostSaved.toFixed(4)}
      tokensSaved={inputTokensSaved + outputTokensSaved}
      inputTokensSaved={inputTokensSaved}
      outputTokensSaved={outputTokensSaved}
      savingsRate={+(savingsRate * 100).toFixed(1)}
      outputSavingsPct={outputSavingsPct == null ? null : +(outputSavingsPct * 100).toFixed(1)}
      measured={measured}
      optimizedRequests={optimized.length}
      holdoutRequests={holdout.length}
      days={days}
      windowLabel={win.label}
    />
  )
}
