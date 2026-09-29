import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { dashSummary, dashBreakdown } from '@/lib/rollups'
import { resolveWindow } from '@/lib/rollup-scope'
import { priceFor } from '@/lib/mcp/pricing'
import { getOrgPrices, matchOverride } from '@/lib/pricing-overrides'
import { ModelsClient }       from './_client'
import type { ModelRow }      from './_client'

export const metadata = { title: 'By Model — TokenFin Analytics' }
export const dynamic = 'force-dynamic'
export const revalidate = 0

function guessProvider(name: string) {
  if (name.startsWith('claude'))  return 'Anthropic'
  if (name.startsWith('gpt') || /^o\d/.test(name)) return 'OpenAI'
  if (name.startsWith('gemini')) return 'Google'
  return 'Other'
}

const COLORS = ['#D97757','#E8896A','#10A37F','#F0AC8A','#0D8A6A','#4285F4','#669DF6','#6B7280']

export default async function ModelsAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(await searchParams, ctx.timezone, { defaultDays: 30, allowed: [7, 30, 90] })

  const [summary, cur, prev, overrides] = await Promise.all([
    dashSummary(admin, orgId, win.from, win.to),
    dashBreakdown(admin, orgId, win.from, win.to, 'model', undefined, 200),
    dashBreakdown(admin, orgId, win.prevFrom, win.prevTo, 'model', undefined, 200),
    getOrgPrices(admin, orgId),
  ])
  const prevMap = new Map(prev.rows.map(r => [r.key, r]))

  const models: ModelRow[] = cur.rows.map((r, i) => {
    const name = r.key || 'unknown'
    const p    = prevMap.get(r.key)
    // One price source: the org's override (longest prefix) else the list price
    // in lib/mcp/pricing.ts — the same rates ingest used to price these rows.
    const o    = matchOverride(overrides, name)
    const list = priceFor(name)
    // Cache tokens are context the model read: count them as input.
    const inTok = r.input_tokens + r.cache_read_tokens + r.cache_write_tokens
    return {
      id:           name,
      name,
      provider:     guessProvider(name),
      color:        COLORS[i % COLORS.length],
      priceIn:      o ? o.input_per_m  : list.in,
      priceOut:     o ? o.output_per_m : list.out,
      priceSource:  o ? 'override' : list.known ? 'list' : 'unknown',
      // Effective rate actually paid (all tokens incl. cache) — measured.
      costPer1M:    r.total_tokens > 0 ? +(r.cost_usd / r.total_tokens * 1e6).toFixed(4) : 0,
      avgLatencyMs: r.avg_latency_ms,
      cost30d:      r.cost_usd,
      metered:      r.metered_cost_usd,
      notional:     r.notional_cost_usd,
      costPrev:     p?.cost_usd ?? 0,
      inputTok:     inTok / 1_000_000,
      outputTok:    r.output_tokens / 1_000_000,
      calls30d:     r.requests,
      callsPrev:    p?.requests ?? 0,
    }
  })

  return (
    <ModelsClient
      models={models}
      days={win.days}
      windowLabel={win.label}
      totalPrompts={summary.prompts}
      meteredCost={summary.metered_cost_usd}
      notionalCost={summary.notional_cost_usd}
    />
  )
}
