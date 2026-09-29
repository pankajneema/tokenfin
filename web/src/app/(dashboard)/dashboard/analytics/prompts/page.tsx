import { createClient }       from '@/lib/supabase/server'
import { createAdminClient }  from '@/lib/supabase/server'
import { PromptsClient }       from './_client'
import type { PromptPattern }  from '@/app/api/v1/analytics/prompts/route'
import { inputPrice, outputPrice } from '@/lib/mcp/pricing'
import { selectAll } from '@/lib/supabase/paginate'

// Cheapest capable tier used as the "could you route down?" reference.
const CHEAP_IN = 0.8, CHEAP_OUT = 4 // ~Haiku / gpt-4o-mini class, per 1M

// Efficiency rating (A–F) + a REAL dollar savings estimate per prompt pattern.
// Cost-first heuristic: reward tight I/O, penalise premium models doing short
// work and context bloat — the two most common, fixable sources of LLM waste.
function rate(p: PromptPattern): Pick<PromptPattern, 'rating' | 'rating_score' | 'rating_reason' | 'savings_usd' | 'savings_hint'> {
  const m = p.top_model
  const premium = /opus|sonnet|gpt-4o(?!-mini)|gemini-1\.5-pro/.test(m)
  const curPerCall = (p.avg_input_tokens * inputPrice(m) + p.avg_output_tokens * outputPrice(m)) / 1e6

  let score = 100
  let reason = 'Efficient'
  let savings_usd = 0
  let savings_hint: string | null = null

  // 1) Premium model doing short outputs → route down.
  if (premium && p.avg_output_tokens > 0 && p.avg_output_tokens < 120) {
    const cheapPerCall = (p.avg_input_tokens * CHEAP_IN + p.avg_output_tokens * CHEAP_OUT) / 1e6
    if (cheapPerCall < curPerCall) {
      savings_usd = +((curPerCall - cheapPerCall) * p.count).toFixed(2)
      savings_hint = `Short outputs on a premium model — routing to a cheaper tier saves ~$${savings_usd}`
      reason = 'Over-powered model for short output'
      score -= 30
    }
  }
  // 2) Context bloat (huge input vs output) → cache / compress.
  if ((p.io_ratio ?? 0) > 15) {
    score -= 22
    reason = reason === 'Efficient' ? 'Context-heavy — cache or compress the prompt' : reason
    if (!savings_hint) savings_hint = 'Very high input:output — enable prompt caching or compress context'
  } else if ((p.io_ratio ?? 0) > 5) {
    score -= 8
  }
  // 3) Raw context size.
  if (p.avg_input_tokens > 60_000) { score -= 12; if (reason === 'Efficient') reason = 'Large context per call' }
  // 4) Very low output at volume → likely errors/refusals (paying for nothing).
  if (p.avg_output_tokens < 20 && p.count >= 5) { score -= 10; if (reason === 'Efficient') reason = 'Very short outputs — possible errors/refusals' }

  score = Math.max(0, Math.min(100, score))
  const rating = (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F') as PromptPattern['rating']
  return { rating, rating_score: score, rating_reason: reason, savings_usd, savings_hint }
}

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

  // Every event in the window (no row cap), grouped by the prompt_hash column.
  type EventRow = {
    model: string | null; cost_usd: number | null; input_tokens: number | null; output_tokens: number | null
    cache_read_tokens: number | null; cache_write_tokens: number | null; latency_ms: number | null
    prompt_hash: string | null; prompt_preview: string | null; prompt_chars: number | null
  }
  const EVENT_COLS = 'model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, prompt_hash, prompt_preview, prompt_chars'
  const { data: rows } = await selectAll<EventRow>(() => admin
    .from('usage_events')
    .select(EVENT_COLS)
    .eq('org_id', orgId)
    .gte('created_at', since30))

  // Context tokens = fresh input + cache reads/writes (what the model actually read).
  const ctxTokens = (r: EventRow) => Number(r.input_tokens ?? 0) + Number(r.cache_read_tokens ?? 0) + Number(r.cache_write_tokens ?? 0)

  type Agg = {
    hash: string; count: number; totalCost: number
    totalInput: number; totalOutput: number
    latencies: number[]; models: Record<string, number>
    promptChars: number; promptPreview: string | null
  }

  const byHash = new Map<string, Agg>()
  const totalRequests = rows.length

  for (const row of rows) {
    const hash = row.prompt_hash
    if (!hash) continue
    const ex = byHash.get(hash) ?? {
      hash, count: 0, totalCost: 0, totalInput: 0, totalOutput: 0,
      latencies: [], models: {}, promptChars: Number(row.prompt_chars ?? 0),
      promptPreview: row.prompt_preview ?? null,
    }
    ex.count++
    ex.totalCost   += Number(row.cost_usd ?? 0)
    ex.totalInput  += ctxTokens(row)
    ex.totalOutput += Number(row.output_tokens ?? 0)
    if (!ex.promptPreview && row.prompt_preview) ex.promptPreview = row.prompt_preview
    const lat = Number(row.latency_ms ?? 0)
    if (lat > 0) ex.latencies.push(lat)
    const m = row.model ?? 'unknown'
    ex.models[m] = (ex.models[m] ?? 0) + 1
    byHash.set(hash, ex)
  }

  // Captured prompt text (SDK prompt_text, or CLI-agent user_prompt events).
  const { data: capturedRaw } = await admin
    .from('prompt_captures')
    .select('id, model, prompt_hash, prompt_text, response_text, input_tokens, output_tokens, cost_usd, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  // Use captured text as the preview for patterns that have none.
  const textByHash = new Map<string, string>()
  for (const c of capturedRaw ?? []) if (c.prompt_hash && c.prompt_text) textByHash.set(c.prompt_hash, c.prompt_text)
  for (const a of Array.from(byHash.values())) {
    if (!a.promptPreview && textByHash.has(a.hash)) {
      const t = textByHash.get(a.hash)!
      a.promptPreview = t.slice(0, 120)
      a.promptChars = a.promptChars || t.length
    }
  }

  // A CLI-agent prompt row carries no tokens/cost itself — they arrive on the
  // api_request events that share its prompt id. Join them here.
  const captured = (capturedRaw ?? []).map(c => {
    const agg = c.prompt_hash ? byHash.get(c.prompt_hash) : undefined
    const hasOwn = Number(c.cost_usd ?? 0) > 0 || Number(c.input_tokens ?? 0) + Number(c.output_tokens ?? 0) > 0
    if (hasOwn || !agg) return { ...c, model: c.model ?? '—', calls: hasOwn ? 1 : 0 }
    const topModel = Object.entries(agg.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    return {
      ...c,
      model: topModel,
      input_tokens: agg.totalInput,
      output_tokens: agg.totalOutput,
      cost_usd: +agg.totalCost.toFixed(6),
      calls: agg.count,
    }
  })

  const patterns: PromptPattern[] = Array.from(byHash.values())
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 100)
    .map(p => {
      const sorted = [...p.latencies].sort((a, b) => a - b)
      const avg = sorted.length ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : null
      const p95 = sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] ?? null) : null
      const topModel = (Object.entries(p.models) as [string, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
      const base: PromptPattern = {
        hash:              p.hash,
        count:             p.count,
        total_cost_usd:    +p.totalCost.toFixed(6),
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
      return { ...base, ...rate(base) }
    })

  // Summary stats over ALL fingerprinted requests, not just the top 100 patterns.
  const allAggs = Array.from(byHash.values())
  const hashedRequests = allAggs.reduce((s, p) => s + p.count, 0)
  const totalCost = allAggs.reduce((s, p) => s + p.totalCost, 0)
  const allLat = allAggs.flatMap(p => p.latencies)
  const globalAvgLatency = allLat.length
    ? Math.round(allLat.reduce((s, v) => s + v, 0) / allLat.length)
    : null

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

function CapturedPrompts({ rows }: { rows: Array<{ id: string; model: string; prompt_text: string; response_text: string | null; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; calls: number }> }) {
  return (
    <div className="mt-8">
      <div className="mb-1 text-[15px] font-bold text-[var(--fg)]">Captured prompts</div>
      <p className="mb-3 text-[12.5px] text-[var(--fg-secondary)]">
        Full prompt text with the tokens and cost it generated. Captured from SDK <code>prompt_text</code> and from Claude Code / Codex / Gemini prompt events (enabled by <code>tokenfin setup</code>).
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
                <span className="text-[var(--fg-tertiary)]">{(Number(r.input_tokens) + Number(r.output_tokens)).toLocaleString()} tok · {usd(Number(r.cost_usd))}{r.calls > 1 ? ` · ${r.calls} calls` : ''} · {new Date(r.created_at).toLocaleString()}</span>
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
