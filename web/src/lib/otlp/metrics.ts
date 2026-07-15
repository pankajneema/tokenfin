/**
 * Derive per-turn usage rows from OTLP METRICS (Codex, Gemini).
 *
 * These agents report tokens only as metric counters — usually CUMULATIVE
 * (monotonically growing totals). Persisting a cumulative value as-is would
 * count the running total as one turn; persisting every export would count the
 * same tokens repeatedly. So we diff each series against its last-seen value:
 *
 *   - first time we see a series → store the baseline, emit NOTHING (we can't
 *     know how much of the total is "new")
 *   - later → delta = current − last-seen; emit only the delta; a drop (counter
 *     reset) emits nothing
 *   - DELTA temporality → the value IS the interval, emit directly
 *
 * This is safe-by-construction: it never double-counts and never invents tokens.
 * It may miss the first interval after a fresh connect (baseline), which is
 * acceptable and preferable to over-billing.
 *
 * Claude Code metrics are NOT processed here (its logs already own those rows).
 */
import crypto from 'crypto'
import { attrsToMap, num } from './attrs'
import { tokenFieldFor, deriveSourceFor, costBasisFor, isDeltaTemporality, type TokenField } from './mapping'
import { computeCost } from '@/lib/mcp/pricing'
import type { KeyCtx } from './auth'
import type { UsageRow } from './normalize'

// Last-seen cumulative value per metric series. DB-backed in the route; a Map in
// tests. Scoped per-org by the caller, so keys need not include the org.
export interface MetricState {
  get(key: string): Promise<number | null>
  set(key: string, value: number): Promise<void>
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const zeroTokens = (): Record<TokenField, number> => ({
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0,
})

interface Group { source: string; model: string; correlation: string | null; timeNano: string; tokens: Record<TokenField, number> }

export interface DeriveResult { rows: UsageRow[]; skippedFirstSeen: number }

export async function deriveMetricEvents(body: any, ctx: KeyCtx, state: MetricState): Promise<DeriveResult> {
  const groups = new Map<string, Group>()
  let skippedFirstSeen = 0

  for (const rm of body?.resourceMetrics ?? []) {
    const resAttrs = attrsToMap(rm?.resource?.attributes ?? [])
    for (const sm of rm?.scopeMetrics ?? []) {
      for (const m of sm?.metrics ?? []) {
        const name = String(m?.name ?? '')
        const source = deriveSourceFor(name)
        if (!source) continue                    // claude_code + non-token metrics: not derived here

        const sum = m?.sum
        const dps: any[] = sum?.dataPoints ?? m?.gauge?.dataPoints ?? []
        const isDelta = !!sum && isDeltaTemporality(sum.aggregationTemporality)

        for (const dp of dps) {
          const a = attrsToMap(dp?.attributes ?? [])
          const type = a['type'] ?? a['gen_ai.token.type']
          const field = tokenFieldFor(type)
          if (!field) continue                   // unknown token type
          const value = num(dp?.asInt ?? dp?.asDouble)
          const model = String(a['model'] ?? a['gen_ai.request.model'] ?? resAttrs['gen_ai.request.model'] ?? 'unknown')
          const correlation = (a['conversation.id'] ?? a['gen_ai.conversation.id'] ?? a['session.id'] ?? null) as string | null
          const timeNano = String(dp?.timeUnixNano ?? '')

          let contribution: number
          if (isDelta) {
            contribution = value
          } else {
            const seriesKey = `${name}|${model}|${correlation ?? ''}|${String(type)}`
            const prev = await state.get(seriesKey)
            await state.set(seriesKey, value)
            if (prev == null) { skippedFirstSeen++; continue }   // baseline only
            contribution = value - prev
            if (contribution <= 0) continue                       // no growth / counter reset
          }
          if (contribution <= 0) continue

          const gk = `${source}|${model}|${correlation ?? ''}|${timeNano}`
          let g = groups.get(gk)
          if (!g) { g = { source, model, correlation, timeNano, tokens: zeroTokens() }; groups.set(gk, g) }
          g.tokens[field] += contribution
        }
      }
    }
  }

  const rows: UsageRow[] = []
  for (const g of Array.from(groups.values())) {
    const t = g.tokens
    const total = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens + t.reasoning_tokens
    if (total <= 0) continue
    const ts = g.timeNano ? new Date(Number(g.timeNano) / 1e6).toISOString() : new Date().toISOString()
    const cost = computeCost(g.model, t.input_tokens + t.cache_read_tokens + t.cache_write_tokens, t.output_tokens)
    rows.push({
      event_id: sha(`${g.source}|${g.correlation ?? ''}|${g.model}|${g.timeNano}`),
      ts, source: g.source, provider_request_id: null, correlation_id: g.correlation, model: g.model,
      input_tokens: t.input_tokens, output_tokens: t.output_tokens,
      cache_read_tokens: t.cache_read_tokens, cache_write_tokens: t.cache_write_tokens, reasoning_tokens: t.reasoning_tokens,
      cost_usd: +cost.toFixed(8), cost_basis: costBasisFor(g.source),
      user_email: null, session_id: g.correlation,
    })
  }
  return { rows, skippedFirstSeen }
}
