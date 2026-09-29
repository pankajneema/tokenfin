/**
 * GET /api/v1/analytics/prompts?org_id=xxx&days=30
 *
 * Returns the top prompt patterns for an org, grouped by prompt_hash.
 * Session or Bearer read key. Members / viewers (and keys they own) only see
 * their own prompts (guard.scopeUserId); owners / admins see the whole org.
 * total_requests comes from the rollups; patterns need the raw hashed rows.
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
import { requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { selectAll } from '@/lib/supabase/paginate'
import { getOrgTimezone } from '@/lib/org-timezone'
import {
  MAX_WINDOW_DAYS, resolveWindow, resolveUserScope, scopedSummary, eventScopeOr, zonedDayStartIso,
} from '@/lib/rollup-scope'

export interface PromptPattern {
  hash:               string
  count:              number
  total_cost_usd:     number
  avg_cost_usd:       number
  avg_input_tokens:   number
  avg_output_tokens:  number
  io_ratio:           number | null
  avg_latency_ms:     number | null
  p95_latency_ms:     number | null
  prompt_chars:       number
  prompt_preview:     string | null   // first 120 chars of last user message
  top_model:          string
  // Efficiency rating + savings (computed in the page; optional for API callers)
  rating?:            'A' | 'B' | 'C' | 'D' | 'F'
  rating_score?:      number           // 0–100
  rating_reason?:     string | null
  savings_usd?:       number           // est. monthly $ recoverable on this pattern
  savings_hint?:      string | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days  = Math.min(MAX_WINDOW_DAYS, Math.max(1, parseInt(searchParams.get('days') ?? '30') || 30))

  // Members / viewers (and their API keys) only see their own prompts.
  const guard = await requireApiKeyOrOrgMember(req, searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const orgId = guard.orgId

  const admin = createAdminClient()
  const scope = await resolveUserScope(admin, guard.scopeUserId)
  const tz    = await getOrgTimezone(orgId)
  const win   = resolveWindow({ days: String(days) }, tz)
  const since = zonedDayStartIso(win.from, tz)

  type Row = {
    id: string; created_at: string; model: string | null; cost_usd: number | null
    input_tokens: number | null; output_tokens: number | null; latency_ms: number | null
    prompt_hash: string | null; prompt_preview: string | null; prompt_chars: number | null
    metadata: Record<string, unknown> | null
  }
  let rows: Row[], totalRequests: number
  try {
    const [summary, res] = await Promise.all([
      scopedSummary(admin, orgId, win.from, win.to, scope, guard.projectId ? { project_id: guard.projectId } : undefined),
      selectAll<Row>(() => {
        let q = admin.from('usage_events')
          .select('id, created_at, model, cost_usd, input_tokens, output_tokens, latency_ms, prompt_hash, prompt_preview, prompt_chars, metadata')
          .eq('org_id', orgId)
          .gte('created_at', since)
          .or('prompt_hash.not.is.null,metadata->>prompt_hash.not.is.null')
        if (guard.projectId) q = q.eq('project_id', guard.projectId)
        if (scope) q = q.or(eventScopeOr(scope))
        return q
      }),
    ])
    rows = res.data
    totalRequests = summary.requests
  } catch (error) {
    return dbError(error, 'GET analytics/prompts')
  }

  // ── Aggregate by prompt_hash (column, else legacy metadata.prompt_hash) ──
  type Agg = {
    hash:          string
    count:         number
    totalCost:     number
    totalInput:    number
    totalOutput:   number
    latencies:     number[]
    models:        Record<string, number>
    promptChars:   number
    promptPreview: string | null
  }

  const byHash = new Map<string, Agg>()
  for (const row of rows) {
    const meta = row.metadata
    const hash = row.prompt_hash ?? (meta?.prompt_hash as string | undefined)
    if (!hash) continue
    const preview = row.prompt_preview ?? (meta?.prompt_preview as string | undefined) ?? null
    const existing = byHash.get(hash) ?? {
      hash, count: 0, totalCost: 0, totalInput: 0, totalOutput: 0, latencies: [], models: {},
      promptChars:   Number(row.prompt_chars ?? meta?.prompt_chars ?? 0),
      promptPreview: preview,
    }
    existing.count++
    existing.totalCost   += Number(row.cost_usd ?? 0)
    existing.totalInput  += Number(row.input_tokens  ?? meta?.input_tokens  ?? 0)
    existing.totalOutput += Number(row.output_tokens ?? meta?.output_tokens ?? 0)
    if (!existing.promptPreview && preview) existing.promptPreview = preview
    const lat = Number(row.latency_ms ?? meta?.latency_ms ?? 0)
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
      const avgLatency = sorted.length > 0 ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : null
      const p95Latency = sorted.length > 0 ? (sorted[p95idx] ?? null) : null
      const ioRatio = p.totalOutput > 0 ? +((p.totalInput / p.totalOutput).toFixed(1)) : null
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
        prompt_preview:    p.promptPreview ?? null,
        top_model:         topModel,
      }
    })

  return NextResponse.json({
    data: results,
    meta: { total_requests: totalRequests, days: win.days, from: win.from, to: win.to, scope: scope ? 'self' : 'org' },
  })
}
