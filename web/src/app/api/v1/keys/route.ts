import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requireResourceOwner, dbError } from '@/lib/api/auth'
import crypto                                         from 'crypto'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

function generateApiKey(projectId: string, env: string): string {
  const envShort = env === 'production' ? 'prod' : env === 'staging' ? 'stg' : 'dev'
  const segment  = projectId.replace(/-/g, '').slice(0, 4)
  const secret   = crypto.randomBytes(16).toString('hex')
  return `tfk_${envShort}_${segment}_${secret}`
}

/* GET /api/v1/keys?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  // key_hash is NEVER selected — only key_prefix (first 22 chars, safe to display)
  const { data, error } = await db()
    .from('api_keys')
    .select('id, name, key_prefix, env, scopes, expires_at, is_active, last_used_at, created_at, created_by, project_id, projects(name)')
    .eq('org_id', orgId!)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET keys')

  const { data: authData } = await db().auth.admin.listUsers({ perPage: 1000 })
  const userMap = new Map(
    (authData?.users ?? []).map(u => [
      u.id,
      (u.user_metadata?.full_name as string | undefined) ?? u.email?.split('@')[0] ?? 'Unknown',
    ])
  )

  const enriched = (data ?? []).map(k => ({
    ...k,
    createdByName: k.created_by ? (userMap.get(k.created_by) ?? 'Unknown') : 'Unknown',
  }))

  return NextResponse.json(enriched)
}

/* POST /api/v1/keys */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:     z.string().uuid(),
    project_id: z.string().uuid(),
    name:       z.string().min(1).max(64),
    created_by: z.string().uuid(),
    env:        z.enum(['production', 'staging', 'development']).default('production'),
    scopes:     z.array(z.enum(['read', 'write', 'admin'])).default(['read', 'write']),
    expires_at: z.string().datetime().nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireOrgMember(parsed.data.org_id)
  if (guard instanceof NextResponse) return guard

  const { org_id, project_id, name, created_by, env, scopes, expires_at } = parsed.data
  const rawKey    = generateApiKey(project_id, env)
  const keyHash   = crypto.createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 22)

  const { data, error } = await db().from('api_keys').insert({
    org_id, project_id, name, created_by,
    key_hash: keyHash,   // stored — never returned after this point
    key_prefix: keyPrefix,
    env, scopes, expires_at: expires_at ?? null,
  }).select('id, name, key_prefix, env, scopes, expires_at, created_at, project_id').single()

  if (error) return dbError(error, 'POST keys')

  // raw_key returned ONCE — never stored in plaintext, never logged
  return NextResponse.json({ ...data, raw_key: rawKey }, { status: 201 })
}

/* PATCH /api/v1/keys — toggle is_active */
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    id:        z.string().uuid(),
    is_active: z.boolean(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourceOwner('api_keys', parsed.data.id)
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('api_keys').update({ is_active: parsed.data.is_active }).eq('id', parsed.data.id)
  if (error) return dbError(error, 'PATCH keys')
  return NextResponse.json({ ok: true })
}

/* DELETE /api/v1/keys?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const guard = await requireResourceOwner('api_keys', id)
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('api_keys').delete().eq('id', id!)
  if (error) return dbError(error, 'DELETE keys')
  return NextResponse.json({ ok: true })
}
