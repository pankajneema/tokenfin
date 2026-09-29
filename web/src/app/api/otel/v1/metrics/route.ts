/**
 * OTLP/HTTP metrics receiver.
 *
 *  1. Health — validate temporality (warn on delta) and flag unrecognized
 *     metric names, never a silent drop.
 *  2. Capture for Codex/Gemini — those agents report per-turn tokens ONLY as
 *     metric counters (no per-turn logs). We derive rows by diffing each series
 *     against its last-seen value (see lib/otlp/metrics.ts). Claude Code metrics
 *     are deliberately NOT derived — its logs already own those rows.
 *  3. Productivity — Claude Code lines/commits/PRs/edit decisions/active time/
 *     sessions → productivity_daily (per user·repo·day increments).
 *
 * Counter state advances atomically (otlp_state_advance: GREATEST + previous
 * value, one round trip per export). If the derived rows then fail to persist,
 * the advance is compensated (otlp_state_revert) and the exporter gets 503 so
 * its retry re-derives the same delta — tokens are neither lost nor doubled.
 *
 * Accepts OTLP/JSON and OTLP/protobuf. Auth: Bearer / x-api-key / ?key= .
 */
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { authOtlp } from '@/lib/otlp/auth'
import { readOtlp } from '@/lib/otlp/decode'
import { scanMetrics } from '@/lib/otlp/normalize'
import { deriveMetricEvents, deriveProductivity, type MetricClaim, type MetricState } from '@/lib/otlp/metrics'
import { persistRows, persistProductivity } from '@/lib/otlp/persist'
import { badBody, ok, retryLater, unauthorized } from '@/lib/otlp/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

class StateError extends Error {}

// DB-backed last-seen store for cumulative-counter diffing (otlp_metric_state).
function dbMetricState(admin: SupabaseClient, orgId: string): MetricState {
  return {
    async advance(entries) {
      const { data, error } = await admin.rpc('otlp_state_advance', {
        p_org: orgId, p_keys: entries.map(e => e.key), p_values: entries.map(e => e.value),
      })
      if (error) throw new StateError(`otlp_state_advance failed: ${error.message}`)
      const out = new Map<string, number | null>()
      for (const r of (data ?? []) as Array<{ series_key: string; prev: number | string | null }>) {
        out.set(r.series_key, r.prev == null ? null : Number(r.prev))
      }
      return out
    },
  }
}

async function revert(admin: SupabaseClient, orgId: string, claims: MetricClaim[]) {
  if (!claims.length) return
  const { error } = await admin.rpc('otlp_state_revert', {
    p_org: orgId, p_keys: claims.map(c => c.key), p_values: claims.map(c => c.value), p_prev: claims.map(c => c.prev),
  })
  if (error) console.error('[otlp/metrics] state revert failed (next export re-baselines):', error.message)
}

export async function POST(req: NextRequest) {
  let ctx
  try { ctx = await authOtlp(req) } catch (e: any) { return retryLater('auth', e?.message ?? String(e)) }
  if (!ctx) return unauthorized()

  let body: any
  try { body = await readOtlp(req, 'metrics') } catch (e) { return badBody(e) }

  const health = scanMetrics(body)
  if (health.sawDelta) {
    console.warn('[otlp/metrics] delta temporality received — some backends drop it; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative')
  }

  const admin = createAdminClient()
  const state = dbMetricState(admin, ctx.orgId)

  // Codex/Gemini usage rows. Claude Code is unaffected (its rows come from logs).
  let tokenClaims: MetricClaim[] = []
  try {
    const { rows, skippedFirstSeen, claims } = await deriveMetricEvents(body, ctx, state)
    tokenClaims = claims
    if (rows.length) {
      const res = await persistRows(admin, ctx, rows)
      console.log(`[otlp/metrics] org=${ctx.orgId} derived=${rows.length} inserted=${res.inserted} dup=${res.duplicate} baseline=${skippedFirstSeen}`)
    } else if (skippedFirstSeen) {
      console.log(`[otlp/metrics] org=${ctx.orgId} baselined ${skippedFirstSeen} series (first-seen, emitted nothing)`)
    }
  } catch (e: any) {
    await revert(admin, ctx.orgId, tokenClaims)
    return retryLater('metrics usage', e?.message ?? String(e))
  }

  // Claude Code productivity → productivity_daily. Same claim / compensate policy.
  let prodClaims: MetricClaim[] = []
  try {
    const { deltas, skippedFirstSeen, claims } = await deriveProductivity(body, ctx, state)
    prodClaims = claims
    if (deltas.length) {
      await persistProductivity(admin, ctx, deltas)
      console.log(`[otlp/metrics] org=${ctx.orgId} productivity groups=${deltas.length} baseline=${skippedFirstSeen}`)
    }
  } catch (e: any) {
    await revert(admin, ctx.orgId, prodClaims)
    // Usage rows above are already stored; the retry dedupes them by event_id.
    return retryLater('metrics productivity', e?.message ?? String(e))
  }

  return ok()
}
