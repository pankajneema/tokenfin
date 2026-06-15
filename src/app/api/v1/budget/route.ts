import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  const { data, error } = await supabase
    .from('budget_requests')
    .select('*, profiles:requested_by(email)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  const { data, error } = await supabase.from('budget_requests').insert(parsed.data).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:          z.string().uuid(),
    status:      z.enum(['approved','denied']),
    reviewed_by: z.string().uuid(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { id, status, reviewed_by } = parsed.data
  const { error } = await supabase.from('budget_requests').update({
    status, reviewed_by, reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
