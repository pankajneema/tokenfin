import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'

function db() { return createAdminClient() }

/* GET /api/v1/integrations?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('org_integrations')
    .select('integration, is_active, connected_at, last_synced_at, sync_ok, detail')
    .eq('org_id', orgId!)
    .eq('is_active', true)
  if (error) return dbError(error, 'GET integrations')
  return NextResponse.json(data ?? [])
}

/* POST /api/v1/integrations */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const schema = z.object({
    org_id:      z.string().uuid(),
    integration: z.string().min(1).max(64),
    detail:      z.string().max(256).optional(),
    config:      z.record(z.unknown()).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'integrations:manage')
  if (guard instanceof NextResponse) return guard

  const { org_id, integration, detail, config } = parsed.data
  const { data, error } = await db()
    .from('org_integrations')
    .upsert({
      org_id, integration,
      detail:         detail ?? null,
      config:         config ?? {},
      is_active:      true,
      sync_ok:        true,
      connected_at:   new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'org_id,integration' })
    .select()
    .single()
  if (error) return dbError(error, 'POST integrations')
  return NextResponse.json(data, { status: 201 })
}

/* DELETE /api/v1/integrations?org_id=xxx&integration=yyy */
export async function DELETE(req: NextRequest) {
  const orgId       = req.nextUrl.searchParams.get('org_id')
  const integration = req.nextUrl.searchParams.get('integration')
  if (!integration) return NextResponse.json({ error: 'integration required' }, { status: 400 })

  const guard = await requirePermission(orgId, 'integrations:manage')
  if (guard instanceof NextResponse) return guard

  const { error } = await db()
    .from('org_integrations')
    .delete()
    .eq('org_id', orgId!)
    .eq('integration', integration)
  if (error) return dbError(error, 'DELETE integrations')
  return NextResponse.json({ ok: true })
}
