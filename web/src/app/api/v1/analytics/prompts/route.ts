/**
 * GET /api/v1/analytics/prompts?org_id=xxx&days=30
 *
 * Returns the top prompt patterns for an org, grouped by prompt_hash.
 * Privacy-safe: only prompt hash + char count is stored, never raw text.
 *
 * Response shape:
 * {
 *   data: PromptPattern[]
 *   meta: { total_requests: number; days: number }
 * }
 */
import { NextResponse }               from 'next/server'
import type { NextRequest }           from 'next/server'
import { createAdminClient }          from '@/lib/supabase/server'
import { requireOrgMemberWithRole, dbError } from '@/lib/api/auth'

export interface PromptPattern {
  hash:               string
  count:              number
  total_cost_usd:     number
  avg_cost_usd:       number
  avg_input_tokens:   number
  avg_output_tokens:  number
  io_ratio:           number | null   // input/output ratio — high = verbose prompt
  avg_latency_ms:     number | null
  p95_latency_ms:     number | null
  prompt_chars:       number
  top_model:          string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const orgId = searchParams.get('org_id')
  const days  = Math.min(90, Math.max(1, parseInt(searchParams.get('days') ?? '30')))

  const guard = await requireOrgMemberWithRole(orgId)
  if (guard instanceof NextResponse) return guard

  const admin = createAdminClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data: rows, error } = await admin
    .from('usage_events')
    .select('model, cost_usd, metadata, created_at')
    .eq('org_id', orgId!)
    .gte('created_at', since)
    .not('metadata', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5_000) // cap to prevent huge in-process aggregation

  if (error) return dbError(error, 'GET analytics/prompts')

  // ── Aggregate by prompt_hash ──────────────────────────────────────────────
  type Agg = {
    hash:        string
    count:       number
    totalCost:   number
    totalInput:  number
    totalOutput: number
    latencies:   number[]
    models:      Record<string, number>
    promptChars: number
  }

  const byHash = new Map<string, Agg>()
  let totalRequests = 0

  for (const row of rows ?? []) {
    totalRequests++
    const meta = row.metadata as Record<string, unknown> | null
    const hash = meta?.prompt_hash as string | undefined
    if (!hash) continue

    const existing = byHash.get(hash) ?? {
      hash,
      count:       0,
      totalCost:   0,
      totalInput:  0,
      totalOutput: 0,
      latencies:   [],
      models:      {},
      promptChars: Number(meta?.prompt_chars ?? 0),
    }

    existing.count++
    existing.totalCost   += Number(row.cost_usd ?? 0)
    existing.totalInput  += Number(meta?.input_tokens  ?? 0)
    existing.totalOutput += Number(meta?.output_tokens ?? 0)

    const lat = Number(meta?.latency_ms ?? 0)
    if (lat > 0) existing.latencies.push(lat)

    const m = row.model ?? 'unknown'
    existing.models[m] = (existing.models[m] ?? 0) + 1

    byHash.set(hash, existing)
  }

  // ── Shape results ────────────────────────────────────────────────────────
  const results: PromptPattern[] = Array.from(byHash.values())
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 100)
    .map((p): PromptPattern => {
      const sorted = [...p.latencies].sort((a, b) => a - b)
      const p95idx = Math.floor(sorted.length * 0.95)

      const avgLatency = sorted.length > 0
        ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length)
        : null

      const p95Latency = sorted.length > 0 ? (sorted[p95idx] ?? null) : null

      const ioRatio = p.totalOutput > 0
        ? +((p.totalInput / p.totalOutput).toFixed(1))
        : null

      const topModel = (Object.entries(p.models) as [string, number][])
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'

      return {
        hash:              p.hash,
        count:             p.count,
        total_cost_usd:    +p.totalCost.toFixed(4),
        avg_cost_usd:      +(p.totalCost / p.count).toFixed(6),
        avg_input_tokens:  Math.round(p.totalInput  / p.count),
        avg_output_tokens: Math.round(p.totalOutput / p.count),
        io_ratio:          ioRatio,
        avg_latency_ms:    avgLatency,
        p95_latency_ms:    p95Latency,
        prompt_chars:      p.promptChars,
        top_model:         topModel,
      }
    })

  return NextResponse.json({
    data: results,
    meta: { total_requests: totalRequests, days },
  })
}
