/**
 * POST /api/v1/ingest — record one SDK usage event (writes Supabase directly).
 * For many events per request use POST /api/v1/ingest/batch.
 *
 * Auth: Bearer <api_key>  (key stored hashed in api_keys; needs "write"/"ingest"
 * scope when scopes are recorded). Idempotency: `Idempotency-Key` header or
 * body.idempotency_key — a replay is acknowledged with `duplicate: true`.
 *
 * Body: {
 *   model:          string   — e.g. "claude-sonnet-4-6"
 *   input_tokens:   number
 *   output_tokens:  number
 *   cache_read_tokens?, cache_write_tokens?: number
 *   timestamp?:     string | number — when the call happened (ISO or epoch s/ms);
 *                   days are bucketed by this, not by arrival time
 *   cost_usd?:      number   — ignored for known models (server price wins);
 *                   used for unknown models only within 10x of our estimate
 *   latency_ms?:    number
 *   user_email?:    string   — attributed to that workspace member for shared keys
 *   project_id?, session_id?, tags?, metadata?, prompt_text?, response_text?
 * }
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authIngest, ingestEvents, spendGate } from './_core'
import { PersistError } from '@/lib/otlp/persist'
import { readBodyCapped, BodyTooLargeError } from '@/lib/otlp/decode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_EVENT_BYTES = 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await authIngest(req)
  if (!auth.ok) return auth.res
  const { ctx } = auth

  let body: Record<string, unknown>
  try {
    body = JSON.parse(new TextDecoder().decode(await readBodyCapped(req, MAX_EVENT_BYTES))) as Record<string, unknown>
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const blocked = await spendGate(ctx)
  if (blocked) return blocked

  const idempotencyKey = req.headers.get('Idempotency-Key') ?? (typeof body?.idempotency_key === 'string' ? body.idempotency_key : null)
  let result
  try {
    ;[result] = await ingestEvents(ctx, [{ body, idempotencyKey }])
  } catch (e: any) {
    console.error('[ingest] persist failed:', e?.message ?? e)
    return NextResponse.json({ error: 'Failed to record event' }, e instanceof PersistError ? { status: 503, headers: { 'Retry-After': '5' } } : { status: 500 })
  }
  if (result.status === 'error') return NextResponse.json({ error: result.error }, { status: result.code })
  const s = result.summary!
  if (result.status === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true, model: s.model, total_tokens: s.total_tokens })
  }
  return NextResponse.json({
    ok: true, model: s.model, total_tokens: s.total_tokens, cost_usd: +s.cost_usd.toFixed(6),
    bucket: s.bucket, source: 'direct',
  })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'ingest', path: 'direct', batch: '/api/v1/ingest/batch' })
}
