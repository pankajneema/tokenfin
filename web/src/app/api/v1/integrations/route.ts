import { NextResponse }                              from 'next/server'
import type { NextRequest }                          from 'next/server'
import { createAdminClient }                         from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { audit } from '@/lib/audit'
import { z }                                          from 'zod'
import { validateOutboundUrl }                        from '@/lib/notify/send'
import { isSupportedIntegration, sealConfig, publicConfig, SUPPORTED_INTEGRATIONS } from '@/lib/integrations/config'

function db() { return createAdminClient() }

type Row = {
  provider: string; is_active: boolean; connected_at: string; last_synced_at: string | null
  sync_ok: boolean; detail: string | null; config: Record<string, unknown> | null
}

/** Public shape — secrets are only ever returned masked. */
function toPublic(r: Row) {
  const cfg = publicConfig(r.config)
  return {
    integration:    r.provider,
    is_active:      r.is_active,
    connected_at:   r.connected_at,
    last_synced_at: r.last_synced_at,            // time of the last real delivery attempt (null = none yet)
    sync_ok:        r.last_synced_at ? r.sync_ok : null,
    detail:         r.detail,                    // last delivery result
    label:          typeof cfg.label === 'string' ? cfg.label : null,
    target:         (cfg.webhook_url ?? cfg.url ?? cfg.endpoint ?? null) as string | null,
  }
}

/* GET /api/v1/integrations?org_id=xxx */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const { data, error } = await db()
    .from('org_integrations')
    .select('provider, is_active, connected_at, last_synced_at, sync_ok, detail, config')
    .eq('org_id', orgId!)
    .eq('is_active', true)
  if (error) return dbError(error, 'GET integrations')
  return NextResponse.json(((data ?? []) as Row[]).map(toPublic))
}

/* POST /api/v1/integrations  { org_id, integration: 'slack'|'webhook'|'email', detail?, config? } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const schema = z.object({
    org_id:      z.string().uuid(),
    integration: z.string().min(1).max(64),
    detail:      z.string().max(256).nullable().optional(),   // friendly name
    config:      z.record(z.unknown()).optional(),
  })
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'integrations:manage')
  if (guard instanceof NextResponse) return guard

  const { org_id, integration, detail, config } = parsed.data
  if (!isSupportedIntegration(integration)) {
    return NextResponse.json({
      error: `Unsupported integration "${integration}". Available: ${SUPPORTED_INTEGRATIONS.join(', ')}. Other connectors are coming soon.`,
    }, { status: 422 })
  }

  const label = detail?.trim() || null
  let stored: Record<string, unknown> = label ? { label } : {}

  if (integration === 'slack' || integration === 'webhook') {
    // Accept webhook_url / url / endpoint; store it as webhook_url.
    const raw = [config?.webhook_url, config?.url, config?.endpoint].find(v => typeof v === 'string' && v.trim())
    if (typeof raw !== 'string' || raw.length > 2048)
      return NextResponse.json({ error: `A ${integration === 'slack' ? 'Slack webhook' : 'webhook'} URL is required` }, { status: 422 })
    // SSRF: must pass the same checks used at send time (https, Slack host
    // allow-list, no private/reserved targets).
    const check = await validateOutboundUrl(raw.trim(), integration === 'slack' ? 'slack' : 'webhook')
    if (!check.ok) return NextResponse.json({ error: `URL rejected: ${check.reason}` }, { status: 422 })
    try {
      stored = sealConfig({ ...stored, webhook_url: raw.trim() })
    } catch (e) {
      console.error('[integrations] seal failed:', (e as Error).message)
      return NextResponse.json({ error: 'Server encryption is not configured (KEY_ENCRYPTION_SECRET)' }, { status: 500 })
    }
  }
  // email: no config — alerts go to org owners/admins through the server's mail provider.

  const { data, error } = await db()
    .from('org_integrations')
    .upsert({
      org_id, provider: integration,
      detail:         null,     // filled with the real result on first delivery
      config:         stored,
      is_active:      true,
      sync_ok:        true,
      connected_at:   new Date().toISOString(),
      last_synced_at: null,
    }, { onConflict: 'org_id,provider' })
    .select('provider, is_active, connected_at, last_synced_at, sync_ok, detail, config')
    .single()
  if (error) return dbError(error, 'POST integrations')
  // Never log the webhook URL (it is a bearer secret for Slack).
  await audit({ orgId: org_id, actorUserId: guard.userId, action: 'integration.connect', targetType: 'integration', targetId: integration, details: { provider: integration, label } })
  return NextResponse.json(toPublic(data as Row), { status: 201 })
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
  await audit({ orgId: orgId!, actorUserId: guard.userId, action: 'integration.disconnect', targetType: 'integration', targetId: integration, details: { provider: integration } })
  return NextResponse.json({ ok: true })
}
