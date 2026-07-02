import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z } from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/routes?org_id= — active model routes */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  const { data, error } = await db()
    .from('model_routes').select('id, from_model, to_model, min_quality, is_active')
    .eq('org_id', orgId!).eq('is_active', true).order('from_model')
  if (error) return dbError(error, 'GET routes')
  return NextResponse.json(data ?? [])
}

/* POST /api/v1/routes { org_id, from_model, to_model, min_quality? } — upsert a route */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id: z.string().uuid(),
    from_model: z.string().min(1),
    to_model: z.string().min(1),
    min_quality: z.number().min(0).max(1).optional(),
  }).refine(d => d.from_model !== d.to_model, { message: 'from and to must differ', path: ['to_model'] })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  // Deactivate any existing active route for this from_model, then insert.
  await db().from('model_routes').update({ is_active: false })
    .eq('org_id', parsed.data.org_id).eq('from_model', parsed.data.from_model).eq('is_active', true)
  const { data, error } = await db().from('model_routes').insert({ ...parsed.data, is_active: true }).select().single()
  if (error) return dbError(error, 'POST routes')
  return NextResponse.json(data, { status: 201 })
}

/* DELETE /api/v1/routes?id= — deactivate a route */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: row } = await db().from('model_routes').select('org_id').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(row.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard
  const { error } = await db().from('model_routes').update({ is_active: false }).eq('id', id)
  if (error) return dbError(error, 'DELETE routes')
  return NextResponse.json({ ok: true })
}
