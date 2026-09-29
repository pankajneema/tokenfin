/**
 * OTLP/HTTP logs receiver — the per-turn usage path.
 *
 * CLI agents (Claude Code today) export a `*.api_request` log event per API call
 * carrying model + token counts + cost. We turn each into one usage_events row,
 * deduped by (org_id, event_id), in one batched write. Accepts OTLP/JSON and
 * OTLP/protobuf. Auth: Bearer tfk_… . Storage failures → 503 + Retry-After.
 */
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authOtlp } from '@/lib/otlp/auth'
import { readOtlp } from '@/lib/otlp/decode'
import { normalizeLogs, normalizePrompts, normalizeApiErrors } from '@/lib/otlp/normalize'
import { persistRows, persistPrompts, persistApiErrors } from '@/lib/otlp/persist'
import { badBody, ok, retryLater, unauthorized } from '@/lib/otlp/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx
  try { ctx = await authOtlp(req) } catch (e: any) { return retryLater('auth', e?.message ?? String(e)) }
  if (!ctx) return unauthorized()

  let body: any
  try { body = await readOtlp(req, 'logs') } catch (e) { return badBody(e) }

  const admin = createAdminClient()
  let res
  try {
    // Usage rows and prompt text are independent writes — run them together.
    ;[res] = await Promise.all([
      persistRows(admin, ctx, normalizeLogs(body, ctx)),
      persistPrompts(admin, ctx, normalizePrompts(body)),
    ])
  } catch (e: any) {
    return retryLater('logs persist', e?.message ?? String(e))
  }
  // api_error events → api_errors_daily counters (never usage rows). Best-effort.
  const apiErrors = await persistApiErrors(admin, ctx, normalizeApiErrors(body, ctx.timezone))
  if (apiErrors) console.log(`[otlp/logs] org=${ctx.orgId} api_errors=${apiErrors}`)
  if (res.inserted || res.duplicate) {
    console.log(`[otlp/logs] org=${ctx.orgId} inserted=${res.inserted} duplicate=${res.duplicate}`)
  }
  return ok()
}
