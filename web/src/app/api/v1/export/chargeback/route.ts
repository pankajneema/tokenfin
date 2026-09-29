import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requirePermission, dbError } from '@/lib/api/auth'
import { selectAll } from '@/lib/supabase/paginate'
import { promptKey } from '@/lib/prompts'
import { DEFAULT_TIMEZONE, toZonedDate } from '@/lib/dates'
import { allocateRows } from '@/lib/allocation/apply'
import { loadRules } from '@/lib/allocation/load'

/**
 * GET /api/v1/export/chargeback?org_id=…&month=YYYY-MM&group=team|project|member|cost_center
 * Monthly showback/chargeback CSV. Metered (real bill) and notional
 * (subscription usage priced at API rates) are separate columns and are never
 * added together. Owners and admins only.
 *
 * Team and cost center come from Settings → Allocation rules (lib/allocation),
 * falling back to the member's team. A shared_split rule spreads unattributed
 * cost across teams in proportion to their attributed cost. Trailing columns
 * `teams` / `cost_centers` list what each group was allocated to.
 */
type Row = {
  id: string; correlation_id: string | null; project_id: string | null; user_id: string | null
  user_email: string | null; cost_usd: number | null; cost_basis: string | null
  total_tokens: number | null; created_at: string
  repo: string | null; source: string | null; model: string | null; tags: Record<string, unknown> | null
}
type Group = 'team' | 'project' | 'member' | 'cost_center'

export async function GET(req: NextRequest) {
  const p     = req.nextUrl.searchParams
  const orgId = p.get('org_id')
  const guard = await requirePermission(orgId, 'members:view')
  if (guard instanceof NextResponse) return guard

  const group = (p.get('group') ?? 'team') as Group
  if (!['team', 'project', 'member', 'cost_center'].includes(group)) {
    return NextResponse.json({ error: 'group must be team, project, member or cost_center' }, { status: 422 })
  }
  const admin = createAdminClient()
  const { data: org } = await admin.from('organizations').select('timezone').eq('id', orgId!).maybeSingle()
  const tz = (org?.timezone as string | undefined) ?? DEFAULT_TIMEZONE

  const month = p.get('month') ?? toZonedDate(Date.now(), tz).slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 422 })

  // Fetch a padded UTC window, then keep rows whose date in the workspace zone is in the month.
  const [y, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString()
  const to   = new Date(Date.UTC(y, m, 1) + 86_400_000).toISOString()

  let events: Row[]
  try {
    ;({ data: events } = await selectAll<Row>(() => admin.from('usage_events')
      .select('id, correlation_id, project_id, user_id, user_email, cost_usd, cost_basis, total_tokens, created_at, repo, source, model, tags')
      .eq('org_id', orgId!).gte('created_at', from).lt('created_at', to)))
  } catch (e) {
    return dbError(e, 'GET chargeback')
  }
  events = events.filter(e => toZonedDate(e.created_at, tz).startsWith(month))

  const [{ data: projects }, { data: members }, { data: teams }, rules] = await Promise.all([
    admin.from('projects').select('id, name').eq('org_id', orgId!),
    admin.from('members').select('user_id, team_id').eq('org_id', orgId!),
    admin.from('teams').select('id, name').eq('org_id', orgId!),
    loadRules(admin, orgId!),
  ])
  const projName = new Map((projects ?? []).map(r => [r.id, r.name as string]))
  const teamName = new Map((teams ?? []).map(r => [r.id, r.name as string]))
  const userTeam = new Map((members ?? []).map(r => [r.user_id, r.team_id as string | null]))

  // Resolve emails for members whose events carry only a user id.
  const emailOf = new Map<string, string>()
  if (group === 'member') {
    const ids = Array.from(new Set(events.filter(e => !e.user_email && e.user_id).map(e => e.user_id!)))
    await Promise.all(ids.slice(0, 500).map(async id => {
      const { data } = await admin.auth.admin.getUserById(id)
      if (data?.user?.email) emailOf.set(id, data.user.email)
    }))
  }

  const memberTeamName = (userId: string | null) => {
    const t = userId ? userTeam.get(userId) : null
    return t ? (teamName.get(t) ?? 'Deleted team') : null
  }
  const allocated = allocateRows(
    events,
    e => ({
      user_id: e.user_id, user_email: e.user_email, repo: e.repo, project_id: e.project_id,
      source: e.source, model: e.model, tags: e.tags ?? {}, member_team: memberTeamName(e.user_id),
    }),
    e => Number(e.cost_usd ?? 0),
    rules,
  )

  const keyOf = (e: Row, team: string | null, cc: string | null): string => {
    if (group === 'project') return e.project_id ? (projName.get(e.project_id) ?? 'Deleted project') : 'Unassigned'
    if (group === 'member')  return e.user_email ?? (e.user_id ? (emailOf.get(e.user_id) ?? `user:${e.user_id.slice(0, 8)}`) : 'Unattributed')
    if (group === 'cost_center') return cc ?? 'No cost center'
    return team ?? 'No team'
  }

  type Agg = { metered: number; notional: number; tokens: number; calls: number; prompts: Set<string>; teams: Set<string>; ccs: Set<string> }
  const agg = new Map<string, Agg>()
  for (const { row: e, team, cost_center, weight } of allocated) {
    const k = keyOf(e, team, cost_center)
    const a = agg.get(k) ?? { metered: 0, notional: 0, tokens: 0, calls: 0, prompts: new Set<string>(), teams: new Set<string>(), ccs: new Set<string>() }
    if (e.cost_basis === 'notional') a.notional += Number(e.cost_usd ?? 0) * weight
    else a.metered += Number(e.cost_usd ?? 0) * weight
    a.tokens += Number(e.total_tokens ?? 0) * weight
    a.calls  += weight
    a.prompts.add(promptKey(e))
    if (team) a.teams.add(team)
    if (cost_center) a.ccs.add(cost_center)
    agg.set(k, a)
  }

  const totalMetered = Array.from(agg.values()).reduce((s, a) => s + a.metered, 0)
  // Quote, and neutralise spreadsheet formulas in names that come from users/rules.
  const esc = (v: string | number) => {
    const s = String(v)
    return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
  }
  const header = [group, 'metered_cost_usd', 'share_of_metered_pct', 'notional_cost_usd', 'prompts', 'llm_calls', 'tokens', 'teams', 'cost_centers']
  const lines = [header.join(',')]
  for (const [k, a] of Array.from(agg.entries()).sort((x, z) => (z[1].metered + z[1].notional) - (x[1].metered + x[1].notional))) {
    lines.push([
      esc(k), a.metered.toFixed(4),
      totalMetered > 0 ? (a.metered / totalMetered * 100).toFixed(1) : '0.0',
      a.notional.toFixed(4), a.prompts.size, Math.round(a.calls), Math.round(a.tokens),
      esc(Array.from(a.teams).sort().join('; ')), esc(Array.from(a.ccs).sort().join('; ')),
    ].join(','))
  }

  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tokenfin-chargeback-${month}-by-${group}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
