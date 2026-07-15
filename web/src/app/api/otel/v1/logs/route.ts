/**
 * OTLP/HTTP logs receiver — the per-turn usage path.
 *
 * CLI agents (Claude Code today) export a `*.api_request` log event per API call
 * carrying model + token counts + cost. We turn each into one usage_events row,
 * deduped by event_id. Accepts OTLP/JSON and OTLP/protobuf. Auth: Bearer tfk_… .
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authOtlp } from '@/lib/otlp/auth'
import { readOtlp } from '@/lib/otlp/decode'
import { normalizeLogs } from '@/lib/otlp/normalize'
import { persistRows } from '@/lib/otlp/persist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await authOtlp(req)
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: any
  try { body = await readOtlp(req, 'logs') }
  catch (e: any) { return NextResponse.json({ error: `invalid OTLP body: ${e?.message ?? e}` }, { status: 400 }) }

  try {
    const admin = createAdminClient()
    const rows = normalizeLogs(body, ctx)
    const res = await persistRows(admin, ctx, rows)
    if (res.inserted || res.duplicate) {
      console.log(`[otlp/logs] org=${ctx.orgId} inserted=${res.inserted} duplicate=${res.duplicate}`)
    }
    await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', ctx.keyId)
    return NextResponse.json({ partialSuccess: {} })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'ingest failed' }, { status: 500 })
  }
}
