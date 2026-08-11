/**
 * OTLP/HTTP trace ingest — TokenFin as an OpenTelemetry backend.
 *
 * Accepts OTLP JSON (POST) and reads GenAI semantic-convention attributes
 * (gen_ai.request.model, gen_ai.usage.input_tokens/output_tokens, cache/reasoning
 * tokens) to populate `spans` + `traces`, and mirrors LLM spans into
 * usage_events/usage_agg so cost analytics reflect OTEL traffic.
 *
 * Auth: `x-api-key: tfk_…` (LangSmith-style) OR `Authorization: Bearer tfk_…`.
 * Requires migration 017. Any OTLP exporter can point here — no SDK needed.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { computeCost } from '@/lib/mcp/pricing'
import { readOtlp } from '@/lib/otlp/decode'
import { detectSource } from '@/lib/otlp/mapping'

interface KeyCtx { orgId: string; projectId: string | null; keyId: string; userId: string | null }

async function auth(req: NextRequest): Promise<KeyCtx | null> {
  const raw = req.headers.get('x-api-key')
    || (req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7).trim() : '')
  if (!raw) return null
  const keyHash = crypto.createHash('sha256').update(raw).digest('hex')
  const { data } = await createAdminClient()
    .from('api_keys').select('id, org_id, project_id, user_id, is_active, expires_at').eq('key_hash', keyHash).maybeSingle()
  if (!data || !data.is_active) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return { orgId: data.org_id, projectId: data.project_id ?? null, keyId: data.id, userId: data.user_id ?? null }
}

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

const nanoToIso = (n: string | number | undefined) =>
  n ? new Date(Number(n) / 1e6).toISOString() : null

export async function POST(req: NextRequest) {
  const ctx = await auth(req)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: any
  try { body = await readOtlp(req, 'traces') } catch { return NextResponse.json({ error: 'invalid OTLP body' }, { status: 400 }) }

  const admin = createAdminClient()
  const spanRows: any[] = []
  const usageRows: any[] = []
  const traceIds = new Set<string>()

  for (const rs of body.resourceSpans ?? []) {
    const resAttrs = attrsToMap(rs.resource?.attributes ?? [])
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        const a = attrsToMap(sp.attributes)
        const source = detectSource(resAttrs, sp.name ?? '')
        const model = (a['gen_ai.request.model'] ?? a['gen_ai.response.model']) as string | undefined
        const inTok  = Number(a['gen_ai.usage.input_tokens'] ?? a['gen_ai.usage.prompt_tokens'] ?? 0)
        const outTok = Number(a['gen_ai.usage.output_tokens'] ?? a['gen_ai.usage.completion_tokens'] ?? 0)
        const kind = (a['gen_ai.operation.name'] as string) ?? sp.name ?? 'span'
        const cost = model ? computeCost(model, inTok, outTok) : 0
        const traceId = sp.traceId, spanId = sp.spanId
        if (!traceId || !spanId) continue
        traceIds.add(traceId)

        spanRows.push({
          span_id: spanId, trace_id: traceId, parent_span_id: sp.parentSpanId || null,
          org_id: ctx.orgId, name: sp.name ?? kind, kind, model: model ?? null,
          input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok, cost_usd: cost,
          start_time: nanoToIso(sp.startTimeUnixNano), end_time: nanoToIso(sp.endTimeUnixNano),
          attributes: a,
        })

        if (model && (inTok + outTok) > 0) {
          usageRows.push({
            org_id: ctx.orgId, project_id: ctx.projectId, api_key_id: ctx.keyId, user_id: ctx.userId, model,
            input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok, cost_usd: cost,
            source, tags: { source }, metadata: { trace_id: traceId, span_id: spanId },
          })
        }
      }
    }
  }

  if (spanRows.length === 0) return NextResponse.json({ partialSuccess: {} })

  // Persist spans, mirror LLM usage, then roll up trace aggregates from stored spans.
  await admin.from('spans').upsert(spanRows, { onConflict: 'span_id' })
  if (usageRows.length) await admin.from('usage_events').insert(usageRows)

  const bucket = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  for (const u of usageRows) {
    try {
      await admin.rpc('upsert_usage_agg', {
        p_org_id: u.org_id, p_project_id: u.project_id, p_model: u.model,
        p_bucket: bucket, p_tokens: u.total_tokens, p_cost: u.cost_usd, p_requests: 1,
      })
    } catch { /* best-effort aggregate */ }
  }

  for (const traceId of Array.from(traceIds)) {
    const { data: sps } = await admin.from('spans')
      .select('total_tokens, cost_usd, start_time, end_time, name, parent_span_id').eq('trace_id', traceId)
    const rows = sps ?? []
    const root = rows.find(r => !r.parent_span_id) ?? rows[0]
    await admin.from('traces').upsert({
      trace_id: traceId, org_id: ctx.orgId, project_id: ctx.projectId,
      name: root?.name ?? 'trace',
      start_time: rows.map(r => r.start_time).filter(Boolean).sort()[0] ?? null,
      end_time: rows.map(r => r.end_time).filter(Boolean).sort().pop() ?? null,
      span_count: rows.length,
      total_tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
      cost_usd: +rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0).toFixed(8),
    }, { onConflict: 'trace_id' })
  }

  // OTLP success response shape.
  return NextResponse.json({ partialSuccess: {} })
}
