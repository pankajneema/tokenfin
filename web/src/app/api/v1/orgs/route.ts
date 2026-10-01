import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requirePermission, dbError } from '@/lib/api/auth'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { isValidTimeZone } from '@/lib/dates'
import { clearOrgTimezone } from '@/lib/org-timezone'
import { invalidateKeyCache } from '@/lib/otlp/auth'

function db() { return createAdminClient() }

/* POST /api/v1/orgs — create a new org for the authenticated user (onboarding)
   Body: { name, slug } */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    slug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/),
  })  // unknown keys (e.g. legacy `plan`, `owner_id`) are stripped — billing plans are gone
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  const { name, slug } = parsed.data

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
    .insert({ name, slug, owner_id: user.id })   // plan column keeps its DB default
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
    return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 })
  }

  console.log('[POST /api/v1/orgs] org+member created successfully', org.id, user.id)
  return NextResponse.json(org, { status: 201 })
}

/* PATCH /api/v1/orgs — update org settings. Owner only.
   Body: { org_id, name?, slug? }  (`plan` is no longer accepted — billing removed) */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id: z.string().uuid(),
    name:   z.string().trim().min(1).max(100).optional(),
    slug:   z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
    // IANA zone used to bucket days on every dashboard (e.g. "UTC", "Asia/Kolkata").
    timezone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
    // Privacy switch: when false, prompt text is dropped on arrival (usage is still recorded).
    capture_prompts: z.boolean().optional(),
    // Traces: 'errors' keeps full span detail only for traces with an error / warning.
    trace_capture: z.enum(['errors', 'all']).optional(),
  }).strict()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const { org_id, ...fields } = parsed.data
  if (Object.keys(fields).length === 0)
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const guard = await requirePermission(org_id, 'org:edit')
  if (guard instanceof NextResponse) return guard

  if (fields.slug) {
    const { data: clash } = await db()
      .from('organizations').select('id').eq('slug', fields.slug).neq('id', org_id).maybeSingle()
    if (clash) return NextResponse.json({ error: 'Slug already taken' }, { status: 409 })
  }

  const { data, error } = await db()
    .from('organizations')
    .update(fields)
    .eq('id', org_id)
    .select()
    .single()

  if (error) return dbError(error, 'PATCH orgs')
  if (fields.timezone) clearOrgTimezone(org_id)
  // Key lookups cache the org's timezone + capture_prompts alongside the key.
  if (fields.timezone || fields.capture_prompts !== undefined || fields.trace_capture !== undefined) invalidateKeyCache()
  await audit({ orgId: org_id, actorUserId: guard.userId, action: fields.timezone ? 'org.timezone' : fields.capture_prompts !== undefined || fields.trace_capture !== undefined ? 'org.privacy' : 'org.update', targetType: 'organization', targetId: org_id, details: fields })
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
