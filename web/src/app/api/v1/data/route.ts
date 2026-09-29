import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireOrgMember, requirePermission, dbError } from '@/lib/api/auth'
import { audit } from '@/lib/audit'

/**
 * Settings → Data. Customer-controlled retention and deletion of monitoring
 * data (usage events, daily aggregates, captured prompts, traces).
 *
 * GET    /api/v1/data?org_id=…               → retention setting + what is stored
 * PATCH  /api/v1/data { org_id, retention_days: number | null }
 * POST   /api/v1/data { org_id, older_than_days: number | null, confirm: 'DELETE' }
 *        older_than_days = null deletes ALL monitoring data.
 * Changing retention and deleting data are owner-only.
 */
const db = () => createAdminClient()

async function countSince(table: string, orgId: string, col = 'created_at', before?: string) {
  let q = db().from(table).select('*', { count: 'exact', head: true }).eq('org_id', orgId)
  if (before) q = q.lt(col, before)
  const { count } = await q
  return count ?? 0
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id')
  const guard = await requireOrgMember(orgId)
  if (guard instanceof NextResponse) return guard

  const [{ data: org, error }, events, prompts, traces, { data: oldest }] = await Promise.all([
    db().from('organizations').select('retention_days').eq('id', orgId!).single(),
    countSince('usage_events', orgId!),
    countSince('prompt_captures', orgId!),
    countSince('traces', orgId!),
    db().from('usage_events').select('created_at').eq('org_id', orgId!).order('created_at', { ascending: true }).limit(1),
  ])
  if (error) return dbError(error, 'GET data')

  // How much each preset would delete, so the UI can say so before confirming.
  const presets = await Promise.all([7, 30, 90].map(async days => ({
    days,
    events: await countSince('usage_events', orgId!, 'created_at', new Date(Date.now() - days * 86_400_000).toISOString()),
  })))

  return NextResponse.json({
    retention_days: org.retention_days ?? null,
    counts: { usage_events: events, prompt_captures: prompts, traces },
    oldest_event_at: oldest?.[0]?.created_at ?? null,
    presets,
  })
}

export async function PATCH(req: NextRequest) {
  const parsed = z.object({
    org_id:         z.string().uuid(),
    retention_days: z.number().int().min(1).max(3650).nullable(),
  }).safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })

  const guard = await requirePermission(parsed.data.org_id, 'org:edit')
  if (guard instanceof NextResponse) return guard

  const { error } = await db().from('organizations')
    .update({ retention_days: parsed.data.retention_days })
    .eq('id', parsed.data.org_id)
  if (error) return dbError(error, 'PATCH data retention')
  await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'data.retention', targetType: 'organization', targetId: parsed.data.org_id, details: { retention_days: parsed.data.retention_days } })
  return NextResponse.json({ ok: true, retention_days: parsed.data.retention_days })
}

export async function POST(req: NextRequest) {
  const parsed = z.object({
    org_id:          z.string().uuid(),
    older_than_days: z.number().int().min(1).max(3650).nullable(),
    confirm:         z.literal('DELETE'),
  }).safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Send org_id, older_than_days (number or null for everything) and confirm: "DELETE".' }, { status: 422 })
  }

  const guard = await requirePermission(parsed.data.org_id, 'org:edit')
  if (guard instanceof NextResponse) return guard

  const before = parsed.data.older_than_days == null
    ? null
    : new Date(Date.now() - parsed.data.older_than_days * 86_400_000).toISOString()

  const { data, error } = await db().rpc('purge_org_data', { p_org: parsed.data.org_id, p_before: before })
  if (error) return dbError(error, 'POST data purge')

  console.log(`[data] org=${parsed.data.org_id} purge before=${before ?? 'ALL'} by=${guard.userId}`, data)
  await audit({ orgId: parsed.data.org_id, actorUserId: guard.userId, action: 'data.delete', targetType: 'organization', targetId: parsed.data.org_id, details: { older_than_days: parsed.data.older_than_days, deleted: data } })
  return NextResponse.json({ ok: true, deleted: data })
}
