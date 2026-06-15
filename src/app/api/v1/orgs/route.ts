import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = createServiceRoleClient()
  const { name, slug, owner_id } = await req.json()

  if (!name || !slug || !owner_id)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing)
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name, slug, owner_id, plan: 'free' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Add owner as member
  await supabase.from('members').insert({
    org_id:  org.id,
    user_id: owner_id,
    role:    'owner',
  })

  return NextResponse.json(org, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = createServiceRoleClient()
  const { org_id, plan } = await req.json()

  if (!org_id || !plan)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { data, error } = await supabase
    .from('organizations')
    .update({ plan })
    .eq('id', org_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('members')
    .select('organizations(*)')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data?.map((m: any) => m.organizations) ?? [])
}
