/**
 * OTLP/HTTP trace ingest — TokenFin as an OpenTelemetry backend.
 *
 * Accepts OTLP JSON (POST) and reads GenAI semantic-convention attributes
 * (gen_ai.request.model, gen_ai.usage.input_tokens/output_tokens, cache/reasoning
 * tokens) to populate `spans` + `traces`, and mirrors LLM spans into
 * usage_events/usage_agg so cost analytics reflect OTEL traffic.
 *
 * Auth: shared `authOtlp` — `x-api-key: tfk_…` OR `Authorization: Bearer tfk_…`
 * (key must carry the 'write' scope).
 * Requires migration 017. Any OTLP exporter can point here — no SDK needed.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { computeCost } from '@/lib/mcp/pricing'
import { readOtlp } from '@/lib/otlp/decode'
import { authOtlp } from '@/lib/otlp/auth'
import { costBasisFor, detectSource } from '@/lib/otlp/mapping'

// OTLP attribute value → JS primitive.
function attrVal(v: any): unknown {
  if (!v) return undefined
  if (v.stringValue !== undefined) return v.stringValue
  if (v.intValue !== undefined) return Number(v.intValue)
  if (v.doubleValue !== undefined) return v.doubleValue
  if (v.boolValue !== undefined) return v.boolValue
  return undefined
}
const attrsToMap = (arr: any[]): Record<string, unknown> =>
  Object.fromEntries((arr ?? []).map(a => [a.key, attrVal(a.value)]))

const nanoToIso = (n: string | number | undefined) => {
  if (!n) return null
  const d = new Date(Number(n) / 1e6)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const num = (v: unknown) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// IST bucket — matches the ingest + analytics convention so days don't split.
const istBucket = (isoTs: string) =>
  new Date(new Date(isoTs).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)

// 503 tells OTLP exporters to retry; every write below is idempotent so a retry
// cannot double-count.
function persistFailed(stage: string, message: string) {
  console.error(`[otel/traces] ${stage} failed:`, message)
  return NextResponse.json({ error: 'temporarily unable to persist spans' }, { status: 503, headers: { 'Retry-After': '5' } })
}

export async function POST(req: NextRequest) {
  const ctx = await authOtlp(req)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: any
  try { body = await readOtlp(req, 'traces') } catch { return NextResponse.json({ error: 'invalid OTLP body' }, { status: 400 }) }

  const admin = createAdminClient()
  // usage_agg.project_id is NOT NULL: fall back to the org's first project, as
  // the logs/metrics receivers do.
  let projectId = ctx.projectId
  if (!projectId) {
    const { data: proj } = await admin.from('projects').select('id').eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    projectId = (proj?.id as string | undefined) ?? null
  }
  const spanRows: any[] = []
  const usageRows: any[] = []
  const traceIds = new Set<string>()

  for (const rs of body.resourceSpans ?? []) {
    const resAttrs = attrsToMap(rs.resource?.attributes ?? [])
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        const traceId = sp.traceId, spanId = sp.spanId
        if (!traceId || !spanId || typeof traceId !== 'string' || typeof spanId !== 'string') continue
        const a = attrsToMap(sp.attributes)
        const source = detectSource(resAttrs, sp.name ?? '')
        const model = (a['gen_ai.request.model'] ?? a['gen_ai.response.model']) as string | undefined
        const inTok  = num(a['gen_ai.usage.input_tokens'] ?? a['gen_ai.usage.prompt_tokens'])
        const outTok = num(a['gen_ai.usage.output_tokens'] ?? a['gen_ai.usage.completion_tokens'])
        const cacheRead  = num(a['gen_ai.usage.cache_read_input_tokens'] ?? a['gen_ai.usage.cache_read_tokens'])
        const cacheWrite = num(a['gen_ai.usage.cache_creation_input_tokens'] ?? a['gen_ai.usage.cache_write_tokens'])
        const kind = (a['gen_ai.operation.name'] as string) ?? sp.name ?? 'span'
        const cost = model ? computeCost(model, inTok, outTok, cacheRead, cacheWrite) : 0
        const startIso = nanoToIso(sp.startTimeUnixNano)
        const endIso = nanoToIso(sp.endTimeUnixNano)
        traceIds.add(traceId)

        spanRows.push({
          span_id: spanId, trace_id: traceId, parent_span_id: sp.parentSpanId || null,
          org_id: ctx.orgId, name: sp.name ?? kind, kind, model: model ?? null,
          input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok, cost_usd: cost,
          start_time: startIso, end_time: endIso,
          attributes: a,
        })

        if (model && (inTok + outTok) > 0) {
          // Anthropic reports cache tokens outside input_tokens (same rule as persist.ts).
          const total = inTok + outTok + (source === 'claude_code' ? cacheRead + cacheWrite : 0)
          // CLI agents report subscription usage (notional); a generic OTLP
          // app span is a real API call (metered).
          const costBasis = source === 'otlp' ? 'metered' : costBasisFor(source)
          usageRows.push({
            org_id: ctx.orgId, project_id: projectId, api_key_id: ctx.keyId, user_id: ctx.userId, model,
            input_tokens: inTok, output_tokens: outTok, total_tokens: total, cost_usd: cost,
            cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite,
            created_at: endIso ?? startIso ?? new Date().toISOString(),
            event_id: `span:${ctx.orgId}:${traceId}:${spanId}`,
            source, mode: 'push', cost_basis: costBasis,
            tags: { source }, metadata: { trace_id: traceId, span_id: spanId },
          })
        }
      }
    }
  }

  if (spanRows.length === 0) return NextResponse.json({ partialSuccess: {} })

  // Persist spans (tenant-scoped key), mirror LLM usage idempotently, then roll
  // up trace aggregates from this org's stored spans.
  const { error: spanErr } = await admin.from('spans').upsert(spanRows, { onConflict: 'org_id,trace_id,span_id' })
  if (spanErr) return persistFailed('spans upsert', spanErr.message)

  if (usageRows.length) {
    const { data: inserted, error: usageErr } = await admin.from('usage_events')
      .upsert(usageRows, { onConflict: 'event_id', ignoreDuplicates: true }).select('event_id')
    if (usageErr) return persistFailed('usage_events upsert', usageErr.message)

    // Only freshly inserted, metered rows roll into usage_agg (no cost_basis
    // column there) — a retry/replay never double-counts.
    const fresh = new Set((inserted ?? []).map((r: { event_id: string }) => r.event_id))
    for (const u of usageRows) {
      if (!fresh.has(u.event_id) || u.cost_basis === 'notional' || !u.project_id) continue
      const { error: aggErr } = await admin.rpc('upsert_usage_agg', {
        p_org_id: u.org_id, p_project_id: u.project_id, p_model: u.model,
        p_bucket: istBucket(u.created_at), p_tokens: u.total_tokens, p_cost: u.cost_usd, p_requests: 1,
      })
      // The event row is already stored; a retry would skip it as a duplicate,
      // so an aggregate failure is logged rather than turned into a 503.
      if (aggErr) console.error('[otel/traces] usage_agg upsert failed:', aggErr.message)
    }
  }

  for (const traceId of Array.from(traceIds)) {
    const { data: sps, error: selErr } = await admin.from('spans')
      .select('total_tokens, cost_usd, start_time, end_time, name, parent_span_id')
      .eq('org_id', ctx.orgId).eq('trace_id', traceId)
    if (selErr) return persistFailed('spans rollup read', selErr.message)
    const rows = sps ?? []
    const root = rows.find(r => !r.parent_span_id) ?? rows[0]
    const { error: traceErr } = await admin.from('traces').upsert({
      trace_id: traceId, org_id: ctx.orgId, project_id: projectId,
      name: root?.name ?? 'trace',
      start_time: rows.map(r => r.start_time).filter(Boolean).sort()[0] ?? null,
      end_time: rows.map(r => r.end_time).filter(Boolean).sort().pop() ?? null,
      span_count: rows.length,
      total_tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
      cost_usd: +rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0).toFixed(8),
    }, { onConflict: 'org_id,trace_id' })
    if (traceErr) return persistFailed('traces upsert', traceErr.message)
  }

  // OTLP success response shape.
  return NextResponse.json({ partialSuccess: {} })
}
