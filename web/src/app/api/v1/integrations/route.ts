import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { z }                                          from 'zod'
import { validateOutboundUrl }                        from '@/lib/notify/send'

function db() { return createAdminClient() }

/* GET /api/v1/integrations?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('org_integrations')
    .select('provider, is_active, connected_at, last_synced_at, sync_ok, detail')
    .eq('org_id', orgId!)
    .eq('is_active', true)
  if (error) return dbError(error, 'GET integrations')
  const mapped = (data ?? []).map(r => ({
    integration:    r.provider,
    is_active:      r.is_active,
    connected_at:   r.connected_at,
    last_synced_at: r.last_synced_at,
    sync_ok:        r.sync_ok,
    detail:         r.detail,
  }))
  return NextResponse.json(mapped)
}

/* POST /api/v1/integrations */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:      z.string().uuid(),
    integration: z.string().min(1).max(64),
    detail:      z.string().max(256).nullable().optional(),
    config:      z.record(z.unknown()).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'integrations:manage')
  if (guard instanceof NextResponse) return guard

  const { org_id, integration, detail, config } = parsed.data

  // SSRF: any URL the alert engine may POST to must pass the same checks used
  // at send time (https, Slack host allow-list, no private/reserved targets).
  for (const field of ['webhook_url', 'url', 'endpoint'] as const) {
    const v = config?.[field]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string' || v.length > 2048)
      return NextResponse.json({ error: `config.${field} must be a URL string` }, { status: 422 })
    const check = await validateOutboundUrl(v.trim(), integration === 'slack' ? 'slack' : 'webhook')
    if (!check.ok) return NextResponse.json({ error: `config.${field}: ${check.reason}` }, { status: 422 })
  }
  const { data, error } = await db()
    .from('org_integrations')
    .upsert({
      org_id, provider: integration,
      detail:         detail ?? null,
      config:         config ?? {},
      is_active:      true,
      sync_ok:        true,
      connected_at:   new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'org_id,provider' })
    .select()
    .single()
  if (error) return dbError(error, 'POST integrations')
  return NextResponse.json({ ...data, integration: data.provider }, { status: 201 })
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
    .eq('provider', integration)
  if (error) return dbError(error, 'DELETE integrations')
  return NextResponse.json({ ok: true })
}
