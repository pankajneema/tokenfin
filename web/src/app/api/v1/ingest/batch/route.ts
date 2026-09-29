/**
 * POST /api/v1/ingest/batch — record up to 500 SDK usage events in one request
 * (one database round trip for the inserts).
 *
 * Auth, validation, pricing and idempotency are identical to /api/v1/ingest.
 *
 * Request:  { events: [ <ingest event>, … ] }   (1–500). Each event may carry
 *           `idempotency_key`; an `Idempotency-Key` header K keys event i as
 *           "K:i" when the event has none.
 * Response: 200 { results: [{ index, status, code, event_id?, error? }],
 *                 accepted, duplicates, errors }
 *           status: 'accepted' (code 201) | 'duplicate' (200) | 'error' (4xx)
 *           Whole-request failures (auth, body, spend limit, storage) are a
 *           4xx/5xx JSON { error } instead; 503 carries Retry-After.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authIngest, ingestEvents, spendGate, MAX_BATCH } from '../_core'
import { PersistError } from '@/lib/otlp/persist'
import { readBodyCapped, BodyTooLargeError } from '@/lib/otlp/decode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BATCH_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await authIngest(req)
  if (!auth.ok) return auth.res
  const { ctx } = auth

  let body: any
  try {
    body = JSON.parse(new TextDecoder().decode(await readBodyCapped(req, MAX_BATCH_BYTES)))
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const events = Array.isArray(body) ? body : body?.events
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'body must be { events: [...] } with at least one event' }, { status: 400 })
  }
  if (events.length > MAX_BATCH) {
    return NextResponse.json({ error: `at most ${MAX_BATCH} events per batch (got ${events.length})` }, { status: 413 })
  }

  const blocked = await spendGate(ctx)
  if (blocked) return blocked

  const headerKey = req.headers.get('Idempotency-Key')
  let results
  try {
    results = await ingestEvents(ctx, events.map((ev: any, i: number) => ({
      body: ev,
      idempotencyKey: typeof ev?.idempotency_key === 'string' && ev.idempotency_key
        ? ev.idempotency_key
        : headerKey ? `${headerKey}:${i}` : null,
    })))
  } catch (e: any) {
    console.error('[ingest/batch] persist failed:', e?.message ?? e)
    return NextResponse.json({ error: 'Failed to record events' }, e instanceof PersistError ? { status: 503, headers: { 'Retry-After': '5' } } : { status: 500 })
  }

  const count = (s: string) => results.filter(r => r.status === s).length
  return NextResponse.json({
    results: results.map(({ index, status, code, event_id, error }) => ({ index, status, code, ...(event_id ? { event_id } : {}), ...(error ? { error } : {}) })),
    accepted: count('accepted'), duplicates: count('duplicate'), errors: count('error'),
  })
}
