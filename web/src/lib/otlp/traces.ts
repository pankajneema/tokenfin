/**
 * Trace receiver building blocks (pure, unit-tested): span rows, the leaf rule
 * for the usage mirror, and the usage_events rows for mirrored spans.
 *
 * Leaf rule: a span carrying token usage whose child also carries usage is an
 * aggregate (agent / chain / workflow summing its calls) — mirroring both would
 * count the same tokens twice. Only leaves are mirrored. OTel SDKs export a span
 * when it ENDS, so children normally reach us before (or with) their parent;
 * the check therefore runs against every stored span of the trace.
 * CLI-agent spans (Claude Code, Codex, Gemini CLI, OpenCode) are never
 * mirrored: their OTLP logs / metrics own those rows.
 */
import type { KeyCtx } from './auth'
import type { ParsedSpan } from './genai'
import type { OrgModelPrice } from '@/lib/pricing-overrides'
import { priceWithOverrides } from '@/lib/pricing-overrides'

export interface PricedSpan extends ParsedSpan { cost: number; priceKnown: boolean }

/** Price every span with usage (org override → list price, lib/mcp/pricing.ts). */
export function priceSpans(spans: ParsedSpan[], prices: OrgModelPrice[]): PricedSpan[] {
  return spans.map(s => {
    const u = s.usage
    if (!u.model || u.total <= 0) return { ...s, cost: 0, priceKnown: true }
    const p = priceWithOverrides(prices, u.model, { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite })
    return { ...s, cost: p.cost, priceKnown: p.priceKnown }
  })
}

/** Keep the last copy of a span sent twice in one export (upsert can't touch a row twice). */
export function dedupeSpans<T extends ParsedSpan>(spans: T[]): T[] {
  const m = new Map<string, T>()
  for (const s of spans) m.set(`${s.traceId}|${s.spanId}`, s)
  return Array.from(m.values())
}

export function spanRow(orgId: string, s: PricedSpan, userId: string | null): Record<string, unknown> {
  const u = s.usage
  return {
    org_id: orgId, trace_id: s.traceId, span_id: s.spanId, parent_span_id: s.parentSpanId,
    name: s.name, kind: u.operation ?? s.name, model: u.model, provider: u.provider, operation: u.operation,
    span_kind: s.spanKind, service_name: s.service, status_code: s.statusCode, status_message: s.statusMessage,
    input_tokens: u.input, output_tokens: u.output, cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite,
    reasoning_tokens: u.reasoning, total_tokens: u.total, cost_usd: s.cost,
    start_time: s.startIso, end_time: s.endIso, duration_ms: s.durationMs,
    user_id: userId, user_email: u.userEmail, session_id: u.sessionId,
    attributes: s.attributes,
  }
}

/**
 * Rows to store under the org's trace capture level.
 *   'all'    — every span in full.
 *   'errors' — full detail for every span of a trace that has an error or warning
 *              span in this export; for other traces only a cost skeleton of the
 *              token-bearing spans (ids, parent, model, tokens, cost, timing — no
 *              attributes, no status text) so leaf detection across exports and
 *              cost stay exact; spans with neither are dropped.
 */
export function rowsForCapture<T extends Record<string, unknown>>(
  spans: Array<{ traceId: string; problem: 'error' | 'warning' | null; usage: { total: number }; source?: string }>,
  rows: T[],
  capture: 'errors' | 'all',
): Array<T & { detail: boolean }> {
  const problemTraces = new Set(spans.filter(s => s.problem).map(s => s.traceId))
  const out: Array<T & { detail: boolean }> = []
  spans.forEach((s, i) => {
    // A coding agent's OWN internal tracing (OpenCode exports every SQL query,
    // session lookup and HTTP call when OTEL_EXPORTER_OTLP_ENDPOINT is set) is
    // noise: its usage comes from logs / metrics / the plugin. Keep only its
    // problem traces, whatever the capture level.
    const agentNoise = !!s.source && s.source !== 'otlp' && !problemTraces.has(s.traceId) && s.usage.total <= 0
    if (agentNoise) return
    if (capture === 'all' || problemTraces.has(s.traceId)) out.push({ ...rows[i], detail: true })
    else if (s.usage.total > 0) out.push({ ...rows[i], attributes: {}, status_message: null, user_email: null, detail: false })
  })
  return out
}

/** "trace|span" keys of spans that parent a token-bearing span. */
export const parentKey = (traceId: string, spanId: string) => `${traceId}|${spanId}`

/**
 * Spans to mirror into usage_events: leaf, has a model + tokens, from a generic
 * app (CLI-agent spans — Claude Code, Codex, Gemini CLI, OpenCode — are skipped:
 * their logs / metrics already own that usage).
 */
export function mirrorable<T extends ParsedSpan>(spans: T[], usageParents: Set<string>): T[] {
  return spans.filter(s => s.usage.model && s.usage.total > 0 && s.source === 'otlp'
    && !usageParents.has(parentKey(s.traceId, s.spanId)))
}

export const spanEventId = (orgId: string, s: Pick<ParsedSpan, 'traceId' | 'spanId'>) => `span:${orgId}:${s.traceId}:${s.spanId}`

/**
 * usage_events row for a mirrored span. A generic OTLP app span is a real API
 * call → metered. correlation_id = the trace, so one trace counts as one prompt
 * (lib/prompts.ts) however many LLM calls it made.
 */
export function usageRowFor(ctx: KeyCtx, projectId: string | null, s: PricedSpan, userId: string | null): Record<string, unknown> {
  const u = s.usage
  return {
    org_id: ctx.orgId, project_id: projectId, api_key_id: ctx.keyId,
    user_id: userId, user_email: u.userEmail,
    model: u.model, input_tokens: u.input, output_tokens: u.output, total_tokens: u.total,
    cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite, reasoning_tokens: u.reasoning,
    cost_usd: s.cost, latency_ms: s.durationMs != null ? Math.round(s.durationMs) : null,
    created_at: s.endIso ?? s.startIso ?? new Date().toISOString(),
    event_id: spanEventId(ctx.orgId, s),
    source: 'otlp', mode: 'push', cost_basis: 'metered',
    provider: u.provider, session_id: u.sessionId, correlation_id: `trace:${s.traceId}`,
    tool_name: s.service ?? 'otlp',
    tags: { source: 'otlp', tool: s.service ?? 'otlp', provider: u.provider, ...(s.priceKnown ? {} : { price_known: 'false' }) },
    metadata: {
      otlp: true, trace_id: s.traceId, span_id: s.spanId, operation: u.operation, service: s.service,
      input_tokens: u.input, output_tokens: u.output, session_id: u.sessionId, user_email: u.userEmail,
      source: 'otlp', provider: u.provider, latency_ms: s.durationMs,
    },
  }
}
