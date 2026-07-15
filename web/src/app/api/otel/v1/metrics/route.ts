/**
 * OTLP/HTTP metrics receiver.
 *
 * Two jobs:
 *  1. Health — validate temporality (warn on delta) and flag unrecognized
 *     metric names, never a silent drop.
 *  2. Capture for Codex/Gemini — those agents report per-turn tokens ONLY as
 *     metric counters (no per-turn logs). We derive rows by diffing each series
 *     against its last-seen value (see lib/otlp/metrics.ts). Claude Code metrics
 *     are deliberately NOT derived — its logs already own those rows.
 *
 * Accepts OTLP/JSON and OTLP/protobuf. Auth: Bearer / x-api-key / ?key= .
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { authOtlp } from '@/lib/otlp/auth'
import { readOtlp } from '@/lib/otlp/decode'
import { scanMetrics } from '@/lib/otlp/normalize'
import { deriveMetricEvents, type MetricState } from '@/lib/otlp/metrics'
import { persistRows } from '@/lib/otlp/persist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DB-backed last-seen store for cumulative-counter diffing (needs migration 024).
function dbMetricState(admin: SupabaseClient, orgId: string): MetricState {
  return {
    async get(key) {
      const { data } = await admin.from('otlp_metric_state').select('value')
        .eq('org_id', orgId).eq('series_key', key).maybeSingle()
      return data ? Number(data.value) : null
    },
    async set(key, value) {
      await admin.from('otlp_metric_state')
        .upsert({ org_id: orgId, series_key: key, value }, { onConflict: 'org_id,series_key' })
    },
  }
}

export async function POST(req: NextRequest) {
  const ctx = await authOtlp(req)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: any
  try { body = await readOtlp(req, 'metrics') }
  catch (e: any) { return NextResponse.json({ error: `invalid OTLP body: ${e?.message ?? e}` }, { status: 400 }) }

  const health = scanMetrics(body)
  if (health.sawDelta) {
    console.warn('[otlp/metrics] delta temporality received — some backends drop it; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative')
  }

  const admin = createAdminClient()
  // Derive Codex/Gemini rows. Best-effort: a failure here (e.g. migration 024
  // not yet applied) must not 500 the exporter into a retry loop, and never
  // affects Claude Code (logs). Loud log instead of silent loss.
  try {
    const { rows, skippedFirstSeen } = await deriveMetricEvents(body, ctx, dbMetricState(admin, ctx.orgId))
    if (rows.length) {
      const res = await persistRows(admin, ctx, rows)
      console.log(`[otlp/metrics] org=${ctx.orgId} derived=${rows.length} inserted=${res.inserted} dup=${res.duplicate} baseline=${skippedFirstSeen}`)
    } else if (skippedFirstSeen) {
      console.log(`[otlp/metrics] org=${ctx.orgId} baselined ${skippedFirstSeen} series (first-seen, emitted nothing)`)
    }
  } catch (e: any) {
    console.error('[otlp/metrics] derivation failed (Claude Code unaffected):', e?.message ?? e)
  }

  await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', ctx.keyId)
  return NextResponse.json({ partialSuccess: {} })
}
