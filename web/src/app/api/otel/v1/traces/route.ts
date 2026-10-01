/**
 * OTLP/HTTP trace ingest — TokenFin as an OpenTelemetry backend.
 *
 * Accepts OTLP JSON / protobuf (optionally gzip) spans and reads GenAI usage
 * with the versioned mapping in lib/otlp/genai.ts — OpenTelemetry GenAI semantic
 * conventions, OpenLLMetry and OpenInference attribute dialects. Every span is
 * stored in `spans`; `traces` rows are recomputed in SQL (refresh_traces,
 * migration 018); LEAF LLM spans from generic apps are mirrored into
 * usage_events (+ usage_agg, org time zone) so cost analytics include them.
 *
 *  - Leaf rule: a span whose child also carries usage is an aggregate and is
 *    not mirrored (no double counting of agent → chain → chat parents).
 *  - CLI-agent spans (Claude Code, Codex, Gemini CLI, OpenCode) are stored but
 *    never mirrored — their logs / metrics already own that usage.
 *  - Priced with the org's overrides, else lib/mcp/pricing.ts list prices.
 *  - Prompt / completion content attributes are dropped when the org has
 *    prompt capture off; all string attributes are redacted (lib/redact.ts).
 *  - Idempotent: spans upsert on (org, trace, span); usage rows dedupe on
 *    event_id `span:<org>:<trace>:<span>` — an exporter retry is a no-op.
 *
 * Auth: shared `authOtlp` — `Authorization: Bearer tfk_…` or `x-api-key: tfk_…`
 * (key must carry the ingest/write scope).
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { readBodyCapped, gunzipCapped } from '@/lib/otlp/decode'
import { authOtlp, resolveMemberIds } from '@/lib/otlp/auth'
import { resolveProjectId, upsertUsageEvents, upsertAggBatch, promptCaptureAllowed, PersistError } from '@/lib/otlp/persist'
import { badBody, ok, retryLater, unauthorized } from '@/lib/otlp/respond'
import { getOrgPrices } from '@/lib/pricing-overrides'
import { parseTraceRequest } from '@/lib/otlp/genai'
import { decodeTraceRequest } from '@/lib/otlp/traces-proto'
import { dedupeSpans, mirrorable, parentKey, priceSpans, rowsForCapture, spanRow, usageRowFor } from '@/lib/otlp/traces'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SPAN_CHUNK = 500

async function readTraceBody(req: NextRequest): Promise<any> {
  let buf = await readBodyCapped(req)
  if ((req.headers.get('content-encoding') || '').toLowerCase().includes('gzip')) buf = gunzipCapped(buf)
  const ct = (req.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('protobuf')) return decodeTraceRequest(buf)
  return JSON.parse(new TextDecoder().decode(buf))
}

export async function POST(req: NextRequest) {
  let ctx
  try { ctx = await authOtlp(req) } catch (e: any) { return retryLater('auth', e?.message ?? String(e)) }
  if (!ctx) return unauthorized()

  let body: any
  try { body = await readTraceBody(req) } catch (e) { return badBody(e) }

  const parsed = dedupeSpans(parseTraceRequest(body, { capturePrompts: promptCaptureAllowed(ctx) }))
  if (parsed.length === 0) return ok()

  const admin = createAdminClient()
  const [projectId, orgPrices, members] = await Promise.all([
    resolveProjectId(admin, ctx),
    getOrgPrices(admin, ctx.orgId),
    // A personal key names its user; a shared key attributes by the span's email.
    ctx.userId ? Promise.resolve(new Map<string, string>()) : resolveMemberIds(admin, ctx.orgId, parsed.map(s => s.usage.userEmail)),
  ])
  const userIdOf = (email: string | null) => ctx.userId ?? (email ? members.get(email) ?? null : null)
  const spans = priceSpans(parsed, orgPrices)

  // 1. Spans (tenant-scoped key, idempotent) at the org's capture level:
  //    'errors' (default) keeps full detail only for traces with an error or
  //    warning, plus a cost-only skeleton of token-bearing spans; 'all' keeps everything.
  const capture = ctx.traceCapture ?? 'errors'
  const rows = rowsForCapture(spans, spans.map(s => spanRow(ctx.orgId, s, userIdOf(s.usage.userEmail))), capture)
  // Full rows upsert (a replay refreshes them); skeletons never overwrite an existing row.
  for (const [part, ignoreDuplicates] of [[rows.filter(r => r.detail), false], [rows.filter(r => !r.detail), true]] as const) {
    for (let i = 0; i < part.length; i += SPAN_CHUNK) {
      const { error } = await admin.from('spans').upsert(part.slice(i, i + SPAN_CHUNK), { onConflict: 'org_id,trace_id,span_id', ignoreDuplicates })
      if (error) return retryLater('spans upsert', `${error.message}${/column/.test(error.message) ? ' (apply migrations 018 and 025)' : ''}`)
    }
  }

  // 2. Aggregates: spans that parent a token-bearing span, across every stored
  //    span of the touched traces (children usually arrive first).
  const traceIds = Array.from(new Set(spans.map(s => s.traceId)))
  const { data: parents, error: parentErr } = await admin.rpc('trace_usage_parents', { p_org: ctx.orgId, p_trace_ids: traceIds })
  if (parentErr) return retryLater('trace_usage_parents', parentErr.message)
  const usageParents = new Set(((parents ?? []) as Array<{ trace_id: string; span_id: string }>).map(p => parentKey(p.trace_id, p.span_id)))

  // 3. Mirror leaf LLM spans into usage_events (+ metered usage_agg, org-local day).
  const mirror = mirrorable(spans, usageParents)
  if (mirror.length) {
    const usageRows = mirror.map(s => usageRowFor(ctx, projectId, s, userIdOf(s.usage.userEmail)))
    try {
      const inserted = await upsertUsageEvents(admin, usageRows)
      const fresh = new Set(inserted.map(i => i.event_id))
      await upsertAggBatch(admin, ctx.orgId, ctx.timezone, usageRows.filter(u => fresh.has(u.event_id as string)).map(u => ({
        project_id: u.project_id as string | null, model: u.model as string, created_at: u.created_at as string,
        total_tokens: u.total_tokens as number, cost_usd: u.cost_usd as number, cost_basis: u.cost_basis as string,
      })))
    } catch (e: any) {
      if (e instanceof PersistError) return retryLater('usage_events upsert', e.message)
      throw e
    }
  }

  // 4. Trace rollups (leaf usage only, errors, models, user, service) in SQL.
  const { error: traceErr } = await admin.rpc('refresh_traces', { p_org: ctx.orgId, p_trace_ids: traceIds, p_project: projectId })
  if (traceErr) return retryLater('refresh_traces', traceErr.message)
  // traces.detail: does this trace have any fully kept span (the Traces page lists only those).
  const { error: detailErr } = await admin.rpc('tf_mark_trace_detail', { p_org: ctx.orgId, p_trace_ids: traceIds })
  if (detailErr && !/tf_mark_trace_detail/.test(detailErr.message)) console.warn('[otlp/traces] detail flag:', detailErr.message)

  return ok()
}
