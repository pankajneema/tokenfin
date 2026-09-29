import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SavingsClient } from './_client'
import { outputPrice as outPrice } from '@/lib/mcp/pricing'
import { selectAll } from '@/lib/supabase/paginate'

export const metadata = { title: 'Savings — TokenFin' }

type SavingsRow = {
  model: string; cost_usd: number | null; baseline_cost_usd: number | null; input_tokens_saved: number | null
  output_tokens: number | null; was_holdout: boolean | null; created_at: string
}

export interface DayPoint { day: string; saved: number }

const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export default async function SavingsPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  // Gateway-sourced events carry the savings columns.
  const { data: events } = await selectAll<SavingsRow>(() => admin
    .from('usage_events')
    .select('model, cost_usd, baseline_cost_usd, input_tokens_saved, output_tokens, was_holdout, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since)
    .or('was_holdout.eq.true,baseline_cost_usd.gt.0,input_tokens_saved.gt.0'))

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
    const d = istDate(new Date(r.created_at)); byDay.set(d, (byDay.get(d) ?? 0) + s)
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

  const days: DayPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const d = istDate(new Date(Date.now() - i * 864e5))
    days.push({ day: d, saved: +(byDay.get(d) ?? 0).toFixed(4) })
  }

  // Rate is measured against everything the org actually spent in the window,
  // not just the savings rows (compress rows carry $0 cost, which made it 100%).
  const { data: spendRows } = await selectAll<{ cost_usd: number | null }>(() => admin
    .from('usage_events').select('cost_usd').eq('org_id', orgId).gte('created_at', since))
  const actualCost = spendRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
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
    />
  )
}
