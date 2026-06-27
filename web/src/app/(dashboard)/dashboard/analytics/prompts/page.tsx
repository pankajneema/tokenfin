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

  // Captured full prompts (opt-in via gateway CAPTURE_PROMPTS=1; migration 014).
  const { data: captured } = await admin
    .from('prompt_captures')
    .select('id, model, prompt_text, response_text, input_tokens, output_tokens, cost_usd, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <>
      <PromptsClient
        patterns={patterns}
        orgId={orgId}
        totalRequests={totalRequests}
        hashedRequests={hashedRequests}
        totalCost={+totalCost.toFixed(4)}
        avgLatencyMs={globalAvgLatency}
      />
      <CapturedPrompts rows={captured ?? []} />
    </>
  )
}

const clipText = (s: string | null, n: number) => !s ? '' : s.length > n ? s.slice(0, n) + '…' : s
const usd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`

function CapturedPrompts({ rows }: { rows: Array<{ id: string; model: string; prompt_text: string; response_text: string | null; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string }> }) {
  return (
    <div className="mt-8">
      <div className="mb-1 text-[15px] font-bold text-[var(--fg)]">Captured prompts</div>
      <p className="mb-3 text-[12.5px] text-[var(--fg-secondary)]">
        Full prompt text routed through the gateway.{rows.length === 0 ? ' Opt-in: run the gateway with CAPTURE_PROMPTS=1.' : ''}
      </p>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-[12.5px] text-[var(--fg-tertiary)]">
          No captured prompts yet.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <details key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <summary className="flex cursor-pointer items-center justify-between text-[12.5px]">
                <span className="font-medium text-[var(--fg)]">{r.model}</span>
                <span className="text-[var(--fg-tertiary)]">{r.input_tokens + r.output_tokens} tok · {usd(Number(r.cost_usd))} · {new Date(r.created_at).toLocaleString()}</span>
              </summary>
              <div className="mt-3 space-y-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase text-[var(--fg-tertiary)]">Prompt</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] text-[var(--fg)]">{clipText(r.prompt_text, 8000)}</pre>
                </div>
                {r.response_text && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase text-[var(--fg-tertiary)]">Response</div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--bg-tertiary)] p-3 font-mono text-[11px] text-[var(--fg)]">{clipText(r.response_text, 8000)}</pre>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
