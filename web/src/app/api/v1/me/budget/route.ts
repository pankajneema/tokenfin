/**
 * GET /api/v1/me/budget — compact spend + budget headroom for the CLI statusline.
 *
 * Auth: Bearer API key with 'read' (the key OWNER is "me"), or a dashboard
 * session (optional ?org_id=, else the deterministic org from getOrgContext).
 *
 * Returns today / month-to-date spend for the caller and the org (workspace time
 * zone), plus the tightest applicable active limit (org, the key's project, the
 * caller's team) and % used. Member-scoped limits carry no member id yet and are
 * skipped. CLI-agent spend is `notional` (API-rate estimate, not a bill); the
 * notional share is reported separately.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { bearerFrom, requireApiKeyOrOrgMember, dbError, type ReadGuard } from '@/lib/api/auth'
import { getOrgContext } from '@/lib/org-context'
import { getOrgTimezone } from '@/lib/org-timezone'
import { periodStartIso, tightest, type LimitUsage, type Period } from '../_window'

type Admin = ReturnType<typeof createAdminClient>
interface Spend { cost_usd: number; notional_cost_usd: number; total_tokens: number; events: number }

async function spend(admin: Admin, args: {
  org: string; since: string; user?: string | null; project?: string | null; users?: string[] | null
}): Promise<Spend> {
  const { data, error } = await admin.rpc('tf_spend_window', {
    p_org: args.org, p_since: args.since, p_user: args.user ?? null,
    p_project: args.project ?? null, p_users: args.users ?? null, p_key_ids: null,
  })
  if (error) throw error
  const r = ((data ?? []) as any[])[0] ?? {}
  return {
    cost_usd: +Number(r.cost_usd ?? 0).toFixed(6),
    notional_cost_usd: +Number(r.notional_cost_usd ?? 0).toFixed(6),
    total_tokens: Number(r.total_tokens ?? 0),
    events: Number(r.events ?? 0),
  }
}

async function resolveCaller(req: NextRequest): Promise<ReadGuard | NextResponse> {
  const orgParam = req.nextUrl.searchParams.get('org_id')
  if (bearerFrom(req) || orgParam) return requireApiKeyOrOrgMember(req, orgParam)
  const ctx = await getOrgContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.orgId) return NextResponse.json({ error: 'No organization membership' }, { status: 403 })
  return requireApiKeyOrOrgMember(req, ctx.orgId)
}

export async function GET(req: NextRequest) {
  const guard = await resolveCaller(req)
  if (guard instanceof NextResponse) return guard
  const { orgId } = guard

  const admin = createAdminClient()
  const tz    = await getOrgTimezone(orgId)
  const now   = Date.now()
  const todayStart = periodStartIso('daily', now, tz)
  const monthStart = periodStartIso('monthly', now, tz)

  // "Me": the session user, or a personal key's owner. Org-level keys have no person.
  let me: string | null = guard.userId
  if (guard.viaKey) {
    const { data: k } = await admin.from('api_keys').select('user_id').eq('id', guard.keyId!).maybeSingle()
    me = (k?.user_id as string | null) ?? null
  }

  try {
    const [orgToday, orgMtd, meToday, meMtd, limitsRes, memberRes] = await Promise.all([
      spend(admin, { org: orgId, since: todayStart }),
      spend(admin, { org: orgId, since: monthStart }),
      me ? spend(admin, { org: orgId, since: todayStart, user: me }) : Promise.resolve(null),
      me ? spend(admin, { org: orgId, since: monthStart, user: me }) : Promise.resolve(null),
      admin.from('limits').select('id, scope, period, metric, budget_usd, value, project_id, team_id')
        .eq('org_id', orgId).eq('is_active', true),
      me ? admin.from('members').select('team_id').eq('org_id', orgId).eq('user_id', me).maybeSingle()
         : Promise.resolve({ data: null }),
    ])
    if (limitsRes.error) return dbError(limitsRes.error, 'GET me/budget limits')

    const teamId    = (memberRes.data as { team_id?: string | null } | null)?.team_id ?? null
    const projectId = guard.projectId ?? req.nextUrl.searchParams.get('project_id')

    let teamUsers: string[] | null = null
    if (teamId && (limitsRes.data ?? []).some(l => l.scope === 'team' && l.team_id === teamId)) {
      const { data: tm } = await admin.from('members').select('user_id').eq('org_id', orgId).eq('team_id', teamId)
      teamUsers = (tm ?? []).map(r => r.user_id as string)
    }

    const usages: LimitUsage[] = []
    for (const l of limitsRes.data ?? []) {
      const period = ((l.period as string) ?? 'monthly') as Period
      const since  = periodStartIso(period, now, tz)
      let s: Spend | null = null
      if (l.scope === 'org') s = await spend(admin, { org: orgId, since })
      else if (l.scope === 'project' && projectId && l.project_id === projectId) s = await spend(admin, { org: orgId, since, project: projectId })
      else if (l.scope === 'team' && teamId && l.team_id === teamId && teamUsers?.length) s = await spend(admin, { org: orgId, since, users: teamUsers })
      if (!s) continue
      const isCost = (l.metric ?? 'cost_usd') === 'cost_usd'
      const budget = Number(isCost ? l.budget_usd : (l.value ?? l.budget_usd))
      if (!(budget > 0)) continue
      const spent = isCost ? s.cost_usd : s.total_tokens
      usages.push({
        id: l.id as string, scope: l.scope as string, period, budget, spent,
        pct: +(spent / budget * 100).toFixed(1), metric: isCost ? 'cost_usd' : 'tokens',
      })
    }
    const top = tightest(usages)

    return NextResponse.json({
      org_id: orgId,
      timezone: tz,
      currency: 'USD',
      me: me && meToday && meMtd ? { user_id: me, today: meToday, mtd: meMtd } : null,
      org: { today: orgToday, mtd: orgMtd },
      limit: top,
      limits_evaluated: usages.length,
      note: 'notional_cost_usd = subscription (CLI agent) usage priced at API rates — an estimate, not a bill.',
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return dbError(e, 'GET me/budget')
  }
}
