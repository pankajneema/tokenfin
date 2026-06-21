import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireResourceOwner, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('budget_requests')
    .select('*, profiles:requested_by(email)')
    .eq('org_id', orgId!)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET budget')
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:       z.string().uuid(),
    project_id:   z.string().uuid().optional(),
    requested_by: z.string().uuid(),
    amount_usd:   z.number().positive(),
    reason:       z.string().min(10),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db().from('budget_requests').insert(parsed.data).select().single()
  if (error) return dbError(error, 'POST budget')
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:          z.string().uuid(),
    status:      z.enum(['approved', 'denied']),
    reviewed_by: z.string().uuid(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourceOwner('budget_requests', parsed.data.id)
  if (guard instanceof NextResponse) return guard

  const { id, status, reviewed_by } = parsed.data
  const { error } = await db().from('budget_requests').update({
    status, reviewed_by, reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return dbError(error, 'PATCH budget')
  return NextResponse.json({ ok: true })
}
