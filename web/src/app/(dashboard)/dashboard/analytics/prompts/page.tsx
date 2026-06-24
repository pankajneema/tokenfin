import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { PromptsClient }       from './_client'
import type { PromptPattern }  from '@/app/api/v1/analytics/prompts/route'

export { type PromptPattern } from '@/app/api/v1/analytics/prompts/route'

export const metadata = { title: 'Prompt Analytics — TokenFin' }

export default async function PromptsAnalyticsPage() {
  const supabase = createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: _mb } = await admin
    .from('members').select('org_id').eq('user_id', user.id).limit(1)
  const orgId = _mb?.[0]?.org_id ?? ''

  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()

  // Fetch usage events with prompt metadata for last 30 days
  const { data: rows } = await admin
    .from('usage_events')
    .select('model, cost_usd, metadata, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since30)
    .not('metadata', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5_000)

  // ── Aggregate server-side (same logic as API route) ──────────────────────
  type Agg = {
    hash: string; count: number; totalCost: number
    totalInput: number; totalOutput: number
    latencies: number[]; models: Record<string, number>
    promptChars: number; promptPreview: string | null
  }

  const byHash = new Map<string, Agg>()
  let totalRequests = 0

  for (const row of rows ?? []) {
    totalRequests++
    const meta = row.metadata as Record<string, unknown> | null
    const hash = meta?.prompt_hash as string | undefined
    if (!hash) continue

    const ex = byHash.get(hash) ?? {
      hash, count: 0, totalCost: 0, totalInput: 0, totalOutput: 0,
      latencies: [], models: {}, promptChars: Number(meta?.prompt_chars ?? 0),
      promptPreview: (meta?.prompt_preview as string | undefined) ?? null,
    }
    ex.count++
    ex.totalCost   += Number(row.cost_usd ?? 0)
    ex.totalInput  += Number(meta?.input_tokens  ?? 0)
    ex.totalOutput += Number(meta?.output_tokens ?? 0)
    if (!ex.promptPreview && meta?.prompt_preview) {
      ex.promptPreview = meta.prompt_preview as string
    }
    const lat = Number(meta?.latency_ms ?? 0)
    if (lat > 0) ex.latencies.push(lat)
    const m = row.model ?? 'unknown'
    ex.models[m] = (ex.models[m] ?? 0) + 1
    byHash.set(hash, ex)
  }

  const patterns: PromptPattern[] = Array.from(byHash.values())
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 100)
    .map(p => {
      const sorted = [...p.latencies].sort((a, b) => a - b)
      const avg = sorted.length ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : null
      const p95 = sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] ?? null) : null
      const topModel = (Object.entries(p.models) as [string, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
      return {
        hash:              p.hash,
        count:             p.count,
        total_cost_usd:    +p.totalCost.toFixed(4),
        avg_cost_usd:      +(p.totalCost / p.count).toFixed(6),
        avg_input_tokens:  Math.round(p.totalInput  / p.count),
        avg_output_tokens: Math.round(p.totalOutput / p.count),
        io_ratio:          p.totalOutput > 0 ? +((p.totalInput / p.totalOutput).toFixed(1)) : null,
        avg_latency_ms:    avg,
        p95_latency_ms:    p95,
        prompt_chars:      p.promptChars,
        prompt_preview:    p.promptPreview ?? null,
        top_model:         topModel,
      }
    })

  // Summary stats
  const hashedRequests = Array.from(byHash.values()).reduce((s, p) => s + p.count, 0)
  const totalCost = patterns.reduce((s, p) => s + p.total_cost_usd, 0)
  const avgLatAll = patterns.flatMap(p => p.avg_latency_ms ?? [])
  const globalAvgLatency = avgLatAll.length
    ? Math.round(avgLatAll.reduce((s, v) => s + v, 0) / avgLatAll.length)
    : null

  return (
    <PromptsClient
      patterns={patterns}
      orgId={orgId}
      totalRequests={totalRequests}
      hashedRequests={hashedRequests}
      totalCost={+totalCost.toFixed(4)}
      avgLatencyMs={globalAvgLatency}
    />
  )
}
