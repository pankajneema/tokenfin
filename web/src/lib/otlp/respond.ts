/**
 * Shared OTLP receiver responses. Storage failures answer 503 + Retry-After so
 * exporters retry (every write is idempotent — a retry cannot double-count);
 * 500 would make most exporters drop the batch.
 */
import { NextResponse } from 'next/server'
import { BodyTooLargeError } from './decode'

export const RETRY_AFTER_SECONDS = 5

export function retryLater(stage: string, message: string) {
  console.error(`[otlp] ${stage} failed:`, message)
  return NextResponse.json(
    { error: 'temporarily unable to persist telemetry' },
    { status: 503, headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) } },
  )
}

export function badBody(e: unknown) {
  if (e instanceof BodyTooLargeError) return NextResponse.json({ error: e.message }, { status: 413 })
  return NextResponse.json({ error: `invalid OTLP body: ${(e as any)?.message ?? e}` }, { status: 400 })
}

export const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 })

export const ok = () => NextResponse.json({ partialSuccess: {} })
