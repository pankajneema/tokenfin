import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requirePermission, requireApiKeyOrOrgMember, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'
import { invalidateOrgPrices }                        from '@/lib/pricing-overrides'
import { getOrgTimezone }                             from '@/lib/org-timezone'
import { resolveUserScope, resolveWindow, scopedBreakdown } from '@/lib/rollup-scope'

function db() { return createAdminClient() }

/* GET /api/v1/models?org_id=xxx
 * Top models by cost over the last 30 days (org-local days), from the rollups.
 * Session or Bearer read key. Members / viewers (and keys they own) get their
 * own usage only (guard.scopeUserId); a project-bound key gets its project. */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  try {
    const admin = db()
    const [scope, tz] = await Promise.all([resolveUserScope(admin, guard.scopeUserId), getOrgTimezone(orgId)])
    const win = resolveWindow({ days: '30' }, tz)
    const bd = await scopedBreakdown(admin, orgId, win.from, win.to, 'model', scope,
      guard.projectId ? { project_id: guard.projectId } : undefined, 200)
    return NextResponse.json(bd.rows.map(r => ({
      model:          r.key,
      tokens:         r.total_tokens,
      cost:           r.cost_usd,
      requests:       r.requests,
      metered_cost:   r.metered_cost_usd,
      notional_cost:  r.notional_cost_usd,
      avg_latency_ms: r.avg_latency_ms,
    })))
  } catch (error) {
    return dbError(error, 'GET models')
  }
}

/* POST /api/v1/models */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id: z.string().uuid(),
    model:  z.string().min(1).max(128),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'models:manage')
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('org_models').insert(parsed.data).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Model already added' }, { status: 409 })
    return dbError(error, 'POST models')
  }
  return NextResponse.json(data, { status: 201 })
}

/* PUT /api/v1/models — upsert a custom price override (org_model_prices).
 * Body: { org_id, model_prefix, input_per_m, output_per_m, cache_read_per_m?, cache_write_per_m? }
 * Prices are USD per 1M tokens; the longest matching prefix wins at ingest. */
const priceSchema = z.object({
  org_id:            z.string().uuid(),
  model_prefix:      z.string().trim().toLowerCase().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:/@-]*$/, 'letters, digits and . _ : / @ - only'),
  input_per_m:       z.number().finite().min(0).max(10_000),
  output_per_m:      z.number().finite().min(0).max(10_000),
  cache_read_per_m:  z.number().finite().min(0).max(10_000).nullable().optional(),
  cache_write_per_m: z.number().finite().min(0).max(10_000).nullable().optional(),
})

export async function PUT(req: NextRequest) {
  const parsed = priceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'models:manage')
  if (guard instanceof NextResponse) return guard

  const row = {
    ...parsed.data,
    cache_read_per_m:  parsed.data.cache_read_per_m  ?? null,
    cache_write_per_m: parsed.data.cache_write_per_m ?? null,
    updated_at:        new Date().toISOString(),
  }
  const { data, error } = await db().from('org_model_prices')
    .upsert(row, { onConflict: 'org_id,model_prefix' })
    .select('model_prefix, input_per_m, output_per_m, cache_read_per_m, cache_write_per_m, updated_at')
    .single()
  if (error) return dbError(error, 'PUT models price')
  invalidateOrgPrices(parsed.data.org_id)
  return NextResponse.json(data)
}

/* DELETE /api/v1/models?org_id=xxx&model=yyy          — remove a tracked model
 * DELETE /api/v1/models?org_id=xxx&price_prefix=yyy   — remove a custom price */
export async function DELETE(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const model = req.nextUrl.searchParams.get('model')
  const pricePrefix = req.nextUrl.searchParams.get('price_prefix')
  if (!model && !pricePrefix) return NextResponse.json({ error: 'model or price_prefix required' }, { status: 400 })

  const guard = await requirePermission(orgId, 'models:manage')
  if (guard instanceof NextResponse) return guard

  if (pricePrefix) {
    const { error } = await db().from('org_model_prices').delete().eq('org_id', orgId!).eq('model_prefix', pricePrefix)
    if (error) return dbError(error, 'DELETE models price')
    invalidateOrgPrices(orgId!)
    return NextResponse.json({ ok: true })
  }

  const { error } = await db().from('org_models').delete().eq('org_id', orgId!).eq('model', model!)
  if (error) return dbError(error, 'DELETE models')
  return NextResponse.json({ ok: true })
}
