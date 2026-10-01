import Link from 'next/link'
import { PromptText } from '@/components/dashboard/prompt-text'
import { createAdminClient }  from '@/lib/supabase/server'
import { requireOrgContext }  from '@/lib/org-context'
import { promptScope }        from '@/lib/rbac'
import type { DashPrompt }    from '@/lib/rollups'
import {
  resolveWindow, resolveUserScope, scopedSummary, scopedPrompts, eventScopeOr, zonedDayStartIso, sourceLabel, memberEmailMap,
} from '@/lib/rollup-scope'
import { PromptsClient }       from './_client'
import type { PromptPattern }  from '@/app/api/v1/analytics/prompts/route'
import { inputPrice, outputPrice, priceFor } from '@/lib/mcp/pricing'
import { selectAll } from '@/lib/supabase/paginate'

// Cheapest capable model used as the "could you route down?" reference —
// priced from the same table as ingest (lib/mcp/pricing.ts).
const CHEAP_REF = priceFor('claude-haiku-4-5')
const CHEAP_IN = CHEAP_REF.in, CHEAP_OUT = CHEAP_REF.out

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
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PromptsAnalyticsPage({ searchParams }: { searchParams?: Promise<{ days?: string }> }) {
  const ctx   = await requireOrgContext()
  const admin = createAdminClient()
  const orgId = ctx.orgId
  const win   = resolveWindow(await searchParams, ctx.timezone, { defaultDays: 30, allowed: [7, 30, 90] })
  // Members & viewers only ever see their own prompts; owners & admins see everyone's.
  const scope = await resolveUserScope(admin, promptScope(ctx.role, ctx.user.id), ctx.user.email)
  const since = zonedDayStartIso(win.from, ctx.timezone)

  // Totals + the top prompts come from the rollups; pattern analysis (grouping by
  // prompt text fingerprint, latency percentiles) needs the raw rows that carry
  // a prompt_hash, read with keyset pagination.
  type EventRow = {
    id: string; created_at: string
    model: string | null; cost_usd: number | null; input_tokens: number | null; output_tokens: number | null
    cache_read_tokens: number | null; cache_write_tokens: number | null; latency_ms: number | null
    prompt_hash: string | null; prompt_preview: string | null; prompt_chars: number | null
  }
  const EVENT_COLS = 'id, created_at, model, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, prompt_hash, prompt_preview, prompt_chars'
  const [summary, top, { data: rows }, emails] = await Promise.all([
    scopedSummary(admin, orgId, win.from, win.to, scope),
    scopedPrompts(admin, orgId, win.from, win.to, scope, undefined, { limit: 25, order: 'cost' }),
    selectAll<EventRow>(() => {
      let q = admin.from('usage_events').select(EVENT_COLS)
        .eq('org_id', orgId).gte('created_at', since).not('prompt_hash', 'is', null)
      if (scope) q = q.or(eventScopeOr(scope))
      return q
    }),
    memberEmailMap(admin, orgId),
  ])

  // Context tokens = fresh input + cache reads/writes (what the model actually read).
  const ctxTokens = (r: EventRow) => Number(r.input_tokens ?? 0) + Number(r.cache_read_tokens ?? 0) + Number(r.cache_write_tokens ?? 0)

  type Agg = {
    hash: string; count: number; totalCost: number
    totalInput: number; totalOutput: number
    latencies: number[]; models: Record<string, number>
    promptChars: number; promptPreview: string | null
  }

  const byHash = new Map<string, Agg>()
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

  // Captured prompt text (SDK prompt_text, or CLI-agent user_prompt events) —
  // scoped: a member sees captures they made or that belong to their prompts.
  const CAP_COLS = 'id, model, prompt_hash, prompt_text, response_text, input_tokens, output_tokens, cost_usd, created_at'
  type Capture = { id: string; model: string | null; prompt_hash: string | null; prompt_text: string; response_text: string | null; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string }
  let capturedRaw: Capture[]
  const topKeys = top.rows.map(p => p.prompt_key)
  if (!scope) {
    const { data } = await admin.from('prompt_captures').select(CAP_COLS).eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(50)
    capturedRaw = (data ?? []) as Capture[]
  } else {
    const [{ data: mine }, { data: ofMine }] = await Promise.all([
      admin.from('prompt_captures').select(CAP_COLS).eq('org_id', orgId).eq('user_id', scope.userId)
        .order('created_at', { ascending: false }).limit(50),
      topKeys.length
        ? admin.from('prompt_captures').select(CAP_COLS).eq('org_id', orgId).in('prompt_hash', topKeys)
          .order('created_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [] as Capture[] }),
    ])
    const seen = new Set<string>()
    capturedRaw = [...(mine ?? []), ...(ofMine ?? [])]
      .filter(c => !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50) as Capture[]
  }

  // Use captured text as the preview for patterns / top prompts that have none.
  const textByHash = new Map<string, string>()
  for (const c of capturedRaw) if (c.prompt_hash && c.prompt_text) textByHash.set(c.prompt_hash, c.prompt_text)
  for (const a of Array.from(byHash.values())) {
    if (!a.promptPreview && textByHash.has(a.hash)) {
      const t = textByHash.get(a.hash)!
      a.promptPreview = t.slice(0, 120)
      a.promptChars = a.promptChars || t.length
    }
  }

  // A CLI-agent prompt row carries no tokens/cost itself — they arrive on the
  // api_request events that share its prompt id. Join them here.
  const topByKey = new Map(top.rows.map(p => [p.prompt_key, p]))
  const captured = capturedRaw.map(c => {
    const hasOwn = Number(c.cost_usd ?? 0) > 0 || Number(c.input_tokens ?? 0) + Number(c.output_tokens ?? 0) > 0
    const agg = c.prompt_hash ? byHash.get(c.prompt_hash) : undefined
    const tp  = c.prompt_hash ? topByKey.get(c.prompt_hash) : undefined
    if (hasOwn) return { ...c, model: c.model ?? '—', calls: 1 }
    if (agg) {
      const topModel = Object.entries(agg.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      return { ...c, model: topModel, input_tokens: agg.totalInput, output_tokens: agg.totalOutput, cost_usd: +agg.totalCost.toFixed(6), calls: agg.count }
    }
    if (tp) return { ...c, model: tp.model || '—', input_tokens: tp.total_tokens, output_tokens: 0, cost_usd: tp.cost_usd, calls: tp.requests }
    return { ...c, model: c.model ?? '—', calls: 0 }
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

  // prompt id → its session, so each prompt links to the full view in its session.
  const linkKeys = Array.from(new Set([...topKeys, ...capturedRaw.map(c => c.prompt_hash).filter((h): h is string => !!h)]))
  const sessionByKey = new Map<string, string>()
  for (let i = 0; i < linkKeys.length; i += 200) {
    const { data } = await admin.from('usage_events').select('correlation_id, session_id')
      .eq('org_id', orgId).in('correlation_id', linkKeys.slice(i, i + 200)).not('session_id', 'is', null).limit(1000)
    for (const e of data ?? []) if (e.correlation_id && e.session_id && !sessionByKey.has(e.correlation_id)) sessionByKey.set(e.correlation_id, e.session_id)
  }

  const hashedRequests = rows.length
  const scopeNote = scope ? 'Showing your prompts only — owners and admins see everyone\'s.' : null

  return (
    <>
      <PromptsClient
        patterns={patterns}
        orgId={orgId}
        windowLabel={win.label}
        scopeNote={scopeNote}
        prompts={summary.prompts}
        totalRequests={summary.requests}
        hashedRequests={hashedRequests}
        totalCost={+summary.cost_usd.toFixed(4)}
        meteredCost={summary.metered_cost_usd}
        notionalCost={summary.notional_cost_usd}
        avgLatencyMs={summary.avg_latency_ms == null ? null : Math.round(summary.avg_latency_ms)}
      />
      <TopPrompts rows={top.rows} total={top.total} preview={textByHash} emails={emails} windowLabel={win.label} sessions={sessionByKey} />
      <CapturedPrompts rows={captured} sessions={sessionByKey} />
    </>
  )
}

const sessionHref = (session: string, key: string) =>
  `/dashboard/sessions/${encodeURIComponent(session)}#prompt-${encodeURIComponent(key)}`

function TopPrompts({ rows, total, preview, emails, windowLabel, sessions }: { rows: DashPrompt[]; total: number; preview: Map<string, string>; emails: Map<string, string>; windowLabel: string; sessions: Map<string, string> }) {
  if (rows.length === 0) return null
  return (
    <div className="mt-8">
      <div className="mb-1 text-[15px] font-bold text-[var(--fg)]">Top prompts by cost</div>
      <p className="mb-3 text-[12.5px] text-[var(--fg-secondary)]">
        One prompt = everything a person asked once (all its LLM calls). {windowLabel} · {rows.length} of {total.toLocaleString()} prompts.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg-secondary)] text-[var(--fg-tertiary)]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Prompt</th>
              <th className="px-3 py-2 text-left font-medium">User</th>
              <th className="px-3 py-2 text-left font-medium">Model · source</th>
              <th className="px-3 py-2 text-right font-medium">LLM calls</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.prompt_key} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 max-w-[280px] truncate text-[var(--fg)]" title={preview.get(p.prompt_key) ?? p.prompt_key}>
                  {sessions.get(p.prompt_key)
                    ? <Link href={sessionHref(sessions.get(p.prompt_key)!, p.prompt_key)} className="hover:underline">
                        {preview.get(p.prompt_key) ? clipText(preview.get(p.prompt_key)!, 90) : <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{p.prompt_key.slice(0, 18)}</span>}
                      </Link>
                    : preview.get(p.prompt_key) ? clipText(preview.get(p.prompt_key)!, 90) : <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{p.prompt_key.slice(0, 18)}</span>}
                </td>
                <td className="px-3 py-2 max-w-[180px] truncate text-[var(--fg-secondary)]">{emails.get(p.user_key) ?? (p.user_key || '—')}</td>
                <td className="px-3 py-2 whitespace-nowrap text-[var(--fg-secondary)]">{p.model || '—'} · {sourceLabel(p.source)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.requests.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.total_tokens.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{usd(p.cost_usd)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap text-[var(--fg-tertiary)]">{new Date(p.last_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const clipText = (s: string | null, n: number) => !s ? '' : s.length > n ? s.slice(0, n) + '…' : s
const usd = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`

function CapturedPrompts({ rows, sessions }: { rows: Array<{ id: string; model: string; prompt_hash: string | null; prompt_text: string; response_text: string | null; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; calls: number }>; sessions: Map<string, string> }) {
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
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate"><span className="font-medium text-[var(--fg)]">{r.model || 'Prompt'}</span> <span className="text-[var(--fg-secondary)]">— {clipText(r.prompt_text.replace(/\s+/g, ' '), 100)}</span></span>
                <span className="text-[var(--fg-tertiary)]">{(Number(r.input_tokens) + Number(r.output_tokens)).toLocaleString()} tok · {usd(Number(r.cost_usd))}{r.calls > 1 ? ` · ${r.calls} calls` : ''} · {new Date(r.created_at).toLocaleString()}</span>
              </summary>
              <div className="mt-3 space-y-2">
                <PromptText label="Prompt" text={r.prompt_text} />
                {r.prompt_hash && sessions.get(r.prompt_hash) && (
                  <Link href={sessionHref(sessions.get(r.prompt_hash)!, r.prompt_hash)} className="inline-block text-[12px] font-medium text-teal hover:underline">
                    Open in its session →
                  </Link>
                )}
                {r.response_text && <PromptText label="Response" text={r.response_text} />}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
