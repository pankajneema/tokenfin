import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { audit } from '@/lib/audit'
import { invalidatePolicy } from '@/lib/policy'
import { z } from 'zod'

function db() { return createAdminClient() }

/*
 * Model routes + SDK model blocks. Enforced ONLY by the TokenFin SDK wrappers
 * (they poll GET /api/v1/policy); there is no proxy in the request path.
 *   origin = manual (added here / on Quality vs cost) | auto (a limit's switch_model action)
 */

/* GET /api/v1/routes?org_id= — active routes and blocks, with SDK pick-up stats */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  const [{ data, error }, { data: blocks }, { data: fetches }] = await Promise.all([
    db().from('model_routes').select('*').eq('org_id', orgId!).eq('is_active', true).order('from_model'),
    db().from('model_blocks').select('*').eq('org_id', orgId!).eq('is_active', true).order('model'),
    db().from('policy_fetches').select('key_id, fetch_count, last_fetched_at, last_version').eq('org_id', orgId!),
  ])
  if (error) return dbError(error, 'GET routes')
  return NextResponse.json({ routes: data ?? [], blocks: blocks ?? [], sdk_fetches: fetches ?? [] })
}

/* POST /api/v1/routes { org_id, from_model, to_model, min_quality?, match? } — upsert a manual route */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    org_id: z.string().uuid(),
    from_model: z.string().trim().min(1).max(120),
    to_model: z.string().trim().min(1).max(120),
    min_quality: z.number().min(0).max(1).optional(),
    match: z.enum(['exact', 'prefix']).default('exact'),
  }).refine(d => d.from_model.toLowerCase() !== d.to_model.toLowerCase(), { message: 'from and to must differ', path: ['to_model'] })
    .refine(d => d.match !== 'prefix' || !d.to_model.toLowerCase().startsWith(d.from_model.toLowerCase()), {
      message: 'a prefix route must not match its own target', path: ['to_model'] })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard

  // Deactivate any existing active route for this from_model, then insert.
  const now = new Date().toISOString()
  await db().from('model_routes').update({ is_active: false, deactivated_at: now })
    .eq('org_id', parsed.data.org_id).eq('from_model', parsed.data.from_model).eq('is_active', true)
  const { data, error } = await db().from('model_routes')
    .insert({ ...parsed.data, is_active: true, origin: 'manual', created_by: guard.userId, activated_at: now, reason: 'Added manually' })
    .select().single()
  if (error) return dbError(error, 'POST routes')
  invalidatePolicy(parsed.data.org_id)
  await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'route.create', targetType: 'model_route', targetId: data.id,
    details: { from: data.from_model, to: data.to_model, match: parsed.data.match } })
  return NextResponse.json(data, { status: 201 })
}

/*
 * DELETE /api/v1/routes?id=        — turn a route off (an auto route: "revert")
 * DELETE /api/v1/routes?block_id=  — lift an SDK model block
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const blockId = req.nextUrl.searchParams.get('block_id')
  if (!id && !blockId) return NextResponse.json({ error: 'id or block_id required' }, { status: 400 })
  const table = id ? 'model_routes' : 'model_blocks'
  const { data: row } = await db().from(table).select('*').eq('id', (id ?? blockId)!).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(row.org_id, 'limits:write')
  if (guard instanceof NextResponse) return guard
  const { error } = await db().from(table).update({ is_active: false, deactivated_at: new Date().toISOString() }).eq('id', row.id)
  if (error) return dbError(error, 'DELETE routes')
  invalidatePolicy(row.org_id)
  await audit(id
    ? { orgId: row.org_id, actorUserId: guard.userId, action: row.origin === 'auto' ? 'route.revert' : 'route.delete', targetType: 'model_route', targetId: row.id,
        details: { from: row.from_model, to: row.to_model, origin: row.origin ?? 'manual', limit_id: row.limit_id ?? null } }
    : { orgId: row.org_id, actorUserId: guard.userId, action: 'model_block.delete', targetType: 'model_block', targetId: row.id,
        details: { model: row.model, limit_id: row.limit_id ?? null } })
  return NextResponse.json({ ok: true })
}
