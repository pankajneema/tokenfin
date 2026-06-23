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

  const { name, slug, plan } = await req.json()
  if (!name || !slug)
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const validPlan = ['free', 'team', 'pro', 'enterprise'].includes(plan) ? plan : 'free'

  // If user already has a membership, just return their existing org
  const { data: existingMember } = await db()
    .from('members')
    .select('org_id, organizations(id,name,slug,plan)')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (existingMember) {
    console.log('[POST /api/v1/orgs] User already has org, returning existing')
    const org = Array.isArray(existingMember.organizations)
      ? existingMember.organizations[0]
      : existingMember.organizations
    return NextResponse.json(org, { status: 200 })
  }

  // Check slug uniqueness
  const { data: existingSlug } = await db()
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existingSlug)
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })

  // Create org
  const { data: org, error: orgError } = await db()
    .from('organizations')
    .insert({ name, slug, plan: validPlan, owner_id: user.id })
    .select()
    .single()

  if (orgError) {
    console.error('[POST /api/v1/orgs] org insert failed:', orgError)
    return dbError(orgError, 'POST orgs — insert org')
  }

  // Add caller as owner — MUST succeed or we return an error
  const { error: memberError } = await db()
    .from('members')
    .insert({ org_id: org.id, user_id: user.id, role: 'owner' })

  if (memberError) {
    console.error('[POST /api/v1/orgs] member insert failed:', memberError)
    // Roll back org (best-effort)
    await db().from('organizations').delete().eq('id', org.id)
    return NextResponse.json(
      { error: `Failed to create membership: ${memberError.message}` },
      { status: 500 }
    )
  }

  console.log('[POST /api/v1/orgs] org+member created successfully', org.id, user.id)
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
    .from('organizations')
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

  const { data, error } = await db()
    .from('members')
    .select('organizations(*)')
    .eq('user_id', user.id)

  if (error) return dbError(error, 'GET orgs')
  return NextResponse.json(data?.map((m: any) => m.organizations) ?? [])
}
