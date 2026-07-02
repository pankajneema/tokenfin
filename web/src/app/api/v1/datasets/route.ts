import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z } from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/datasets?org_id= */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard
  const { data, error } = await db()
    .from('datasets').select('id, name, description, created_at, examples(count)')
    .eq('org_id', orgId!).order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET datasets')
  return NextResponse.json(data ?? [])
}

/* POST /api/v1/datasets  { org_id, name, description? } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({ org_id: z.string().uuid(), name: z.string().min(1).max(120), description: z.string().max(500).optional() })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const guard = await requirePermission(parsed.data.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const { data, error } = await db().from('datasets').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST datasets')
  return NextResponse.json(data, { status: 201 })
}

/* DELETE /api/v1/datasets?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: row } = await db().from('datasets').select('org_id').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(row.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const { error } = await db().from('datasets').delete().eq('id', id)
  if (error) return dbError(error, 'DELETE datasets')
  return NextResponse.json({ ok: true })
}
