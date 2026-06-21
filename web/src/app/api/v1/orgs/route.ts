import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, dbError } from '@/lib/api/auth'

function db() { return createAdminClient() }

/* POST /api/v1/orgs — create a new org for the authenticated user (onboarding)
   Body: { name, slug } */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, slug } = await req.json()
  if (!name || !slug)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  // Check slug uniqueness
  const { data: existing } = await db()
    .from('orgs')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing)
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })

  const { data: org, error } = await db()
    .from('orgs')
    .insert({ name, slug, plan: 'free' })
    .select()
    .single()

  if (error) return dbError(error, 'POST orgs')

  // Add caller as owner
  await db().from('members').insert({
    org_id:  org.id,
    user_id: user.id,
    role:    'owner',
  })

  return NextResponse.json(org, { status: 201 })
}

/* PATCH /api/v1/orgs — update org settings (e.g. plan)
   Body: { org_id, plan } */
export async function PATCH(req: NextRequest) {
  const { org_id, plan } = await req.json()
  if (!org_id || !plan)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const guard = await requireOrgMember(org_id)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('orgs')
    .update({ plan })
    .eq('id', org_id)
    .select()
    .single()

  if (error) return dbError(error, 'PATCH orgs')
  return NextResponse.json(data)
}

/* GET /api/v1/orgs — list all orgs the authenticated user belongs to */
export async function GET(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('members')
    .select('orgs(*)')
    .eq('user_id', user.id)

  if (error) return dbError(error, 'GET orgs')
  return NextResponse.json(data?.map((m: any) => m.orgs) ?? [])
}
