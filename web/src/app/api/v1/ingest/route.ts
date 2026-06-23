/**
 * POST /api/v1/ingest
 *
 * Primary path: proxy to Go ingest service (INGEST_SERVICE_URL).
 * Fallback path: when Go service is unavailable, write directly to Supabase.
 *
 * Auth: Bearer <api_key>  (key stored hashed in api_keys table)
 *
 * Body: {
 *   model:         string   — e.g. "claude-sonnet-4-6"
 *   input_tokens:  number
 *   output_tokens: number
 *   cost_usd?:     number   — auto-computed if omitted
 *   project_id?:   string
 *   tags?:         Record<string,string>
 *   metadata?:     Record<string,unknown>
 * }
 */
import { NextResponse }        from 'next/server'
import type { NextRequest }    from 'next/server'
import { createAdminClient }   from '@/lib/supabase/server'
import crypto                  from 'crypto'

/* ── Pricing (per 1M tokens) ── */
const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8':              { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':            { in:  3.00, out: 15.00 },
  'claude-haiku-4-5-20251001':    { in:  0.80, out:  4.00 },
  'claude-haiku-4-5':             { in:  0.80, out:  4.00 },
  'gpt-4o':                       { in:  2.50, out: 10.00 },
  'gpt-4o-mini':                  { in:  0.15, out:  0.60 },
  'gpt-4-turbo':                  { in: 10.00, out: 30.00 },
  'gpt-3.5-turbo':                { in:  0.50, out:  1.50 },
  'gemini-1.5-pro':               { in:  1.25, out:  5.00 },
  'gemini-1.5-flash':             { in:  0.075, out: 0.30 },
}

function computeCost(model: string, inputTok: number, outputTok: number): number {
  const p = PRICE[model] ?? { in: 2.00, out: 8.00 }
  return (inputTok * p.in + outputTok * p.out) / 1_000_000
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/* ── Direct Supabase ingest (fallback) ── */
async function directIngest(apiKey: string, body: Record<string, unknown>) {
  const admin = createAdminClient()

  // 1. Look up API key
  const keyHash = hashKey(apiKey)
  const { data: keyRow } = await admin
    .from('api_keys')
    .select('id, org_id, project_id, is_active, expires_at, scopes')
    .eq('key_hash', keyHash)
    .single()

  if (!keyRow)         return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'API key is inactive' }, { status: 403 })
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date())
    return NextResponse.json({ error: 'API key expired' }, { status: 403 })

  // 2. Validate body
  const model       = String(body.model ?? '')
  const inputTok    = Number(body.input_tokens  ?? 0)
  const outputTok   = Number(body.output_tokens ?? 0)
  // Accept total_tokens as fallback when input/output aren't split (e.g. direct SDK usage)
  const totalTokFallback = Number(body.total_tokens ?? 0)
  const totalTok    = inputTok + outputTok > 0
    ? inputTok + outputTok
    : totalTokFallback
  // Derive split from total when only total was provided (70/30 estimate)
  const effectiveInput  = inputTok  > 0 ? inputTok  : Math.round(totalTok * 0.7)
  const effectiveOutput = outputTok > 0 ? outputTok : totalTok - Math.round(totalTok * 0.7)
  const costUsd     = typeof body.cost_usd === 'number' ? body.cost_usd : computeCost(model, effectiveInput, effectiveOutput)
  const projectId   = String(body.project_id ?? keyRow.project_id ?? '')
  const tags        = (body.tags    as Record<string,string>)   ?? {}
  const metadata    = (body.metadata as Record<string,unknown>) ?? {}

  if (!model)         return NextResponse.json({ error: 'model is required' }, { status: 400 })
  if (totalTok <= 0)  return NextResponse.json({ error: 'input_tokens + output_tokens must be > 0' }, { status: 400 })

  const orgId    = keyRow.org_id
  const bucket   = new Date().toISOString().slice(0, 10)

  // 3. Insert usage event
  const { error: evtErr } = await admin.from('usage_events').insert({
    org_id:        orgId,
    project_id:    projectId || null,
    model,
    input_tokens:  effectiveInput,
    output_tokens: effectiveOutput,
    total_tokens:  totalTok,
    cost_usd:      costUsd,
    tags,
    metadata,
  })
  if (evtErr) {
    console.error('[ingest direct] usage_events insert error:', evtErr)
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 })
  }

  // 4. Upsert usage_agg
  const { error: aggErr } = await admin.rpc('upsert_usage_agg', {
    p_org_id:        orgId,
    p_project_id:    projectId || null,
    p_model:         model,
    p_bucket:        bucket,
    p_tokens:        totalTok,
    p_cost:          costUsd,
    p_requests:      1,
  })

  // Fallback: manual upsert if RPC doesn't exist
  if (aggErr) {
    await admin.from('usage_agg').upsert({
      org_id:        orgId,
      project_id:    projectId || null,
      model,
      bucket,
      total_tokens:  totalTok,
      cost_usd:      costUsd,
      request_count: 1,
    }, {
      onConflict: 'org_id,project_id,model,bucket',
      ignoreDuplicates: false,
    })
  }

  // 5. Update last_used_at on key
  await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)

  return NextResponse.json({
    ok:           true,
    model,
    total_tokens: totalTok,
    cost_usd:     +costUsd.toFixed(6),
    bucket,
    source:       'direct',
  })
}

/* ════════════════════════════════════════════════════════════ */

const GO_INGEST_URL = (
  process.env.INGEST_SERVICE_URL ?? 'http://localhost:8001'
).replace(/\/$/, '') + '/v1/ingest'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authorization: Bearer <api_key> required' }, { status: 401 })
  }

  const rawKey = authHeader.slice(7).trim()

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Try Go service first
  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), 4_000)

    const upstream = await fetch(GO_INGEST_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    })
    clearTimeout(timer)

    const text = await upstream.text()
    return new NextResponse(text, {
      status:  upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // Go service not running — fall back to direct Supabase write
    console.info('[ingest] Go service unavailable, using direct Supabase path')
    return directIngest(rawKey, body)
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'ingest', path: 'direct+proxy' })
}
