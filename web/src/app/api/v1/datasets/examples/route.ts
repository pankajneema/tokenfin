import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission, dbError } from '@/lib/api/auth'
import { z } from 'zod'

function db() { return createAdminClient() }

/* POST /api/v1/datasets/examples  { dataset_id, input, reference_output? } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const schema = z.object({
    dataset_id: z.string().uuid(),
    input: z.string().min(1),                 // the prompt/question text
    reference_output: z.string().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { data: ds } = await db().from('datasets').select('org_id').eq('id', parsed.data.dataset_id).maybeSingle()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  const guard = await requirePermission(ds.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('examples').insert({
    dataset_id: parsed.data.dataset_id, org_id: ds.org_id,
    input: { text: parsed.data.input }, reference_output: parsed.data.reference_output ?? null,
  }).select().single()
  if (error) return dbError(error, 'POST examples')
  return NextResponse.json(data, { status: 201 })
}

/* DELETE /api/v1/datasets/examples?id= */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: row } = await db().from('examples').select('org_id').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const guard = await requirePermission(row.org_id, 'alerts:write')
  if (guard instanceof NextResponse) return guard
  const { error } = await db().from('examples').delete().eq('id', id)
  if (error) return dbError(error, 'DELETE examples')
  return NextResponse.json({ ok: true })
}
