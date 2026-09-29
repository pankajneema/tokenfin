import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/api/auth'
import { getOrCreateSetupKey } from '@/lib/setup/key'
import { audit } from '@/lib/audit'
import { managedSettings } from '@/app/(dashboard)/dashboard/setup/_snippets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/setup/managed-settings?org_id=…[&team=…][&download=1]
 *
 * Owner/admin only. Returns a Claude Code managed-settings.json that points
 * every developer's Claude Code at this workspace's OTLP receiver with the
 * org-level INGEST key (never a read key). Prompt capture follows the org
 * policy (organizations.capture_prompts; absent column = on). `team` fills
 * OTEL_RESOURCE_ATTRIBUTES team.name (placeholder otherwise). Audited as a
 * key reveal because the file carries a live ingest key.
 */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requirePermission(orgId, 'keys:create')
  if (guard instanceof NextResponse) return guard

  const admin = createAdminClient()
  let prompts = true
  const { data: org, error } = await admin.from('organizations').select('capture_prompts').eq('id', orgId!).maybeSingle()
  if (!error && org && (org as { capture_prompts?: boolean | null }).capture_prompts === false) prompts = false

  let key
  try { key = await getOrCreateSetupKey(orgId!, guard.userId) } catch (e) {
    console.error('[setup/managed-settings] key failed:', e)
    return NextResponse.json({ error: 'Could not provision the org ingest key' }, { status: 500 })
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const team = req.nextUrl.searchParams.get('team') ?? undefined
  const body = JSON.stringify(managedSettings(appUrl + '/api/otel', key.raw, { prompts, team }), null, 2) + '\n'

  await audit({
    orgId: orgId!, actorUserId: guard.userId, action: 'key.reveal', targetType: 'api_key', targetId: key.id,
    details: { via: 'managed_settings', prompts, team: team ?? null },
  })

  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' }
  if (req.nextUrl.searchParams.get('download')) headers['Content-Disposition'] = 'attachment; filename="managed-settings.json"'
  return new NextResponse(body, { status: 200, headers })
}
