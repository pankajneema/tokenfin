import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireApiKeyOrOrgMember } from '@/lib/api/auth'
import { getOrgTimezone } from '@/lib/org-timezone'
import { computeInsights, userKeyOf } from '@/lib/insights/load'

export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/insights?org_id=…[&seat_usd=20]
 * Auth: Bearer API key with the read scope, or a session + org_id.
 * Members / viewers (guard.scopeUserId set) get only their own findings and
 * spikes; org-level rules (API keys, seats) are skipped for them.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const guard = await requireApiKeyOrOrgMember(req, sp.get('org_id'), { permission: 'analytics:view' })
  if (guard instanceof NextResponse) return guard

  const admin = createAdminClient()
  let userKey: string | null = null
  if (guard.scopeUserId) {
    let email: string | null = null
    try {
      const { data } = await admin.auth.admin.getUserById(guard.scopeUserId)
      email = data?.user?.email ?? null
    } catch { /* fall back to the id */ }
    userKey = userKeyOf(email, guard.scopeUserId)
  }

  const seatRaw = Number(sp.get('seat_usd'))
  const seatUsd = Number.isFinite(seatRaw) && seatRaw > 0 && seatRaw <= 10_000 ? seatRaw : undefined

  try {
    const result = await computeInsights(admin, guard.orgId, {
      timezone: await getOrgTimezone(guard.orgId), userKey, seatUsd,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    console.error('[insights] failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to compute insights' }, { status: 500 })
  }
}
