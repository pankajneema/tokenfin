import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import crypto from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EventSchema = z.object({
  api_key:           z.string().startsWith('tf_'),
  model:             z.string().min(1),
  prompt_tokens:     z.number().int().nonneg(),
  completion_tokens: z.number().int().nonneg(),
  latency_ms:        z.number().int().nonneg().optional(),
  tags:              z.record(z.string()).optional().default({}),
  metadata:          z.record(z.unknown()).optional().default({}),
})

async function resolveApiKey(rawKey: string) {
  const hash   = crypto.createHash('sha256').update(rawKey).digest('hex')
  const prefix = rawKey.slice(0, 20)
  const { data } = await supabase
    .from('api_keys')
    .select('id,project_id,org_id,is_active')
    .eq('key_hash', hash)
    .eq('key_prefix', prefix)
    .single()
  return data
}

async function getModelPrices(model: string) {
  const { data } = await supabase
    .from('model_prices')
    .select('input_per_1m,output_per_1m')
    .eq('model', model)
    .single()
  return data
}

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = EventSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

  const event = parsed.data
  const key   = await resolveApiKey(event.api_key)
  if (!key?.is_active) return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 })

  const prices = await getModelPrices(event.model)
  const costUsd = prices
    ? (event.prompt_tokens / 1_000_000) * prices.input_per_1m +
      (event.completion_tokens / 1_000_000) * prices.output_per_1m
    : 0
  const totalTokens = event.prompt_tokens + event.completion_tokens

  const { error: insertErr } = await supabase.from('usage_events').insert({
    api_key_id:        key.id,
    project_id:        key.project_id,
    org_id:            key.org_id,
    model:             event.model,
    prompt_tokens:     event.prompt_tokens,
    completion_tokens: event.completion_tokens,
    total_tokens:      totalTokens,
    cost_usd:          costUsd,
    latency_ms:        event.latency_ms ?? null,
    tags:              event.tags,
    metadata:          event.metadata,
  })

  if (insertErr) return NextResponse.json({ error: 'Failed to record event' }, { status: 500 })

  // Fire-and-forget aggregate
  const bucket = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
  supabase.rpc('upsert_usage_agg', {
    p_bucket: bucket, p_project_id: key.project_id, p_org_id: key.org_id,
    p_model: event.model, p_tokens: totalTokens, p_cost: costUsd, p_requests: 1,
  }).then(() => {}).catch(() => {})

  return NextResponse.json({ ok: true, cost_usd: costUsd, total_tokens: totalTokens }, { status: 201 })
}

export async function GET() {
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString() })
}
