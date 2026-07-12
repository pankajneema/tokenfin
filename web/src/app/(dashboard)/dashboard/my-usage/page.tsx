import { createClient, createAdminClient } from '@/lib/supabase/server'
import { MyUsageClient } from './_client'

export const metadata = { title: 'My Usage — TokenFin' }

// Always render fresh — usage data changes on every ingest / record_usage call.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface ModelSlice { model: string; cost: number; tokens: number; requests: number }
export interface DayPoint   { day: string; cost: number }
export interface PromptRow  { hash: string; cost: number; requests: number; model: string }

const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

export default async function MyUsagePage() {
  const supabase = createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email?.split('@')[0] ?? 'you'

  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

  const since = new Date(Date.now() - 30 * 864e5).toISOString()
  const { data: events } = await admin
    .from('usage_events')
    .select('model, total_tokens, cost_usd, created_at, metadata, baseline_cost_usd, input_tokens_saved, output_tokens_saved, was_holdout')
    .eq('org_id', orgId)
    .eq('user_id', user!.id)
    .gte('created_at', since)
    .limit(50_000)

  const rows = events ?? []
  let totalCost = 0, totalTokens = 0
  const byModel = new Map<string, ModelSlice>()
  const byDay   = new Map<string, number>()
  const byPrompt = new Map<string, PromptRow>()

  for (const e of rows) {
    const cost = Number(e.cost_usd ?? 0), tok = Number(e.total_tokens ?? 0)
    totalCost += cost; totalTokens += tok
    const m = byModel.get(e.model) ?? { model: e.model, cost: 0, tokens: 0, requests: 0 }
    m.cost += cost; m.tokens += tok; m.requests += 1; byModel.set(e.model, m)
    const day = istDate(new Date(e.created_at)); byDay.set(day, (byDay.get(day) ?? 0) + cost)
    const ph = (e.metadata as Record<string, unknown> | null)?.prompt_hash as string | undefined
    if (ph) { const p = byPrompt.get(ph) ?? { hash: ph, cost: 0, requests: 0, model: e.model }; p.cost += cost; p.requests += 1; byPrompt.set(ph, p) }
  }

  // Build a continuous 30-day series (zero-filled) for a clean trend.
  const days: DayPoint[] = []
  for (let i = 29; i >= 0; i--) {
    const day = istDate(new Date(Date.now() - i * 864e5))
    days.push({ day, cost: +(byDay.get(day) ?? 0).toFixed(4) })
  }

  const models  = Array.from(byModel.values()).sort((a, b) => b.cost - a.cost)
  const prompts = Array.from(byPrompt.values()).sort((a, b) => b.cost - a.cost).slice(0, 8)

  // Savings (gateway-attributed): per-request measurable input savings.
  let costSaved = 0, tokensSaved = 0, holdoutCount = 0
  for (const e of rows) {
    if (e.was_holdout) { holdoutCount++; continue }
    costSaved += Math.max(0, Number(e.baseline_cost_usd ?? 0) - Number(e.cost_usd ?? 0))
    tokensSaved += Number(e.input_tokens_saved ?? 0) + Number(e.output_tokens_saved ?? 0)
  }
  const savingsRate = totalCost + costSaved > 0 ? +((costSaved / (totalCost + costSaved)) * 100).toFixed(1) : 0

  return (
    <MyUsageClient
      name={displayName}
      totalCost={+totalCost.toFixed(4)}
      totalTokens={totalTokens}
      requests={rows.length}
      models={models}
      days={days}
      prompts={prompts}
      costSaved={+costSaved.toFixed(4)}
      tokensSaved={tokensSaved}
      savingsRate={savingsRate}
      savingsMeasured={holdoutCount >= 20}
    />
  )
}
