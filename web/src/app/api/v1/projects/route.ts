import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requirePermission, requireApiKeyOrOrgMember, requireResourcePermission, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'
import { audit } from '@/lib/audit'

function db() { return createAdminClient() }

/* GET /api/v1/projects?org_id=xxx — project list, readable by every role.
 * A project-bound API key only sees its own project. */
export async function GET(req: NextRequest) {
  const guard = await requireApiKeyOrOrgMember(req, req.nextUrl.searchParams.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  let q = db()
    .from('projects')
    .select('id, name, slug, description, created_at')
    .eq('org_id', orgId)
  if (guard.projectId) q = q.eq('id', guard.projectId)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) return dbError(error, 'GET projects')
  return NextResponse.json(data)
}

/* POST /api/v1/projects */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:      z.string().uuid(),
    name:        z.string().min(1).max(64),
    slug:        z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
    description: z.string().max(500).optional().nullable(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'projects:create')
  if (guard instanceof NextResponse) return guard

  const { data: existing } = await db()
    .from('projects')
    .select('id')
    .eq('org_id', parsed.data.org_id)
    .eq('slug', parsed.data.slug)
    .maybeSingle()
  if (existing) return NextResponse.json({ error: 'Slug already taken in this org' }, { status: 409 })

  const { data, error } = await db().from('projects').insert(parsed.data).select().single()
  if (!error && data) await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'project.create', targetType: 'project', targetId: data.id, details: { name: data.name } })
  if (error) return dbError(error, 'POST projects')
  return NextResponse.json(data, { status: 201 })
}

/* PATCH /api/v1/projects */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    id:          z.string().uuid(),
    name:        z.string().min(1).max(64).optional(),
    slug:        z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requireResourcePermission('projects', parsed.data.id, 'projects:edit')
  if (guard instanceof NextResponse) return guard

  const { id, ...fields } = parsed.data
  if (fields.slug) {
    const { data: clash } = await db()
      .from('projects').select('id')
      .eq('org_id', guard.orgId).eq('slug', fields.slug).neq('id', id)
      .maybeSingle()
    if (clash) return NextResponse.json({ error: 'Slug already taken in this org' }, { status: 409 })
  }
  const { data, error } = await db().from('projects').update(fields).eq('id', id).eq('org_id', guard.orgId).select().single()
  if (!error) await audit({ orgId: guard.orgId, actorUserId: guard.userId, action: 'project.update', targetType: 'project', targetId: id, details: fields })
  if (error) return dbError(error, 'PATCH projects')
  return NextResponse.json(data)
}

/* DELETE /api/v1/projects?id=xxx */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const guard = await requireResourcePermission('projects', id, 'projects:delete')
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('projects').delete().eq('id', id!).eq('org_id', guard.orgId)
  if (!error) await audit({ orgId: guard.orgId, actorUserId: guard.userId, action: 'project.delete', targetType: 'project', targetId: id })
  if (error) return dbError(error, 'DELETE projects')
  return NextResponse.json({ ok: true })
}
